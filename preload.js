const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // Connection management
  connect: (connectionCode) => ipcRenderer.invoke('connect', connectionCode),
  disconnect: () => ipcRenderer.invoke('disconnect'),

  // Permission management
  grantPermission: (watchLive = false) => ipcRenderer.invoke('grant-permission', watchLive),
  denyPermission: () => ipcRenderer.invoke('deny-permission'),
  revokePermission: (reason = 'User revoked') => ipcRenderer.invoke('revoke-permission', reason),

  // Event listeners for main process messages
  onConnectionStatus: (callback) => ipcRenderer.on('connection-status', callback),
  onConnectionError: (callback) => ipcRenderer.on('connection-error', callback),
  onPermissionRevoked: (callback) => ipcRenderer.on('permission-revoked', callback),
  onPermissionGranted: (callback) => ipcRenderer.on('permission-granted', callback),
  onSessionStart: (callback) => ipcRenderer.on('session-start', callback),
  onConnectionLost: (callback) => ipcRenderer.on('connection-lost', callback),
  onSetPermissionData: (callback) => ipcRenderer.on('set-permission-data', callback),

  // Remove listeners (for cleanup)
  removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel),

  // Platform detection
  platform: process.platform,

  // Environment info
  isDevMode: process.argv.includes('--dev')
});

// Additional API for permission dialog
contextBridge.exposeInMainWorld('permissionAPI', {
  // Called by permission dialog
  allow: () => ipcRenderer.invoke('grant-permission', false),
  allowAndWatch: () => ipcRenderer.invoke('grant-permission', true),
  deny: () => ipcRenderer.invoke('deny-permission'),

  // Listen for permission data from main process
  onSetData: (callback) => ipcRenderer.on('set-permission-data', callback)
});

// Screen capture API (for watch window)
contextBridge.exposeInMainWorld('screenAPI', {
  // Screen frame data
  onScreenFrame: (callback) => ipcRenderer.on('screen-frame', callback),

  // Session control
  stopSession: () => ipcRenderer.invoke('revoke-permission', 'User clicked stop')
});

console.log('Preload script loaded successfully');

// Bridge API — glow overlay + dashboard controls
contextBridge.exposeInMainWorld('bridgeAPI', {
  getStatus:      () => ipcRenderer.invoke('bridge-status'),
  testDashboard:  () => ipcRenderer.invoke('test-dashboard'),
  setSarahUrl:    (url) => ipcRenderer.invoke('set-sarah-url', url),
  glowShow:       () => ipcRenderer.invoke('glow-show'),
  glowHide:       () => ipcRenderer.invoke('glow-hide'),
  openExternal:   (url) => ipcRenderer.invoke('open-external', url),
  onBridgeStatus: (callback) => ipcRenderer.on('bridge-status', callback),
});