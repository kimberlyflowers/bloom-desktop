const { Tray, Menu, nativeImage, Notification } = require('electron');
const path = require('path');

class SystemTray {
  constructor(mainWindow, onQuit) {
    this.mainWindow = mainWindow;
    this.onQuit = onQuit;
    this.tray = null;
    this.isConnected = false;
    this.agentName = null;
    this.hasActiveSession = false;

    this.createTray();
  }

  createTray() {
    // Create tray icon
    const iconPath = this.getIconPath();

    try {
      const icon = nativeImage.createFromPath(iconPath);
      this.tray = new Tray(icon.resize({ width: 16, height: 16 }));
    } catch (error) {
      // Fallback to text-based tray if icon fails
      console.warn('Failed to load tray icon, using text fallback');
      this.tray = new Tray(nativeImage.createEmpty());
    }

    // Set initial tooltip
    this.tray.setToolTip('BLOOM Desktop - Disconnected');

    // Handle tray click (show/hide window)
    this.tray.on('click', () => {
      if (this.mainWindow.isVisible()) {
        this.mainWindow.hide();
      } else {
        this.mainWindow.show();
        this.mainWindow.focus();
      }
    });

    // Handle right-click (show context menu)
    this.tray.on('right-click', () => {
      this.showContextMenu();
    });

    // Initial context menu
    this.updateContextMenu();
  }

  getIconPath() {
    const iconName = process.platform === 'darwin' ? 'icon-tray.png' : 'icon-tray.ico';
    return path.join(__dirname, '..', 'assets', iconName);
  }

  updateStatus(connected, agentName = null) {
    this.isConnected = connected;
    this.agentName = agentName;

    // Update tooltip
    if (connected && agentName) {
      this.tray.setToolTip(`BLOOM Desktop - Connected to ${agentName}`);
    } else {
      this.tray.setToolTip('BLOOM Desktop - Disconnected');
    }

    // Update context menu
    this.updateContextMenu();

    // Update tray icon if available
    this.updateTrayIcon();
  }

  updateTrayIcon() {
    try {
      const iconPath = this.getIconPath();
      let icon = nativeImage.createFromPath(iconPath);

      if (icon.isEmpty()) {
        // Create a simple colored icon as fallback
        icon = nativeImage.createEmpty();
      }

      // Resize for tray
      icon = icon.resize({ width: 16, height: 16 });

      // Add status indicator (green dot for connected, red for disconnected)
      if (this.isConnected) {
        // Add green overlay for connected status
        this.tray.setImage(icon);
      } else {
        // Use default icon for disconnected
        this.tray.setImage(icon);
      }
    } catch (error) {
      console.warn('Failed to update tray icon:', error);
    }
  }

  updateContextMenu() {
    const template = [
      {
        label: 'BLOOM Desktop',
        type: 'normal',
        enabled: false
      },
      { type: 'separator' },
      {
        label: this.isConnected ? `Connected to ${this.agentName}` : 'Disconnected',
        type: 'normal',
        enabled: false,
        icon: this.isConnected ? this.createStatusIcon('green') : this.createStatusIcon('red')
      }
    ];

    // Add session-specific items if connected
    if (this.isConnected) {
      template.push({ type: 'separator' });

      if (this.hasActiveSession) {
        template.push({
          label: 'Active Session',
          type: 'normal',
          enabled: false,
          icon: this.createStatusIcon('orange')
        });
        template.push({
          label: 'Stop Session',
          type: 'normal',
          click: () => {
            if (global.bloomApp) {
              global.bloomApp.revokePermission('Stopped from system tray');
            }
          }
        });
      } else {
        template.push({
          label: 'Ready',
          type: 'normal',
          enabled: false
        });
      }
    }

    // Common menu items
    template.push(
      { type: 'separator' },
      {
        label: 'Show BLOOM Desktop',
        type: 'normal',
        click: () => {
          this.mainWindow.show();
          this.mainWindow.focus();
        }
      }
    );

    // Platform-specific items
    if (process.platform === 'darwin') {
      template.push({
        label: 'Hide BLOOM Desktop',
        type: 'normal',
        accelerator: 'Command+H',
        click: () => {
          this.mainWindow.hide();
        }
      });
    }

    template.push(
      { type: 'separator' },
      {
        label: 'About BLOOM Desktop',
        type: 'normal',
        click: () => {
          this.showAbout();
        }
      },
      {
        label: 'Quit',
        type: 'normal',
        accelerator: process.platform === 'darwin' ? 'Command+Q' : 'Ctrl+Q',
        click: this.onQuit
      }
    );

    const contextMenu = Menu.buildFromTemplate(template);
    this.tray.setContextMenu(contextMenu);
  }

