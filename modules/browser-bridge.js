/**
 * BLOOM Browser Bridge
 * 
 * Local WebSocket server (ws://localhost:9244) that Sarah on Railway can call
 * to control Chrome on your Mac using the CDP snapshot pattern:
 * 
 *   navigate → snapshot → click by ref → type → snapshot again
 * 
 * Sarah never uses coordinates. She uses the accessibility snapshot which returns
 * numbered elements she can reference by ID.
 */

const { WebSocketServer } = require('ws');
const http = require('http');
const DashboardBridge = require('./dashboard-bridge');

const SARAH_URL = 'https://autonomous-sarah-rodriguez-production.up.railway.app';

// We use playwright-core's CDP connection if available,
// otherwise fall back to native Chrome DevTools Protocol via fetch
let chromium;
try {
  chromium = require('playwright-core').chromium;
} catch {
  chromium = null;
}

class BrowserBridge {
  constructor(port = 9244) {
    this.port = port;
    this.server = null;
    this.wss = null;
    this.browser = null;
    this.page = null;
    this.elementMap = new Map(); // ref number → { selector, text, tag }
    this._running = false;

    // ── Screen capture → Dashboard push ─────────────────────────────
    this.dashboardBridge = new DashboardBridge({ sarahUrl: SARAH_URL });
    this.captureActive = false;
    this.captureTimer = null;
    this.frameRate = 2;
    this.captureQuality = 70;
  }

  isRunning() {
    return this._running;
  }

