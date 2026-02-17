const WebSocket = require('ws');
const EventEmitter = require('events');

class ConnectionManager extends EventEmitter {
  constructor(agentUrl, token) {
    super();
    this.agentUrl = agentUrl;
    this.token = token;
    this.ws = null;
    this.isConnected = false;
    this.isAuthenticated = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectDelay = 1000; // ms
    this.heartbeatInterval = null;
    this.heartbeatTimeout = null;
    this.messageQueue = [];

    console.log('ConnectionManager initialized:', { agentUrl, token: '***' });
  }

  async connect() {
    return new Promise((resolve, reject) => {
      try {
        console.log('Connecting to agent:', this.agentUrl);

        // Create WebSocket connection
        this.ws = new WebSocket(this.agentUrl);

        // Connection opened
        this.ws.on('open', () => {
          console.log('WebSocket connected');
          this.isConnected = true;
          this.reconnectAttempts = 0;

          // Send authentication
          this.send({
            type: 'auth',
            token: this.token,
            clientType: 'desktop',
            platform: process.platform,
            version: require('../../package.json').version
          });

          // Start heartbeat
          this.startHeartbeat();
        });

        // Handle messages
        this.ws.on('message', (data) => {
          try {
            const message = JSON.parse(data);
            this.handleMessage(message);

            // Resolve connection promise on successful auth
            if (message.type === 'auth_success' && !this.isAuthenticated) {
              this.isAuthenticated = true;
              resolve({ success: true });
            } else if (message.type === 'auth_failed') {
              reject(new Error(message.reason || 'Authentication failed'));
            }
          } catch (error) {
            console.error('Failed to parse message:', error);
          }
        });

        // Handle connection errors
        this.ws.on('error', (error) => {
          console.error('WebSocket error:', error);
          if (!this.isAuthenticated) {
            reject(error);
          }
          this.emit('error', error);
        });

        // Handle connection close
        this.ws.on('close', (code, reason) => {
          console.log('WebSocket closed:', code, reason?.toString());
          this.handleDisconnection(code);
        });

        // Connection timeout
        setTimeout(() => {
          if (!this.isAuthenticated) {
            reject(new Error('Connection timeout'));
          }
        }, 10000); // 10 second timeout

      } catch (error) {
        console.error('Failed to create WebSocket:', error);
        reject(error);
      }
    });
  }

  handleMessage(message) {
    console.log('Received message:', message.type, message);

    switch (message.type) {
      case 'auth_success':
        console.log('Authentication successful');
        this.isAuthenticated = true;
        this.emit('auth_success', {
          agentName: message.agentName,
          permissions: message.permissions
        });
        break;

      case 'auth_failed':
        console.error('Authentication failed:', message.reason);
        this.isAuthenticated = false;
        this.emit('auth_failed', {
          reason: message.reason
        });
        break;

      case 'permission_request':
        console.log('Permission request:', message.reason);
        this.emit('permission_request', {
          reason: message.reason,
          sessionId: message.sessionId
        });
        break;

      case 'command':
        console.log('Command received:', message.action);
        this.emit('command', {
          action: message.action,
          data: message.data,
          commandId: message.commandId
        });
        break;

      case 'session_start':
        console.log('Session started:', message.sessionId);
        this.emit('session_start', {
          sessionId: message.sessionId,
          task: message.task
        });
        break;

      case 'session_end':
        console.log('Session ended:', message.reason);
        this.emit('session_end', {
          reason: message.reason,
          summary: message.summary
        });
        break;

      case 'heartbeat':
        // Respond to heartbeat
        this.send({ type: 'heartbeat_response' });
        break;

      case 'error':
        console.error('Server error:', message.error);
        this.emit('error', new Error(message.error));
        break;

      case 'notification':
        console.log('Notification:', message.message);
        this.emit('notification', {
          message: message.message,
          level: message.level || 'info'
        });
        break;

      default:
        console.warn('Unknown message type:', message.type);
    }
  }

