// BLOOM Desktop - Renderer App Logic
class BloomRenderer {
  constructor() {
    this.isConnected = false;
    this.agentName = '';
    this.jadenHasControl = false;
    this.setupEventListeners();
    this.initializeUI();
  }

  initializeUI() {
    // Set emergency key based on platform
    const emergencyKey = document.getElementById('emergency-key');
    if (emergencyKey) {
      emergencyKey.textContent = window.electronAPI.platform === 'darwin'
        ? 'Cmd+Shift+Esc'
        : 'Ctrl+Shift+Esc';
    }

    // Show setup screen initially
    this.showScreen('setup-screen');
  }

  // Coral Glow Border Methods - Visual indicator when Jaden has control
  showJadenControl() {
    this.jadenHasControl = true;
    const border = document.getElementById('jaden-control-border');
    const indicator = document.getElementById('jaden-status-indicator');

    if (border) {
      border.classList.add('active');
    }

    if (indicator) {
      const statusText = indicator.querySelector('.status-text');
      if (statusText) {
        statusText.textContent = `${this.agentName || 'Jaden'} is controlling your desktop`;
      }
      indicator.classList.add('active');
    }

    console.log('Jaden control border activated');
  }

  hideJadenControl() {
    this.jadenHasControl = false;
    const border = document.getElementById('jaden-control-border');
    const indicator = document.getElementById('jaden-status-indicator');

    if (border) {
      border.classList.remove('active');
    }

    if (indicator) {
      indicator.classList.remove('active');
    }

    console.log('Jaden control border deactivated');
  }

