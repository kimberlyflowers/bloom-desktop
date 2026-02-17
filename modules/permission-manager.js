const { app, Notification } = require('electron');
const fs = require('fs').promises;
const path = require('path');

class PermissionManager {
  constructor() {
    this.permissions = {
      screenCapture: false,
      inputControl: false,
      fileAccess: false
    };

    this.sessionData = {
      startTime: null,
      endTime: null,
      agentName: null,
      reason: null,
      duration: 0
    };

    this.sessionHistory = [];
    this.configPath = path.join(app.getPath('userData'), 'bloom-config.json');
    this.historyPath = path.join(app.getPath('userData'), 'session-history.json');

    this.loadConfig();
    this.loadHistory();
  }

  async loadConfig() {
    try {
      const data = await fs.readFile(this.configPath, 'utf8');
      const config = JSON.parse(data);
      this.permissions = { ...this.permissions, ...config.permissions };
      console.log('Loaded permission config:', this.permissions);
    } catch (error) {
      // File doesn't exist or invalid JSON, use defaults
      console.log('Using default permissions (config not found)');
      await this.saveConfig();
    }
  }

  async saveConfig() {
    try {
      const config = {
        permissions: this.permissions,
        lastUpdated: new Date().toISOString()
      };

      await fs.writeFile(this.configPath, JSON.stringify(config, null, 2));
      console.log('Saved permission config');
    } catch (error) {
      console.error('Failed to save permission config:', error);
    }
  }

  async loadHistory() {
    try {
      const data = await fs.readFile(this.historyPath, 'utf8');
      this.sessionHistory = JSON.parse(data);
      console.log(`Loaded ${this.sessionHistory.length} session history entries`);
    } catch (error) {
      // File doesn't exist or invalid JSON, start with empty history
      this.sessionHistory = [];
      console.log('Starting with empty session history');
    }
  }

  async saveHistory() {
    try {
      await fs.writeFile(this.historyPath, JSON.stringify(this.sessionHistory, null, 2));
      console.log('Saved session history');
    } catch (error) {
      console.error('Failed to save session history:', error);
    }
  }

  requestPermission(agentName, reason) {
    console.log(`Permission requested by ${agentName}: ${reason}`);

    return new Promise((resolve) => {
      // Store the request data
      this.currentRequest = {
        agentName,
        reason,
        timestamp: new Date(),
        resolve
      };

      // Show system notification
      this.showPermissionNotification(agentName, reason);

      // The resolve will be called by grantPermission() or denyPermission()
    });
  }

  grantPermission(watchLive = false) {
    if (!this.currentRequest) {
      return { success: false, error: 'No pending permission request' };
    }

    // Grant permissions
    this.permissions.screenCapture = true;
    this.permissions.inputControl = true;

    // Start session tracking
    this.sessionData = {
      startTime: new Date(),
      endTime: null,
      agentName: this.currentRequest.agentName,
      reason: this.currentRequest.reason,
      watchLive,
      duration: 0
    };

    console.log('Permission granted:', {
      agentName: this.currentRequest.agentName,
      reason: this.currentRequest.reason,
      watchLive
    });

    // Resolve the permission request
    this.currentRequest.resolve({
      granted: true,
      watchLive,
      sessionId: this.generateSessionId()
    });

    this.currentRequest = null;
    return { success: true };
  }

  denyPermission() {
    if (!this.currentRequest) {
      return { success: false, error: 'No pending permission request' };
    }

    console.log('Permission denied for:', this.currentRequest.agentName);

    // Resolve the permission request with denial
    this.currentRequest.resolve({
      granted: false,
      reason: 'User denied permission'
    });

    this.currentRequest = null;
    return { success: true };
  }

  revokePermission(reason = 'Permission revoked') {
    // Revoke all permissions
    this.permissions.screenCapture = false;
    this.permissions.inputControl = false;

    // End session tracking
    if (this.sessionData.startTime) {
      this.sessionData.endTime = new Date();
      this.sessionData.duration = Math.floor(
        (this.sessionData.endTime - this.sessionData.startTime) / 1000
      );

      // Add to history
      this.addToHistory({
        ...this.sessionData,
        endReason: reason
      });

      console.log('Session ended:', {
        duration: this.sessionData.duration,
        reason
      });
    }

    // Reset session data
    this.sessionData = {
      startTime: null,
      endTime: null,
      agentName: null,
      reason: null,
      duration: 0
    };

    console.log('Permission revoked:', reason);
    return { success: true };
  }

  hasPermission(permissionType) {
    return this.permissions[permissionType] || false;
  }

  getSessionStatus() {
    if (this.sessionData.startTime) {
      const now = new Date();
      const duration = Math.floor((now - this.sessionData.startTime) / 1000);

      return {
        active: true,
        agentName: this.sessionData.agentName,
        reason: this.sessionData.reason,
        startTime: this.sessionData.startTime,
        duration,
        watchLive: this.sessionData.watchLive || false
      };
    }

    return { active: false };
  }

  getSessionHistory(limit = 10) {
    return this.sessionHistory
      .slice(-limit)
      .reverse(); // Most recent first
  }

  addToHistory(sessionData) {
    this.sessionHistory.push({
      ...sessionData,
      timestamp: new Date().toISOString(),
      id: this.generateSessionId()
    });

    // Keep only last 100 sessions
    if (this.sessionHistory.length > 100) {
      this.sessionHistory = this.sessionHistory.slice(-100);
    }

    // Save to disk
    this.saveHistory();
  }

  generateSessionId() {
    return `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  showPermissionNotification(agentName, reason) {
    if (Notification.isSupported()) {
      const notification = new Notification({
        title: `${agentName} wants to access your screen`,
        body: reason,
        icon: path.join(__dirname, '../assets/icon.png')
      });

      notification.show();

      notification.on('click', () => {
        // Bring app to foreground when notification is clicked
        if (global.bloomApp && global.bloomApp.mainWindow) {
          global.bloomApp.mainWindow.show();
          global.bloomApp.mainWindow.focus();
        }
      });
    }
  }

  // Get permission statistics
  getStatistics() {
    const totalSessions = this.sessionHistory.length;
    const totalDuration = this.sessionHistory.reduce((sum, session) => sum + (session.duration || 0), 0);
    const averageDuration = totalSessions > 0 ? Math.floor(totalDuration / totalSessions) : 0;

    const agentStats = {};
    this.sessionHistory.forEach(session => {
      const agent = session.agentName || 'Unknown';
      if (!agentStats[agent]) {
        agentStats[agent] = { sessions: 0, totalDuration: 0 };
      }
      agentStats[agent].sessions++;
      agentStats[agent].totalDuration += session.duration || 0;
    });

    return {
      totalSessions,
      totalDuration,
      averageDuration,
      agentStats,
      currentSession: this.getSessionStatus()
    };
  }

  // Clear all session history
  async clearHistory() {
    this.sessionHistory = [];
    await this.saveHistory();
    console.log('Session history cleared');
  }

  // Export session data
  exportSessionData() {
    return {
      permissions: this.permissions,
      sessionHistory: this.sessionHistory,
      currentSession: this.getSessionStatus(),
      statistics: this.getStatistics(),
      exportedAt: new Date().toISOString()
    };
  }

  getStatus() {
    return {
      permissions: this.permissions,
      currentSession: this.getSessionStatus(),
      hasPendingRequest: !!this.currentRequest,
      historyCount: this.sessionHistory.length
    };
  }
}

module.exports = PermissionManager;