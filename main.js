const { app, BrowserWindow, ipcMain, dialog, globalShortcut, screen, shell } = require('electron');
const path = require('path');

// Import our modules
const SystemTray = require('./modules/system-tray');
const PermissionManager = require('./modules/permission-manager');
const ConnectionManager = require('./modules/connection-manager');
const ScreenCapture = require('./modules/screen-capture');
const InputControl = require('./modules/input-control');
const BrowserBridge = require('./modules/browser-bridge');

class BloomDesktopApp {
  constructor() {
    this.mainWindow = null;
    this.permissionWindow = null;
    this.watchWindow = null;
    this.systemTray = null;
    this.connectionManager = null;
    this.screenCapture = null;
    this.inputControl = null;
    this.permissionManager = null;
    this.isConnected = false;
    this.hasPermission = false;
    this.sessionActive = false;
    this.browserBridge = null;
    this.dashboardBridge = null;
    this.glowOverlay = null;
    this._glowIdleTimer = null;
    this.sarahUrl = 'https://autonomous-sarah-rodriguez-production.up.railway.app';
  }

  async initialize() {
    // Set app name for macOS
    app.setName('BLOOM Desktop');

    // Handle app ready
    app.whenReady().then(() => {
      this.createMainWindow();
      this.setupSystemTray();
      this.setupGlobalShortcuts();
      this.setupIPC();
      this.initializeModules();

      // macOS: Re-open window when dock icon is clicked
      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
          this.createMainWindow();
        }
      });
    });

    // Handle window closed
    app.on('window-all-closed', () => {
      // Don't quit on macOS when all windows are closed
      if (process.platform !== 'darwin') {
        // On Windows/Linux, minimize to tray instead of quitting
        // app.quit();
      }
    });

    // Handle app quitting
    app.on('before-quit', (event) => {
      if (this.sessionActive) {
        event.preventDefault();
        this.showQuitConfirmation();
      } else {
        this.cleanup();
      }
    });
  }

  createMainWindow() {
    this.mainWindow = new BrowserWindow({
      width: 600,
      height: 500,
      minWidth: 500,
      minHeight: 400,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, 'preload.js')
      },
      icon: path.join(__dirname, 'assets/icon.png'),
      titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
      show: false
    });

    this.mainWindow.loadFile('renderer/index.html');

    // Show window when ready
    this.mainWindow.once('ready-to-show', () => {
      this.mainWindow.show();
    });

    // Handle window closed (minimize to tray instead of quit)
    this.mainWindow.on('close', (event) => {
      if (!app.isQuiting) {
        event.preventDefault();
        this.mainWindow.hide();

        // Show notification on first minimize
        if (!this.hasShownTrayNotification) {
          this.systemTray?.showNotification(
            'BLOOM Desktop',
            'App minimized to system tray. Click the tray icon to reopen.'
          );
          this.hasShownTrayNotification = true;
        }
      }
    });

    // Development mode
    if (process.argv.includes('--dev')) {
      this.mainWindow.webContents.openDevTools();
    }
  }

  createPermissionWindow(agentName, reason) {
    this.permissionWindow = new BrowserWindow({
      width: 500,
      height: 350,
      resizable: false,
      minimizable: false,
      maximizable: false,
      alwaysOnTop: true,
      modal: true,
      parent: this.mainWindow,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, 'preload.js')
      },
      icon: path.join(__dirname, 'assets/icon.png')
    });

    this.permissionWindow.loadFile('renderer/permission-dialog.html');

    // Send agent info to permission dialog
    this.permissionWindow.once('ready-to-show', () => {
      this.permissionWindow.show();
      this.permissionWindow.webContents.send('set-permission-data', {
        agentName,
        reason
      });
    });

    this.permissionWindow.on('closed', () => {
      this.permissionWindow = null;
    });

    return this.permissionWindow;
  }

  createWatchWindow() {
    this.watchWindow = new BrowserWindow({
      width: 900,
      height: 700,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, 'preload.js')
      },
      icon: path.join(__dirname, 'assets/icon.png')
    });

    // Create simple HTML for watch window
    const watchHTML = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>BLOOM Desktop - Live Session</title>
        <style>
          body {
            margin: 0;
            padding: 0;
            background: #1a1a1a;
            color: #fff;
            font-family: -apple-system, BlinkMacSystemFont, sans-serif;
          }
          .header {
            background: #dc2626;
            padding: 10px 20px;
            display: flex;
            justify-content: space-between;
            align-items: center;
          }
          .live-indicator {
            display: flex;
            align-items: center;
            gap: 10px;
          }
          .live-dot {
            width: 10px;
            height: 10px;
            background: white;
            border-radius: 50%;
            animation: blink 1s infinite;
          }
          @keyframes blink { 0%, 50% { opacity: 1; } 51%, 100% { opacity: 0.3; } }
          .stop-btn {
            background: rgba(255,255,255,0.2);
            border: 1px solid rgba(255,255,255,0.3);
            color: white;
            padding: 8px 16px;
            border-radius: 4px;
            cursor: pointer;
          }
          .stop-btn:hover { background: rgba(255,255,255,0.3); }
          .screen-container {
            padding: 20px;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: calc(100vh - 120px);
          }
          #screen-view {
            max-width: 100%;
            max-height: calc(100vh - 120px);
            border: 2px solid #333;
            border-radius: 8px;
          }
          .info-bar {
            background: #333;
            padding: 10px 20px;
            display: flex;
            justify-content: space-between;
            color: #ccc;
            font-size: 14px;
          }
        </style>
      </head>
      <body>
        <div class="header">
          <div class="live-indicator">
            <div class="live-dot"></div>
            <span>LIVE — <span id="agent-name">Agent</span> is working</span>
          </div>
          <button class="stop-btn" onclick="stopSession()">Stop Session</button>
        </div>
        <div class="screen-container">
          <canvas id="screen-view"></canvas>
        </div>
        <div class="info-bar">
          <span>Duration: <span id="duration">00:00</span></span>
          <span id="task-info">Task: Working on your computer</span>
        </div>
        <script>
          let startTime = Date.now();

          function updateDuration() {
            const elapsed = Math.floor((Date.now() - startTime) / 1000);
            const minutes = Math.floor(elapsed / 60);
            const seconds = elapsed % 60;
            document.getElementById('duration').textContent =
              minutes.toString().padStart(2, '0') + ':' + seconds.toString().padStart(2, '0');
          }

          setInterval(updateDuration, 1000);

          function stopSession() {
            window.electronAPI?.revokePermission('User clicked stop');
          }
        </script>
      </body>
      </html>
    `;

    this.watchWindow.loadURL('data:text/html,' + encodeURIComponent(watchHTML));

    this.watchWindow.on('closed', () => {
      this.watchWindow = null;
    });

    return this.watchWindow;
  }

  setupSystemTray() {
    this.systemTray = new SystemTray(this.mainWindow, () => {
      app.isQuiting = true;
      app.quit();
    });
  }

  setupGlobalShortcuts() {
    // Emergency stop shortcut
    const emergencyShortcut = process.platform === 'darwin' ? 'Command+Shift+Escape' : 'Control+Shift+Escape';

    globalShortcut.register(emergencyShortcut, () => {
      if (this.sessionActive) {
        this.revokePermission('Emergency stop activated');
      }
    });
  }

  setupIPC() {
    // Handle connection request
    ipcMain.handle('connect', async (event, connectionCode) => {
      try {
        // Parse connection code (format: agent-url:token)
        const lastColonIndex = connectionCode.lastIndexOf(':');
        if (lastColonIndex === -1) {
          throw new Error('Invalid connection code format: expected agent-url:token');
        }
        const agentUrl = connectionCode.substring(0, lastColonIndex);
        const token = connectionCode.substring(lastColonIndex + 1);
        if (!agentUrl || !token) {
          throw new Error('Invalid connection code format: expected agent-url:token');
        }

        // Initialize connection manager
        this.connectionManager = new ConnectionManager(agentUrl, token);

        // Set up connection event handlers
        this.connectionManager.on('auth_success', (data) => {
          this.isConnected = true;
          this.agentName = data.agentName;
          this.systemTray?.updateStatus(true, data.agentName);
          this.mainWindow?.webContents.send('connection-status', {
            connected: true,
            agentName: data.agentName
          });
        });

        this.connectionManager.on('auth_failed', (data) => {
          this.mainWindow?.webContents.send('connection-error', data.reason);
        });

        this.connectionManager.on('permission_request', (data) => {
          this.handlePermissionRequest(data.reason);
        });

        this.connectionManager.on('command', (data) => {
          if (this.hasPermission) {
            this.inputControl.execute(data);
          }
        });

        this.connectionManager.on('session_end', () => {
          this.revokePermission('Session ended by agent');
        });

        this.connectionManager.on('permission_granted', (data) => {
          console.log('Permission granted by user:', data);
          this.mainWindow?.webContents.send('permission-granted', data);
        });

        this.connectionManager.on('session_start', (data) => {
          console.log('Session started:', data);
          this.mainWindow?.webContents.send('session-start', data);
        });

        this.connectionManager.on('disconnect', () => {
          this.isConnected = false;
          this.systemTray?.updateStatus(false, null);
          this.mainWindow?.webContents.send('connection-status', { connected: false });
          this.mainWindow?.webContents.send('connection-lost');
        });

        await this.connectionManager.connect();
        return { success: true };
      } catch (error) {
        return { success: false, error: error.message };
      }
    });

    // Handle permission responses
    ipcMain.handle('grant-permission', async (event, watchLive = false) => {
      this.hasPermission = true;
      this.sessionActive = true;
      this.watchLive = watchLive;

      if (this.permissionWindow) {
        this.permissionWindow.close();
      }

      // Start screen capture
      this.screenCapture = new ScreenCapture(this.connectionManager);
      await this.screenCapture.start();

      // Create watch window if requested
      if (watchLive) {
        this.createWatchWindow();
      }

      // Notify agent
      this.connectionManager?.send({ type: 'permission_granted', watchLive });

      return { success: true };
    });

    ipcMain.handle('deny-permission', async () => {
      if (this.permissionWindow) {
        this.permissionWindow.close();
      }
      this.connectionManager?.send({ type: 'permission_denied' });
      return { success: true };
    });

    ipcMain.handle('revoke-permission', async (event, reason = 'User revoked') => {
      this.revokePermission(reason);
      return { success: true };
    });

    // Handle disconnect
    ipcMain.handle('disconnect', async () => {
      if (this.sessionActive) {
        this.revokePermission('User disconnected');
      }

      this.connectionManager?.disconnect();
      this.isConnected = false;
      this.systemTray?.updateStatus(false, null);

      return { success: true };
    });
  }

  initializeModules() {
    this.inputControl = new InputControl();
    this.permissionManager = new PermissionManager();

    // BrowserBridge owns its own DashboardBridge internally — just start it
    this.browserBridge = new BrowserBridge();
    this.browserBridge.start().catch(err => {
      console.warn('[BloomApp] BrowserBridge start failed (non-fatal):', err.message);
    });
    this.dashboardBridge = this.browserBridge.dashboardBridge;

    // Show glow overlay when frames are being pushed to Sarah
    if (this.dashboardBridge) {
      this.dashboardBridge.on('frame-sent', () => {
        this.showGlowOverlay();
        clearTimeout(this._glowIdleTimer);
        this._glowIdleTimer = setTimeout(() => this.hideGlowOverlay(), 8000);
      });
    }

    // Create glow overlay window
    this.createGlowOverlay();

    // DEV MODE: auto-trigger glow after 3s so you can visually verify it
    if (process.argv.includes('--dev')) {
      console.log('[DEV] Glow test scheduled — fires in 3s');
      setTimeout(() => {
        console.log('[DEV] Firing glow overlay now');
        this.showGlowOverlay();
        console.log('[DEV] glowOverlay window:', this.glowOverlay ? 'created' : 'NULL');
        console.log('[DEV] glowOverlay visible:', this.glowOverlay?.isVisible());
        console.log('[DEV] glowOverlay bounds:', this.glowOverlay?.getBounds());
        setTimeout(() => {
          console.log('[DEV] Hiding glow overlay');
          this.hideGlowOverlay();
        }, 12000);
      }, 3000);
    }

    // Bridge status IPC
    ipcMain.handle('bridge-status', () => ({
      running: !!this.browserBridge,
      sarahUrl: this.sarahUrl,
      captureActive: !!this.dashboardBridge,
      dashboardBridge: !!this.dashboardBridge,
      browserConnected: this.browserBridge?.isConnected?.() ?? false,
    }));

    ipcMain.handle('test-dashboard', async () => {
      try {
        const result = await this.dashboardBridge?.testConnection();
        return result ?? { success: false, error: 'No dashboard bridge' };
      } catch (e) {
        return { success: false, error: e.message };
      }
    });

    ipcMain.handle('set-sarah-url', (event, url) => {
      this.sarahUrl = url;
      return { ok: true };
    });

    // Glow overlay IPC
    ipcMain.handle('glow-show', () => { this.showGlowOverlay(); return { ok: true }; });
    ipcMain.handle('glow-hide', () => { this.hideGlowOverlay(); return { ok: true }; });

    // Open external URLs
    ipcMain.handle('open-external', (event, url) => shell.openExternal(url));
  }

  handlePermissionRequest(reason) {
    // Show system notification
    this.systemTray?.showNotification(
      `${this.agentName} wants to access your screen`,
      reason
    );

    // Create and show permission dialog
    this.createPermissionWindow(this.agentName, reason);

    // Bring app to foreground
    if (this.mainWindow) {
      this.mainWindow.show();
    }
  }

  revokePermission(reason) {
    this.hasPermission = false;
    this.sessionActive = false;

    // Stop screen capture
    if (this.screenCapture) {
      this.screenCapture.stop();
      this.screenCapture = null;
    }

    // Close watch window
    if (this.watchWindow) {
      this.watchWindow.close();
    }

    // Notify agent
    this.connectionManager?.send({
      type: 'permission_revoked',
      reason
    });

    // Update UI
    this.mainWindow?.webContents.send('permission-revoked', reason);
  }

  showQuitConfirmation() {
    dialog.showMessageBox(this.mainWindow, {
      type: 'warning',
      title: 'Active Session',
      message: 'You have an active session with your AI agent.',
      detail: 'Are you sure you want to quit? This will disconnect your agent.',
      buttons: ['Cancel', 'Quit Anyway'],
      defaultId: 0,
      cancelId: 0
    }).then(result => {
      if (result.response === 1) {
        app.isQuiting = true;
        this.cleanup();
        app.quit();
      }
    });
  }

  createGlowOverlay() {
    const display = screen.getPrimaryDisplay();
    const { width, height, x, y } = display.bounds;
    console.log('[GlowOverlay] Creating — display bounds:', { width, height, x, y });

    this.glowOverlay = new BrowserWindow({
      x, y, width, height,
      transparent: true,
      backgroundColor: '#00000000',
      frame: false,
      alwaysOnTop: true,
      focusable: false,
      skipTaskbar: true,
      hasShadow: false,
      roundedCorners: false,
      type: 'panel',
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        backgroundThrottling: false,
      },
    });

    this.glowOverlay.setIgnoreMouseEvents(true);
    this.glowOverlay.setAlwaysOnTop(true, 'screen-saver');
    const overlayPath = path.join(__dirname, 'renderer/glow-overlay.html');
    console.log('[GlowOverlay] Loading file:', overlayPath);
    this.glowOverlay.loadFile(overlayPath);
    this.glowOverlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    this.glowOverlay.hide();
    console.log('[GlowOverlay] Created and hidden');

    this.glowOverlay.webContents.on('did-finish-load', () => {
      console.log('[GlowOverlay] HTML finished loading');
    });

    this.glowOverlay.on('closed', () => { this.glowOverlay = null; });
  }

  showGlowOverlay() {
    console.log('[GlowOverlay] showGlowOverlay called');
    if (!this.glowOverlay || this.glowOverlay.isDestroyed()) {
      console.log('[GlowOverlay] Recreating...');
      this.createGlowOverlay();
    }
    this.glowOverlay.showInactive();
    console.log('[GlowOverlay] showInactive called — visible:', this.glowOverlay.isVisible());
  }

  hideGlowOverlay() {
    if (this.glowOverlay && !this.glowOverlay.isDestroyed()) {
      this.glowOverlay.hide();
    }
  }

  cleanup() {
    // Revoke any active permissions
    if (this.sessionActive) {
      this.revokePermission('App shutting down');
    }

    // Disconnect from agent
    if (this.connectionManager) {
      this.connectionManager.disconnect();
    }

    // Unregister global shortcuts
    globalShortcut.unregisterAll();

    // Clean up system tray
    if (this.systemTray) {
      this.systemTray.destroy();
    }
  }
}

// Create and initialize the app
const bloomApp = new BloomDesktopApp();
global.bloomApp = bloomApp; // Make available globally for modules
bloomApp.initialize();

// Handle app activation (macOS)
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    bloomApp.createMainWindow();
  } else if (bloomApp.mainWindow) {
    bloomApp.mainWindow.show();
  }
});