  send(message) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.log('WebSocket not ready, queueing message:', message.type);
      this.messageQueue.push(message);
      return false;
    }

    try {
      const payload = JSON.stringify(message);
      this.ws.send(payload);
      console.log('Sent message:', message.type);
      return true;
    } catch (error) {
      console.error('Failed to send message:', error);
      return false;
    }
  }

  sendFrame(frameBuffer) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.isAuthenticated) {
      return false;
    }

    try {
      // Send binary frame data
      this.ws.send(frameBuffer);
      return true;
    } catch (error) {
      console.error('Failed to send frame:', error);
      return false;
    }
  }

  sendCommandResponse(commandId, success, result = null, error = null) {
    this.send({
      type: 'command_response',
      commandId,
      success,
      result,
      error
    });
  }

  handleDisconnection(code) {
    this.isConnected = false;
    this.isAuthenticated = false;

    // Clear heartbeat
    this.stopHeartbeat();

    // Emit disconnect event
    this.emit('disconnect', { code });

    // Attempt reconnection for certain close codes
    if (code !== 1000 && code !== 1001 && this.reconnectAttempts < this.maxReconnectAttempts) {
      console.log(`Attempting reconnection (${this.reconnectAttempts + 1}/${this.maxReconnectAttempts})`);
      setTimeout(() => {
        this.reconnectAttempts++;
        this.connect().catch(error => {
          console.error('Reconnection failed:', error);
        });
      }, this.reconnectDelay);
    }
  }

  startHeartbeat() {
    this.heartbeatInterval = setInterval(() => {
      if (this.isConnected && this.isAuthenticated) {
        this.send({ type: 'heartbeat' });

        // Set timeout for heartbeat response
        this.heartbeatTimeout = setTimeout(() => {
          console.warn('Heartbeat timeout');
          this.ws?.close(1000, 'Heartbeat timeout');
        }, 5000);
      }
    }, 30000); // Send heartbeat every 30 seconds
  }

  stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    if (this.heartbeatTimeout) {
      clearTimeout(this.heartbeatTimeout);
      this.heartbeatTimeout = null;
    }
  }

  flushMessageQueue() {
    while (this.messageQueue.length > 0) {
      const message = this.messageQueue.shift();
      if (!this.send(message)) {
        // If send fails, put message back at front of queue
        this.messageQueue.unshift(message);
        break;
      }
    }
  }

  disconnect() {
    console.log('Disconnecting from agent');

    // Clear reconnection attempts
    this.maxReconnectAttempts = 0;

    // Stop heartbeat
    this.stopHeartbeat();

    // Close WebSocket
    if (this.ws) {
      this.ws.close(1000, 'Client disconnecting');
    }

    // Reset state
    this.isConnected = false;
    this.isAuthenticated = false;
    this.ws = null;
    this.messageQueue = [];
  }

  getStatus() {
    return {
      isConnected: this.isConnected,
      isAuthenticated: this.isAuthenticated,
      agentUrl: this.agentUrl,
      reconnectAttempts: this.reconnectAttempts,
      queuedMessages: this.messageQueue.length,
      readyState: this.ws ? this.ws.readyState : null
    };
  }

  // Public method to check if connection is ready for communication
  isReady() {
    return this.isConnected && this.isAuthenticated;
  }

  // Update connection settings
  updateSettings(settings) {
    if (settings.heartbeatInterval && settings.heartbeatInterval > 0) {
      // Restart heartbeat with new interval
      this.stopHeartbeat();
      this.heartbeatInterval = settings.heartbeatInterval;
      this.startHeartbeat();
    }

    if (settings.maxReconnectAttempts !== undefined) {
      this.maxReconnectAttempts = settings.maxReconnectAttempts;
    }

    if (settings.reconnectDelay && settings.reconnectDelay > 0) {
      this.reconnectDelay = settings.reconnectDelay;
    }

    console.log('Connection settings updated:', settings);
  }
}

module.exports = ConnectionManager;