# BLOOM Desktop

**Let your AI employee work on your computer**

BLOOM Desktop is an Electron application that allows BLOOM AI employees to temporarily control a customer's computer with explicit permission. This enables AI agents to perform real work like building landing pages, using design tools, editing files, and more.

## 🌸 Features

- **Secure Connection**: Connect to your BLOOM agent via secure WebSocket
- **Permission Control**: Explicit user permission required for screen access
- **Live Monitoring**: Optional live view to watch your agent work
- **Emergency Stop**: Quick keyboard shortcut to stop sessions
- **Session History**: Track all agent sessions and activities
- **Cross-Platform**: Works on macOS, Windows, and Linux
- **System Tray**: Minimizes to system tray for easy access

## 🚀 Quick Start

### Prerequisites

- Node.js 16+
- npm or yarn
- Python 3.x (for robotjs native dependencies)
- Platform-specific build tools:
  - **macOS**: Xcode Command Line Tools
  - **Windows**: Visual Studio Build Tools
  - **Linux**: build-essential

### Installation

1. **Clone or download the project**
   ```bash
   cd bloom-desktop
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Development mode**
   ```bash
   npm run dev
   ```

4. **Production build**
   ```bash
   npm run build
   ```

### Building for Distribution

- **macOS**: `npm run build:mac`
- **Windows**: `npm run build:win`
- **All platforms**: `npm run build`

## 🔧 Configuration

### Connection Setup

1. Get your connection code from the BLOOM dashboard:
   - Go to Settings → Desktop Connection
   - Copy the connection code (format: `agent-url:token`)

2. In BLOOM Desktop:
   - Enter your connection code
   - Click "Connect"
   - Grant permission when your agent requests access

### Emergency Stop

- **macOS**: `Cmd+Shift+Esc`
- **Windows/Linux**: `Ctrl+Shift+Esc`

## 📁 Project Structure

```
bloom-desktop/
├── main.js                 # Electron main process
├── preload.js             # Security bridge between main/renderer
├── package.json           # Dependencies and build config
├── renderer/              # UI files
│   ├── index.html         # Main window
│   ├── app.js            # Main window logic
│   ├── styles.css        # Comprehensive styling
│   └── permission-dialog.html # Permission request dialog
├── modules/               # Core functionality
│   ├── screen-capture.js  # Screen recording and streaming
│   ├── input-control.js   # Mouse/keyboard automation
│   ├── permission-manager.js # Permission and session tracking
│   ├── connection-manager.js  # WebSocket connection handling
│   └── system-tray.js     # System tray integration
└── assets/               # Icons and resources
    └── README.md         # Asset requirements
```

## 🔒 Security Features

- **Context Isolation**: Renderer processes are sandboxed
- **No Node Integration**: Web content cannot access Node.js APIs
- **Permission System**: All actions require explicit user consent
- **Secure Communication**: WebSocket connections with authentication
- **Emergency Controls**: Multiple ways to stop sessions immediately

## 🛠 Development

### Running in Development

```bash
npm run dev
```

This starts the app with:
- Developer tools open
- Hot reload enabled
- Debug logging
- Relaxed security for development

### Building for Production

```bash
npm run build
```

Creates distributables in the `dist/` folder:
- **macOS**: `.dmg` and `.zip` files
- **Windows**: `.exe` installer
- **Linux**: `.AppImage` and `.deb` packages

### Testing

1. **Install dependencies** (if not done):
   ```bash
   npm install
   ```

2. **Test basic functionality**:
   - Start the app: `npm run dev`
   - Check that the UI loads correctly
   - Verify system tray appears
   - Test emergency shortcut registration

3. **Test with agent connection**:
   - Get a test connection code from BLOOM dashboard
   - Enter the code and attempt connection
   - Verify permission dialog appears
   - Test granting/denying permissions

## 🐛 Troubleshooting

### Common Issues

**robotjs installation fails**:
- Ensure Python 3.x is installed
- Install platform build tools (Xcode CLI Tools, Visual Studio Build Tools, etc.)
- Try: `npm rebuild robotjs`

**App won't start**:
- Check Node.js version (requires 16+)
- Clear node_modules and reinstall: `rm -rf node_modules && npm install`

**Connection issues**:
- Verify connection code format: `agent-url:token`
- Check network connectivity
- Ensure BLOOM agent is running and accessible

**Permission dialog doesn't appear**:
- Check system notifications are enabled
- Verify app permissions (Screen Recording on macOS)

### System Requirements

**macOS**:
- macOS 10.13 or later
- Screen Recording permission (System Preferences → Security & Privacy)
- Accessibility permission (for keyboard/mouse control)

**Windows**:
- Windows 7 or later
- Administrator privileges may be required for input control

**Linux**:
- X11 display server
- Desktop environment with system tray support

## 📋 TODO / Future Enhancements

- [ ] Add proper application icons
- [ ] Implement file transfer capabilities
- [ ] Add session recording/playback
- [ ] Multi-monitor support
- [ ] Agent performance monitoring
- [ ] Encrypted local session storage
- [ ] Plugin system for custom tools
- [ ] Web-based remote access option

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly on target platforms
5. Submit a pull request

## 📄 License

MIT License - see LICENSE file for details.

## 🌸 About BLOOM

BLOOM Desktop is part of the BLOOM ecosystem that enables AI employees to perform real work on behalf of users. Visit the BLOOM dashboard to manage your AI employees and get connection codes for desktop access.

---

**⚠️ Important Security Note**: Only connect to trusted BLOOM agents. This application grants significant system access when permissions are granted. Always verify connection codes come from legitimate BLOOM services.