  setupEventListeners() {
    // Connection form
    const connectBtn = document.getElementById('connect-btn');
    const connectionInput = document.getElementById('connection-code');
    const disconnectBtn = document.getElementById('disconnect-btn');

    // Connect button
    connectBtn?.addEventListener('click', () => this.handleConnect());

    // Allow Enter key to trigger connection
    connectionInput?.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        this.handleConnect();
      }
    });

    // Disconnect button
    disconnectBtn?.addEventListener('click', () => this.handleDisconnect());

    // Modal controls
    const viewLogBtn = document.getElementById('view-log-btn');
    const closeLogBtn = document.getElementById('close-log-btn');
    const logModal = document.getElementById('log-modal');

    viewLogBtn?.addEventListener('click', () => {
      logModal.style.display = 'flex';
      this.loadSessionLog();
    });

    closeLogBtn?.addEventListener('click', () => {
      logModal.style.display = 'none';
    });

    // Close modal when clicking outside
    logModal?.addEventListener('click', (e) => {
      if (e.target === logModal) {
        logModal.style.display = 'none';
      }
    });

    // Session control
    const stopSessionBtn = document.getElementById('stop-session-btn');
    stopSessionBtn?.addEventListener('click', () => this.handleStopSession());

    // Listen for main process events
    this.setupIPCListeners();
  }

  setupIPCListeners() {
    // Connection status updates
    window.electronAPI.onConnectionStatus((event, status) => {
      if (status.connected) {
        this.isConnected = true;
        this.agentName = status.agentName;
        this.showConnectedState();
      } else {
        this.isConnected = false;
        this.agentName = '';
        this.showDisconnectedState();
      }
    });

    // Connection errors
    window.electronAPI.onConnectionError((event, error) => {
      this.showConnectionError(error);
      this.hideConnectionLoading();
    });

    // Permission revoked - hide Jaden control border
    window.electronAPI.onPermissionRevoked((event, reason) => {
      this.hideSessionStatus();
      this.hideJadenControl();
      this.showNotification('Session ended', reason);
    });

    // Permission granted - show Jaden control border
    window.electronAPI.onPermissionGranted((event, data) => {
      console.log('Permission granted:', data);
      this.showJadenControl();
      this.showNotification('Session started', `${this.agentName || 'Agent'} now has desktop control`);
    });

    // Session start - ensure Jaden control border is visible
    window.electronAPI.onSessionStart((event, data) => {
      console.log('Session started:', data);
      this.showJadenControl();
    });

    // Connection lost - hide Jaden control border
    window.electronAPI.onConnectionLost((event) => {
      this.hideJadenControl();
      this.showDisconnectedState();
    });
  }

  async handleConnect() {
    const connectionInput = document.getElementById('connection-code');
    const connectionCode = connectionInput?.value.trim();

    if (!connectionCode) {
      this.showConnectionError('Please enter a connection code');
      return;
    }

    // Validate connection code format
    if (!connectionCode.includes(':')) {
      this.showConnectionError('Invalid connection code format. Expected: agent-url:token');
      return;
    }

    this.showConnectionLoading();
    this.hideConnectionError();

    try {
      const result = await window.electronAPI.connect(connectionCode);

      if (!result.success) {
        this.showConnectionError(result.error || 'Connection failed');
        this.hideConnectionLoading();
      }
      // Success will be handled by connection status event
    } catch (error) {
      console.error('Connection error:', error);
      this.showConnectionError('Failed to connect to agent');
      this.hideConnectionLoading();
    }
  }

  async handleDisconnect() {
    try {
      await window.electronAPI.disconnect();
      this.showScreen('setup-screen');
      this.clearConnectionForm();
    } catch (error) {
      console.error('Disconnect error:', error);
    }
  }

  async handleStopSession() {
    try {
      await window.electronAPI.revokePermission('User stopped session');
    } catch (error) {
      console.error('Stop session error:', error);
    }
  }

  showScreen(screenId) {
    // Hide all screens
    document.querySelectorAll('.screen').forEach(screen => {
      screen.classList.remove('active');
    });

    // Show target screen
    const targetScreen = document.getElementById(screenId);
    if (targetScreen) {
      targetScreen.classList.add('active');
    }
  }

  showConnectedState() {
    // Update agent name displays
    const agentNameElements = [
      document.getElementById('agent-name'),
      document.getElementById('connected-agent-name')
    ];

    agentNameElements.forEach(element => {
      if (element) {
        element.textContent = this.agentName;
      }
    });

    // Show connected screen
    this.showScreen('connected-screen');
    this.hideConnectionLoading();
    this.hideConnectionError();
  }

  showDisconnectedState() {
    this.showScreen('setup-screen');
    this.hideSessionStatus();
    this.clearConnectionForm();
  }

  showConnectionLoading() {
    const loadingElement = document.getElementById('connection-loading');
    const connectBtn = document.getElementById('connect-btn');

    if (loadingElement) loadingElement.style.display = 'flex';
    if (connectBtn) connectBtn.disabled = true;
  }

  hideConnectionLoading() {
    const loadingElement = document.getElementById('connection-loading');
    const connectBtn = document.getElementById('connect-btn');

    if (loadingElement) loadingElement.style.display = 'none';
    if (connectBtn) connectBtn.disabled = false;
  }

  showConnectionError(message) {
    const errorElement = document.getElementById('connection-error');
    if (errorElement) {
      errorElement.textContent = message;
      errorElement.style.display = 'block';
    }
  }

  hideConnectionError() {
    const errorElement = document.getElementById('connection-error');
    if (errorElement) {
      errorElement.style.display = 'none';
    }
  }

  showSessionStatus() {
    const sessionStatus = document.getElementById('session-status');
    if (sessionStatus) {
      sessionStatus.style.display = 'flex';
    }
  }

  hideSessionStatus() {
    const sessionStatus = document.getElementById('session-status');
    if (sessionStatus) {
      sessionStatus.style.display = 'none';
    }
  }

  clearConnectionForm() {
    const connectionInput = document.getElementById('connection-code');
    if (connectionInput) {
      connectionInput.value = '';
    }
    this.hideConnectionError();
    this.hideConnectionLoading();
  }

  loadSessionLog() {
    // For now, show placeholder data
    // In a real implementation, this would load actual session data
    const logContent = document.getElementById('session-log-content');
    const logEmpty = document.querySelector('.log-empty');

    if (logContent && logEmpty) {
      // Show empty state for now
      logContent.innerHTML = '';
      logEmpty.style.display = 'block';
      logContent.appendChild(logEmpty);
    }
  }

  showNotification(title, message) {
    // Simple notification - could be enhanced with a proper notification system
    console.log(`${title}: ${message}`);
  }

  // Utility method to format time
  formatTime(date) {
    return new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    }).format(date);
  }

  // Utility method to format duration
  formatDuration(seconds) {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  }
}

// Initialize the app when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  new BloomRenderer();
});

// Handle keyboard shortcuts
document.addEventListener('keydown', (e) => {
  // Escape key to close modal
  if (e.key === 'Escape') {
    const logModal = document.getElementById('log-modal');
    if (logModal && logModal.style.display === 'flex') {
      logModal.style.display = 'none';
    }
  }
});