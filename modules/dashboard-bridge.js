/**
 * DashboardBridge — pushes live screen frames to Sarah's Railway dashboard
 *
 * Architecture:
 *   BLOOM Desktop (this app)
 *     └─ captures JPEG frames via desktopCapturer
 *     └─ DashboardBridge.pushFrame(jpegBuffer, url)
 *         └─ POST /api/browser/push-screenshot  →  Sarah's Railway server
 *             └─ browser.emit('screenshot')  →  SSE /api/browser/stream
 *                 └─ Dashboard Screen Viewer goes LIVE ✅
 *
 * Config (stored in Electron config / env):
 *   SARAH_URL  — e.g. https://autonomous-sarah-rodriguez-production.up.railway.app
 *   SARAH_KEY  — optional bearer token (if Sarah's endpoint is protected)
 */

const https = require('https');
const http = require('http');
const EventEmitter = require('events');

class DashboardBridge extends EventEmitter {
  constructor({ sarahUrl, sarahKey = null } = {}) {
    super();
    this.sarahUrl = (sarahUrl || '').replace(/\/$/, ''); // strip trailing slash
    this.sarahKey = sarahKey;
    this.enabled = !!this.sarahUrl;
    this.pushing = false;
    this.pushQueue = [];           // max 1 pending push at a time
    this.lastPushTime = 0;
    this.pushIntervalMs = 500;     // max 2 fps to dashboard (Sarah generates her own at 2 fps)
    this.consecutiveFailures = 0;
    this.maxFailures = 10;         // disable after 10 consecutive failures
    this.status = 'idle';          // idle | pushing | error | disabled
    this._pushTimer = null;
    console.log('[DashboardBridge] initialized', {
      sarahUrl: this.sarahUrl || '(not set)',
      enabled: this.enabled
    });
  }

  /**
   * Configure or reconfigure the bridge at runtime.
   * Call this when the user sets/changes the Sarah URL in settings.
   */
  configure({ sarahUrl, sarahKey } = {}) {
    this.sarahUrl = (sarahUrl || '').replace(/\/$/, '');
    this.sarahKey = sarahKey || null;
    this.enabled = !!this.sarahUrl;
    this.consecutiveFailures = 0;
    this.status = this.enabled ? 'idle' : 'disabled';
    console.log('[DashboardBridge] reconfigured', {
      sarahUrl: this.sarahUrl || '(not set)',
      enabled: this.enabled
    });
    this.emit('status-change', this.getStatus());
  }

  /**
   * Receive a JPEG frame buffer (from ScreenCapture) and queue it for push.
   * Rate-limited — drops frames if push is in progress (newest frame wins).
   */
  receiveFrame(jpegBuffer, currentUrl = '') {
    if (!this.enabled || this.status === 'disabled') return;

    // Rate limit — don't flood Sarah's server
    const now = Date.now();
    if (now - this.lastPushTime < this.pushIntervalMs) return;

    // Queue — always keep latest frame, discard older queued ones
    this.pushQueue = [{ data: jpegBuffer.toString('base64'), url: currentUrl }];

    if (!this.pushing) {
      this._drainQueue();
    }
  }

  async _drainQueue() {
    if (this.pushQueue.length === 0 || this.pushing) return;

    this.pushing = true;
    const frame = this.pushQueue.shift();

    try {
      await this._post('/api/browser/push-screenshot', {
        data: frame.data,
        url: frame.url,
        source: 'bloom-desktop',
        timestamp: Date.now()
      });
      this.lastPushTime = Date.now();
      this.consecutiveFailures = 0;
      if (this.status !== 'pushing') {
        this.status = 'pushing';
        this.emit('status-change', this.getStatus());
      }
    } catch (err) {
      this.consecutiveFailures++;
      console.warn(`[DashboardBridge] push failed (${this.consecutiveFailures}/${this.maxFailures}):`, err.message);
      if (this.consecutiveFailures >= this.maxFailures) {
        this.status = 'error';
        this.enabled = false;
        console.error('[DashboardBridge] too many failures — disabling. Call configure() to re-enable.');
        this.emit('status-change', this.getStatus());
        this.emit('error', new Error(`Dashboard bridge disabled after ${this.maxFailures} consecutive failures: ${err.message}`));
      }
    } finally {
      this.pushing = false;
      // Drain any next queued frame
      if (this.pushQueue.length > 0) {
        setImmediate(() => this._drainQueue());
      }
    }
  }

  /**
   * POST JSON to Sarah's Railway server.
   * Uses Node's built-in http/https — no external deps required.
   */
  _post(path, body) {
    return new Promise((resolve, reject) => {
      const payload = JSON.stringify(body);
      const url = new URL(this.sarahUrl + path);
      const isHttps = url.protocol === 'https:';
      const lib = isHttps ? https : http;

      const headers = {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      };
      if (this.sarahKey) {
        headers['Authorization'] = `Bearer ${this.sarahKey}`;
      }

      const options = {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + url.search,
        method: 'POST',
        headers,
        timeout: 8000
      };

      const req = lib.request(options, (res) => {
        let raw = '';
        res.on('data', chunk => { raw += chunk; });
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({ status: res.statusCode, body: raw });
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${raw.slice(0, 120)}`));
          }
        });
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timed out (8s)'));
      });

      req.write(payload);
      req.end();
    });
  }

  /**
   * Test the connection — POSTs a 1x1 placeholder frame.
   * Returns { success, latencyMs, error? }
   */
  async testConnection() {
    if (!this.sarahUrl) {
      return { success: false, error: 'No Sarah URL configured' };
    }
    const start = Date.now();
    try {
      // Tiny 1x1 JPEG in base64
      const testPixel = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/xAAUAQEAAAAAAAAAAAAAAAAAAAAA/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8AJQAB/9k=';
      await this._post('/api/browser/push-screenshot', {
        data: testPixel,
        url: 'bloom-desktop://test',
        source: 'bloom-desktop-test',
        timestamp: Date.now()
      });
      const latencyMs = Date.now() - start;
      this.consecutiveFailures = 0;
      this.status = 'idle';
      return { success: true, latencyMs };
    } catch (err) {
      return { success: false, error: err.message, latencyMs: Date.now() - start };
    }
  }

  getStatus() {
    return {
      enabled: this.enabled,
      status: this.status,
      sarahUrl: this.sarahUrl || null,
      consecutiveFailures: this.consecutiveFailures,
      lastPushTime: this.lastPushTime
    };
  }

  /**
   * Idle the bridge — stops pushing without disabling.
   * Screen Viewer on dashboard will show "Browser idle".
   */
  sendIdle() {
    if (!this.enabled) return;
    this._post('/api/browser/push-screenshot', {
      data: null,
      url: null,
      source: 'bloom-desktop',
      idle: true,
      timestamp: Date.now()
    }).catch(() => {}); // fire-and-forget
    this.status = 'idle';
    this.emit('status-change', this.getStatus());
  }

  destroy() {
    this.enabled = false;
    this.pushQueue = [];
    if (this._pushTimer) clearInterval(this._pushTimer);
  }
}

module.exports = DashboardBridge;