  async start() {
    // HTTP server (health check)
    this.server = http.createServer((req, res) => {
      if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          status: 'ok',
          bridge: 'bloom-browser-bridge',
          port: this.port,
          browserConnected: !!this.page,
          captureActive: this.captureActive,
          dashboardBridge: this.dashboardBridge.getStatus(),
        }));
      } else if (req.url === '/snapshot') {
        const { desktopCapturer, screen } = require('electron');
        const primaryDisplay = screen.getPrimaryDisplay();
        const { width, height } = primaryDisplay.bounds;
        desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: Math.min(width, 1920), height: Math.min(height, 1080) } })
          .then(sources => {
            const info = sources.map((s, i) => ({
              index: i,
              name: s.name,
              display_id: s.display_id,
              thumbWidth: s.thumbnail.getSize().width,
              thumbHeight: s.thumbnail.getSize().height,
              preview: s.thumbnail.toJPEG(50).toString('base64').substring(0, 100)
            }));
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ sources: info, primaryDisplayId: primaryDisplay.id, primaryBounds: primaryDisplay.bounds }));
          })
          .catch(e => { res.writeHead(500); res.end(e.message); });
      } else if (req.url === '/displays') {
        const { screen, desktopCapturer } = require('electron');
        const all = screen.getAllDisplays();
        const primary = screen.getPrimaryDisplay();
        desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 400, height: 300 } })
          .then(sources => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              displayCount: all.length,
              primaryId: primary.id,
              displays: all.map(d => ({ id: d.id, bounds: d.bounds, scaleFactor: d.scaleFactor })),
              sourceCount: sources.length,
              sourceNames: sources.map(s => s.name),
              capturingSource: sources[0]?.name || 'none'
            }));
          })
          .catch(e => { res.writeHead(500); res.end(e.message); });
      } else {
        res.writeHead(404);
        res.end('Not found');
      }
    });

    // WebSocket server
    this.wss = new WebSocketServer({ server: this.server });

    this.wss.on('connection', (ws, req) => {
      // Only allow connections from localhost / Railway
      const origin = req.headers.origin || '';
      const isAllowed =
        origin === '' ||
        origin.includes('localhost') ||
        origin.includes('127.0.0.1') ||
        origin.includes('railway.app') ||
        origin.includes('autonomous-sarah-rodriguez');

      if (!isAllowed) {
        console.warn('[Bridge] Rejected connection from origin:', origin);
        ws.close(1008, 'Origin not allowed');
        return;
      }

      console.log('[Bridge] Client connected from', origin || 'unknown origin');

      ws.on('message', async (raw) => {
        let msg;
        try {
          msg = JSON.parse(raw.toString());
        } catch {
          ws.send(JSON.stringify({ error: 'Invalid JSON' }));
          return;
        }

        const result = await this.handleCommand(msg);
        ws.send(JSON.stringify({ id: msg.id, ...result }));
      });

      ws.on('close', () => {
        console.log('[Bridge] Client disconnected');
      });

      // Send greeting with capabilities
      ws.send(JSON.stringify({
        type: 'connected',
        version: '1.0.0',
        capabilities: ['navigate', 'snapshot', 'click', 'type', 'scroll', 'screenshot', 'eval'],
        browserConnected: !!this.page,
        captureActive: this.captureActive,
        dashboardBridge: this.dashboardBridge.getStatus(),
        sarahUrl: SARAH_URL,
      }));
    });

    await new Promise((resolve, reject) => {
      this.server.listen(this.port, '127.0.0.1', () => {
        this._running = true;
        resolve();
      });
      this.server.on('error', reject);
    });

    // Auto-start screen capture so the dashboard Screen Viewer is live immediately
    this._startCapture();
    console.log(`[BrowserBridge] started on port ${this.port} — screen capture active → ${SARAH_URL}`);
  }

  stop() {
    this._stopCapture();
    this.dashboardBridge.destroy();
    this._running = false;
    this.wss?.close();
    this.server?.close();
    this.browser?.close().catch(() => {});
  }

  // ─── SCREEN CAPTURE → DASHBOARD ──────────────────────────────────────────

  _startCapture() {
    if (this.captureActive) return;
    this.captureActive = true;
    const intervalMs = Math.round(1000 / this.frameRate);
    console.log(`[BrowserBridge] screen capture starting at ${this.frameRate} fps`);

    const captureFrame = async () => {
      if (!this.captureActive) return;
      try {
        const { desktopCapturer, screen, BrowserWindow } = require('electron');
        const primaryDisplay = screen.getPrimaryDisplay();
        const { width, height } = primaryDisplay.bounds;
        const sources = await desktopCapturer.getSources({
          types: ['screen'],
          thumbnailSize: { width: Math.min(width, 1920), height: Math.min(height, 1080) }
        });
        if (!this._sourcesLogged) {
          this._sourcesLogged = true;
          console.log('[BrowserBridge] available sources:', sources.map(s => ({ name: s.name, id: s.display_id })), '— primaryDisplayId:', primaryDisplay.id);
        }
        // Pick the source whose display_id matches the primary display
        // Fall back to sources[0] only if no match found
        const targetSource = sources.find(s => String(s.display_id) === String(primaryDisplay.id)) || sources[0];
        if (targetSource && targetSource.thumbnail) {
          const jpegBuffer = targetSource.thumbnail.toJPEG(this.captureQuality);

          // Best-effort: get the URL of the focused Electron window
          let currentUrl = '';
          try {
            const focused = BrowserWindow.getFocusedWindow();
            if (focused?.webContents) currentUrl = focused.webContents.getURL();
          } catch {}

          this.dashboardBridge.receiveFrame(jpegBuffer, currentUrl);
        }
      } catch (err) {
        // Silently swallow — common if screen permission not yet granted
        if (!err.message?.includes('permission')) {
          console.warn('[BrowserBridge] capture error:', err.message);
        }
      }

      if (this.captureActive) {
        this.captureTimer = setTimeout(captureFrame, intervalMs);
      }
    };

    captureFrame();
  }

  _stopCapture() {
    this.captureActive = false;
    if (this.captureTimer) {
      clearTimeout(this.captureTimer);
      this.captureTimer = null;
    }
    this.dashboardBridge.sendIdle();
  }

  // ─── COMMAND DISPATCHER ───────────────────────────────────────────────────

  async handleCommand(msg) {
    const { command } = msg;

    try {
      switch (command) {
        case 'connect_browser':
          return await this.connectBrowser(msg.cdpUrl || 'http://localhost:9222');

        case 'disconnect_browser':
          return await this.disconnectBrowser();

        case 'navigate':
          return await this.navigate(msg.url);

        case 'snapshot':
          return await this.snapshot();

        case 'click':
          return await this.clickElement(msg.ref);

        case 'type':
          return await this.typeInElement(msg.ref, msg.text, msg.clear);

        case 'key':
          return await this.pressKey(msg.key);

        case 'scroll':
          return await this.scroll(msg.direction, msg.amount);

        case 'screenshot':
          return await this.screenshot();

        case 'eval':
          return await this.evalJS(msg.code);

        case 'current_url':
          return await this.getCurrentUrl();

        case 'wait':
          return await this.wait(msg.ms || 1000);

        default:
          return { success: false, error: `Unknown command: ${command}` };
      }
    } catch (err) {
      console.error(`[Bridge] Command ${command} failed:`, err.message);
      return { success: false, error: err.message };
    }
  }

  // ─── BROWSER CONNECTION ───────────────────────────────────────────────────

  async connectBrowser(cdpUrl = 'http://localhost:9222') {
    if (!chromium) {
      return { success: false, error: 'playwright-core not installed. Run: npm install playwright-core' };
    }

    try {
      if (this.browser) {
        await this.browser.close().catch(() => {});
      }

      this.browser = await chromium.connectOverCDP(cdpUrl);
      const contexts = this.browser.contexts();

      if (contexts.length === 0) {
        return { success: false, error: 'No browser contexts found. Is Chrome open?' };
      }

      const pages = contexts[0].pages();
      if (pages.length === 0) {
        // Open a new page
        this.page = await contexts[0].newPage();
      } else {
        this.page = pages[0];
      }

      const url = this.page.url();
      const title = await this.page.title();

      return {
        success: true,
        connected: true,
        currentUrl: url,
        title,
        message: `Connected to Chrome — currently on: ${title}`,
      };
    } catch (err) {
      return {
        success: false,
        error: `Could not connect to Chrome: ${err.message}. Make sure Chrome is running with --remote-debugging-port=9222`,
      };
    }
  }

  async disconnectBrowser() {
    await this.browser?.close().catch(() => {});
    this.browser = null;
    this.page = null;
    this.elementMap.clear();
    return { success: true, message: 'Browser disconnected' };
  }

  // ─── PAGE CONTROLS ────────────────────────────────────────────────────────

  async navigate(url) {
    this._requirePage();
    if (!url.startsWith('http')) url = 'https://' + url;

    await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const title = await this.page.title();

    return {
      success: true,
      url: this.page.url(),
      title,
      message: `Navigated to: ${title}`,
    };
  }

  /**
   * Snapshot — returns a numbered list of all interactive elements.
   * Sarah calls this after every navigation or action to see what's on the page.
   */
  async snapshot() {
    this._requirePage();
    this.elementMap.clear();

    const elements = await this.page.evaluate(() => {
      const selectors = [
        'a[href]',
        'button:not([disabled])',
        'input:not([disabled])',
        'select:not([disabled])',
        'textarea:not([disabled])',
        '[role="button"]:not([disabled])',
        '[role="link"]',
        '[role="menuitem"]',
        '[role="tab"]',
        '[role="option"]',
        '[onclick]',
        '[tabindex]:not([tabindex="-1"])',
      ];

      const seen = new Set();
      const results = [];
      let idx = 1;

      function getLabel(el) {
        return (
          el.getAttribute('aria-label') ||
          el.getAttribute('placeholder') ||
          el.getAttribute('title') ||
          el.getAttribute('alt') ||
          el.innerText?.trim().slice(0, 60) ||
          el.value?.slice(0, 40) ||
          el.tagName.toLowerCase()
        );
      }

      function generateSelector(el) {
        if (el.id) return `#${CSS.escape(el.id)}`;
        if (el.getAttribute('data-testid')) return `[data-testid="${el.getAttribute('data-testid')}"]`;
        if (el.getAttribute('aria-label')) return `[aria-label="${el.getAttribute('aria-label')}"]`;
        if (el.name) return `${el.tagName.toLowerCase()}[name="${el.name}"]`;

        // Build nth-child path (capped at 4 levels)
        const parts = [];
        let node = el;
        for (let i = 0; i < 4 && node && node !== document.body; i++) {
          const parent = node.parentElement;
          if (!parent) break;
          const siblings = Array.from(parent.children).filter(c => c.tagName === node.tagName);
          const nth = siblings.indexOf(node) + 1;
          parts.unshift(siblings.length > 1
            ? `${node.tagName.toLowerCase()}:nth-of-type(${nth})`
            : node.tagName.toLowerCase()
          );
          node = parent;
        }
        return parts.join(' > ');
      }

      for (const sel of selectors) {
        document.querySelectorAll(sel).forEach(el => {
          if (seen.has(el)) return;

          const rect = el.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) return; // invisible

          // Skip if scrolled way out of viewport (more than 2 screens away)
          if (rect.top > window.innerHeight * 3 || rect.bottom < -window.innerHeight * 2) return;

          seen.add(el);

          const label = getLabel(el);
          const selector = generateSelector(el);
          const type = el.getAttribute('type') || el.tagName.toLowerCase();
          const role = el.getAttribute('role') || '';

          results.push({ index: idx++, label, tag: el.tagName.toLowerCase(), type, role, selector });
        });
      }

      return results;
    });

    // Store selector map for click/type commands
    elements.forEach(el => this.elementMap.set(el.index, el.selector));

    const formatted = elements.map(el => {
      const roleStr = el.role ? ` [${el.role}]` : '';
      const typeStr = el.tag === 'input' ? ` (${el.type})` : '';
      return `[${el.index}] ${el.label}${roleStr} <${el.tag}${typeStr}>`;
    }).join('\n');

    return {
      success: true,
      count: elements.length,
      elements,
      formatted,
      url: this.page.url(),
      title: await this.page.title(),
    };
  }

  async clickElement(ref) {
    this._requirePage();

    const selector = this.elementMap.get(ref);
    if (!selector) {
      return { success: false, error: `Element [${ref}] not found. Run snapshot first.` };
    }

    try {
      await this.page.locator(selector).first().click({ timeout: 8000 });
      await this.page.waitForTimeout(300); // Brief settle
      return {
        success: true,
        message: `Clicked element [${ref}]`,
        currentUrl: this.page.url(),
      };
    } catch (err) {
      // Fallback: try JS click
      try {
        await this.page.evaluate((sel) => {
          const el = document.querySelector(sel);
          if (el) { el.click(); return true; }
          throw new Error('Element not found');
        }, selector);
        return { success: true, message: `Clicked element [${ref}] via JS fallback`, currentUrl: this.page.url() };
      } catch {
        return { success: false, error: `Click failed for [${ref}]: ${err.message}. Try snapshot again.` };
      }
    }
  }

  async typeInElement(ref, text, clear = true) {
    this._requirePage();

    if (!text) return { success: false, error: 'No text provided' };

    const selector = this.elementMap.get(ref);
    if (!selector) {
      return { success: false, error: `Element [${ref}] not found. Run snapshot first.` };
    }

    const locator = this.page.locator(selector).first();

    try {
      await locator.click({ timeout: 5000 });
      if (clear) {
        await this.page.keyboard.press('Control+a');
        await this.page.keyboard.press('Meta+a'); // macOS
        await this.page.keyboard.press('Delete');
      }
      await locator.type(text, { delay: 30 }); // Human-like timing
      return { success: true, message: `Typed "${text.slice(0, 30)}${text.length > 30 ? '...' : ''}" into [${ref}]` };
    } catch (err) {
      return { success: false, error: `Type failed for [${ref}]: ${err.message}` };
    }
  }

  async pressKey(key) {
    this._requirePage();
    await this.page.keyboard.press(key);
    return { success: true, message: `Pressed: ${key}` };
  }

  async scroll(direction = 'down', amount = 3) {
    this._requirePage();
    const delta = direction === 'down' ? 500 * amount : -500 * amount;
    await this.page.mouse.wheel(0, delta);
    await this.page.waitForTimeout(200);
    return { success: true, message: `Scrolled ${direction} ${amount}x` };
  }

  async screenshot() {
    this._requirePage();
    const buffer = await this.page.screenshot({ type: 'jpeg', quality: 70 });
    const base64 = buffer.toString('base64');
    return {
      success: true,
      dataUrl: `data:image/jpeg;base64,${base64}`,
      url: this.page.url(),
      title: await this.page.title(),
    };
  }

  async evalJS(code) {
    this._requirePage();
    const result = await this.page.evaluate(code);
    return { success: true, result };
  }

  async getCurrentUrl() {
    this._requirePage();
    return {
      success: true,
      url: this.page.url(),
      title: await this.page.title(),
    };
  }

  async wait(ms = 1000) {
    await new Promise(resolve => setTimeout(resolve, ms));
    return { success: true, message: `Waited ${ms}ms` };
  }

  // ─── HELPERS ──────────────────────────────────────────────────────────────

  _requirePage() {
    if (!this.page) {
      throw new Error('No browser connected. Send command: { command: "connect_browser" }');
    }
  }
}

module.exports = BrowserBridge;
