/**
 * BLOOM Desktop Auth Manager
 *
 * Handles Supabase authentication and persistent session storage.
 * After sign-in, stores the session so the user doesn't have to log in
 * every time they open the app.
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { app } = require('electron');

const SUPABASE_URL = 'https://njfhzabmaxhfzekbzpzz.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5qZmh6YWJtYXhoZnpla2J6cHp6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI4MjYwMjMsImV4cCI6MjA4ODQwMjAyM30.QPTQhnlfZtmfQVm75GqG0Oazmyb7USjYBdLEy_G-iqU';

class AuthManager {
  constructor() {
    this.supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        autoRefreshToken: true,
        persistSession: false, // we handle persistence ourselves
      }
    });
    this.user = null;
    this.session = null;
    this.orgId = null;
    this.orgName = null;
    this.agentName = null;
    this.agentId = null;
    this._sessionPath = null;
  }

  /**
   * Path to the stored session file.
   * Uses Electron's userData directory so it persists across app launches.
   */
  get sessionPath() {
    if (!this._sessionPath) {
      const userDataPath = app.getPath('userData');
      this._sessionPath = path.join(userDataPath, 'bloom-session.json');
    }
    return this._sessionPath;
  }

  /**
   * Try to restore a previous session from disk.
   * Returns { success, user, org } if valid session exists.
   */
  async tryRestoreSession() {
    try {
      if (!fs.existsSync(this.sessionPath)) {
        return { success: false, reason: 'no_stored_session' };
      }

      const stored = JSON.parse(fs.readFileSync(this.sessionPath, 'utf8'));
      if (!stored.access_token || !stored.refresh_token) {
        return { success: false, reason: 'invalid_stored_session' };
      }

      // Set the session in Supabase client
      const { data, error } = await this.supabase.auth.setSession({
        access_token: stored.access_token,
        refresh_token: stored.refresh_token,
      });

      if (error || !data.session) {
        // Session expired or invalid — clear it
        this._clearStoredSession();
        return { success: false, reason: 'session_expired' };
      }

      this.session = data.session;
      this.user = data.session.user;

      // Fetch org and agent info
      await this._fetchUserContext();

      // Re-persist with refreshed tokens
      this._persistSession(data.session);

      return {
        success: true,
        user: this._safeUser(),
        org: { id: this.orgId, name: this.orgName },
        agent: { id: this.agentId, name: this.agentName },
      };
    } catch (err) {
      console.error('[AuthManager] restore failed:', err.message);
      return { success: false, reason: err.message };
    }
  }

  /**
   * Sign in with email + password.
   */
  async signIn(email, password) {
    try {
      const { data, error } = await this.supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        return { success: false, error: error.message };
      }

      this.session = data.session;
      this.user = data.user;

      // Fetch org and agent info
      await this._fetchUserContext();

      // Persist session to disk
      this._persistSession(data.session);

      return {
        success: true,
        user: this._safeUser(),
        org: { id: this.orgId, name: this.orgName },
        agent: { id: this.agentId, name: this.agentName },
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Sign out — clears session from memory and disk.
   */
  async signOut() {
    try {
      await this.supabase.auth.signOut();
    } catch (err) {
      console.warn('[AuthManager] signOut error:', err.message);
    }
    this.user = null;
    this.session = null;
    this.orgId = null;
    this.orgName = null;
    this.agentName = null;
    this.agentId = null;
    this._clearStoredSession();
    return { success: true };
  }

  /**
   * Register this desktop with the Railway backend.
   */
  async registerDesktop(railwayUrl) {
    if (!this.session || !this.orgId) {
      return { success: false, error: 'Not signed in' };
    }

    try {
      // Register in Supabase desktop_sessions table
      const { data: dsData, error: dsError } = await this.supabase
        .from('desktop_sessions')
        .upsert({
          user_id: this.user.id,
          organization_id: this.orgId,
          hostname: os.hostname(),
          platform: process.platform,
          app_version: require('../package.json').version,
          status: 'online',
          last_seen_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }, {
          onConflict: 'user_id,organization_id',
          ignoreDuplicates: false,
        })
        .select()
        .single();

      // Also register with Railway (best effort)
      let railwayResult = null;
      try {
        const https = require('https');
        const http = require('http');
        const payload = JSON.stringify({
          sessionId: dsData?.id || 'desktop-' + this.user.id,
          orgId: this.orgId,
          userId: this.user.id,
          hostname: os.hostname(),
          platform: process.platform,
          appVersion: require('../package.json').version,
        });

        const url = new URL(railwayUrl + '/api/desktop/register');
        const lib = url.protocol === 'https:' ? https : http;

        railwayResult = await new Promise((resolve, reject) => {
          const req = lib.request({
            hostname: url.hostname,
            port: url.port || (url.protocol === 'https:' ? 443 : 80),
            path: url.pathname,
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(payload),
            },
            timeout: 10000,
          }, (res) => {
            let raw = '';
            res.on('data', c => raw += c);
            res.on('end', () => {
              resolve({ status: res.statusCode, body: raw });
            });
          });
          req.on('error', reject);
          req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
          req.write(payload);
          req.end();
        });
      } catch (err) {
        console.warn('[AuthManager] Railway register failed (non-fatal):', err.message);
      }

      return {
        success: true,
        desktopSessionId: dsData?.id,
        railwayRegistered: railwayResult?.status === 200,
      };
    } catch (err) {
      console.error('[AuthManager] registerDesktop failed:', err.message);
      return { success: false, error: err.message };
    }
  }

  /**
   * Get the current auth state for the renderer.
   */
  getState() {
    if (!this.user) {
      return { authenticated: false };
    }
    return {
      authenticated: true,
      user: this._safeUser(),
      org: { id: this.orgId, name: this.orgName },
      agent: { id: this.agentId, name: this.agentName },
    };
  }

  // ── Private ──────────────────────────────────────────────

  async _fetchUserContext() {
    if (!this.user) return;

    // Get user's org membership
    const { data: membership } = await this.supabase
      .from('organization_members')
      .select('organization_id, organizations(id, name)')
      .eq('user_id', this.user.id)
      .limit(1)
      .single();

    if (membership) {
      this.orgId = membership.organization_id;
      this.orgName = membership.organizations?.name || 'Unknown Org';
    }

    // Get the org's primary agent
    if (this.orgId) {
      const { data: agent } = await this.supabase
        .from('agents')
        .select('id, name')
        .eq('organization_id', this.orgId)
        .limit(1)
        .single();

      if (agent) {
        this.agentId = agent.id;
        this.agentName = agent.name;
      }
    }
  }

  _safeUser() {
    if (!this.user) return null;
    return {
      id: this.user.id,
      email: this.user.email,
      fullName: this.user.user_metadata?.full_name || this.user.email?.split('@')[0],
    };
  }

  _persistSession(session) {
    try {
      const toStore = {
        access_token: session.access_token,
        refresh_token: session.refresh_token,
        user_id: session.user?.id,
        stored_at: Date.now(),
      };
      fs.writeFileSync(this.sessionPath, JSON.stringify(toStore, null, 2), 'utf8');
    } catch (err) {
      console.error('[AuthManager] persist failed:', err.message);
    }
  }

  _clearStoredSession() {
    try {
      if (fs.existsSync(this.sessionPath)) {
        fs.unlinkSync(this.sessionPath);
      }
    } catch (err) {
      console.error('[AuthManager] clear session failed:', err.message);
    }
  }
}

module.exports = AuthManager;