  createStatusIcon(color) {
    try {
      // Create a small colored circle as status indicator
      const size = 16;
      const canvas = require('canvas').createCanvas(size, size);
      const ctx = canvas.getContext('2d');

      // Set color
      ctx.fillStyle = color === 'green' ? '#10b981' :
                     color === 'red' ? '#ef4444' :
                     '#f59e0b'; // orange

      // Draw circle
      ctx.beginPath();
      ctx.arc(size / 2, size / 2, size / 3, 0, 2 * Math.PI);
      ctx.fill();

      // Convert to native image
      return nativeImage.createFromBuffer(canvas.toBuffer());
    } catch (error) {
      // Fallback if canvas is not available
      return nativeImage.createEmpty();
    }
  }

  setSessionStatus(active) {
    this.hasActiveSession = active;
    this.updateContextMenu();
  }

  showNotification(title, body, options = {}) {
    if (!Notification.isSupported()) {
      console.log('Notifications not supported');
      return null;
    }

    try {
      const notification = new Notification({
        title,
        body,
        icon: path.join(__dirname, '..', 'assets', 'icon.png'),
        silent: options.silent || false,
        ...options
      });

      notification.show();

      // Handle notification click
      notification.on('click', () => {
        this.mainWindow.show();
        this.mainWindow.focus();
      });

      return notification;
    } catch (error) {
      console.error('Failed to show notification:', error);
      return null;
    }
  }

  showContextMenu() {
    this.updateContextMenu();
    this.tray.popUpContextMenu();
  }

  showAbout() {
    const { dialog } = require('electron');
    const packageJson = require('../../package.json');

    dialog.showMessageBox(this.mainWindow, {
      type: 'info',
      title: 'About BLOOM Desktop',
      message: 'BLOOM Desktop',
      detail: `Version ${packageJson.version}\n\n${packageJson.description}\n\nLet your AI employee work on your computer with permission.`,
      buttons: ['OK']
    });
  }

  flash() {
    // Flash the tray icon to get attention
    let flashes = 0;
    const maxFlashes = 6;

    const flashInterval = setInterval(() => {
      const visible = flashes % 2 === 0;

      if (visible) {
        this.tray.setImage(this.getIconPath());
      } else {
        this.tray.setImage(nativeImage.createEmpty());
      }

      flashes++;

      if (flashes >= maxFlashes) {
        clearInterval(flashInterval);
        // Restore normal icon
        this.updateTrayIcon();
      }
    }, 200);
  }

  // Balloon tooltip for Windows
  displayBalloon(title, content, icon = 'info') {
    if (process.platform === 'win32' && this.tray.displayBalloon) {
      this.tray.displayBalloon({
        title,
        content,
        icon: icon === 'info' ? 'info' : 'warning'
      });
    } else {
      // Fallback to regular notification
      this.showNotification(title, content);
    }
  }

  destroy() {
    if (this.tray) {
      this.tray.destroy();
      this.tray = null;
    }
  }

  getTrayStatus() {
    return {
      isConnected: this.isConnected,
      agentName: this.agentName,
      hasActiveSession: this.hasActiveSession,
      isDestroyed: !this.tray
    };
  }
}

module.exports = SystemTray;