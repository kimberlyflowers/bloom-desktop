const { desktopCapturer, screen } = require('electron');

class ScreenCapture {
  constructor(connectionManager, dashboardBridge = null) {
    this.connectionManager = connectionManager;
    this.dashboardBridge = dashboardBridge; // optional — push frames to Sarah's dashboard
    this.isCapturing = false;
    this.captureInterval = null;
    this.frameRate = 2; // fps
    this.quality = 0.7; // JPEG quality
    this.currentSource = null;
  }

  async start() {
    if (this.isCapturing) {
      return;
    }

    try {
      // Get the primary display
      const primaryDisplay = screen.getPrimaryDisplay();
      const { width, height } = primaryDisplay.bounds;

      // Get available sources (screens and windows)
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width, height }
      });

      if (sources.length === 0) {
        throw new Error('No screen sources available');
      }

      // Use the first screen source (primary display)
      this.currentSource = sources[0];

      console.log('Starting screen capture:', {
        sourceId: this.currentSource.id,
        sourceName: this.currentSource.name,
        dimensions: { width, height }
      });

      this.isCapturing = true;
      this.startCaptureLoop();

      return { success: true };
    } catch (error) {
      console.error('Failed to start screen capture:', error);
      throw error;
    }
  }

  startCaptureLoop() {
    const captureFrame = async () => {
      if (!this.isCapturing) {
        return;
      }

      try {
        // Get current screen sources
        const sources = await desktopCapturer.getSources({
          types: ['screen'],
          thumbnailSize: { width: 1920, height: 1080 }
        });

        const currentSource = sources.find(s => s.id === this.currentSource.id) || sources[0];

        if (currentSource && currentSource.thumbnail) {
          // Convert thumbnail to JPEG
          const jpegBuffer = currentSource.thumbnail.toJPEG(Math.floor(this.quality * 100));

          // Send frame to agent via WebSocket
          if (this.connectionManager && this.connectionManager.isConnected()) {
            this.connectionManager.sendFrame(jpegBuffer);
          }

          // Push frame to Sarah's dashboard (Screen Viewer)
          if (this.dashboardBridge) {
            // Get current URL from the Electron window if available (best-effort)
            const currentUrl = this._getCurrentBrowserUrl();
            this.dashboardBridge.receiveFrame(jpegBuffer, currentUrl);
          }

          // Also send to watch window if exists
          if (global.bloomApp && global.bloomApp.watchWindow) {
            const base64 = jpegBuffer.toString('base64');
            global.bloomApp.watchWindow.webContents.send('screen-frame', {
              data: base64,
              timestamp: Date.now()
            });
          }
        }
      } catch (error) {
        console.error('Screen capture frame error:', error);
      }

      // Schedule next frame
      if (this.isCapturing) {
        setTimeout(captureFrame, 1000 / this.frameRate);
      }
    };

    // Start the capture loop
    captureFrame();
  }

  stop() {
    console.log('Stopping screen capture');
    this.isCapturing = false;

    if (this.captureInterval) {
      clearInterval(this.captureInterval);
      this.captureInterval = null;
    }

    this.currentSource = null;

    // Tell dashboard the screen is idle
    if (this.dashboardBridge) {
      this.dashboardBridge.sendIdle();
    }
  }

  /** Let main.js inject or replace the bridge after init */
  setDashboardBridge(bridge) {
    this.dashboardBridge = bridge;
  }

  /** Best-effort: get the URL of whatever Electron BrowserWindow is focused */
  _getCurrentBrowserUrl() {
    try {
      const { BrowserWindow } = require('electron');
      const focused = BrowserWindow.getFocusedWindow();
      if (focused && focused.webContents) {
        return focused.webContents.getURL();
      }
    } catch {}
    return '';
  }

  updateSettings(settings) {
    if (settings.frameRate && settings.frameRate > 0 && settings.frameRate <= 30) {
      this.frameRate = settings.frameRate;
    }

    if (settings.quality && settings.quality > 0 && settings.quality <= 1) {
      this.quality = settings.quality;
    }

    console.log('Screen capture settings updated:', {
      frameRate: this.frameRate,
      quality: this.quality
    });
  }

  getStatus() {
    return {
      isCapturing: this.isCapturing,
      frameRate: this.frameRate,
      quality: this.quality,
      currentSource: this.currentSource ? {
        id: this.currentSource.id,
        name: this.currentSource.name
      } : null
    };
  }

  async getAvailableSources() {
    try {
      const sources = await desktopCapturer.getSources({
        types: ['screen', 'window'],
        thumbnailSize: { width: 300, height: 200 }
      });

      return sources.map(source => ({
        id: source.id,
        name: source.name,
        thumbnail: source.thumbnail.toDataURL()
      }));
    } catch (error) {
      console.error('Failed to get available sources:', error);
      return [];
    }
  }

  async switchSource(sourceId) {
    try {
      const sources = await desktopCapturer.getSources({
        types: ['screen', 'window']
      });

      const newSource = sources.find(s => s.id === sourceId);
      if (newSource) {
        this.currentSource = newSource;
        console.log('Switched to source:', newSource.name);
        return { success: true };
      } else {
        throw new Error('Source not found');
      }
    } catch (error) {
      console.error('Failed to switch source:', error);
      throw error;
    }
  }
}

module.exports = ScreenCapture;