'use strict';
const { McpServer } = require('../node_modules/@modelcontextprotocol/sdk/dist/cjs/server/mcp.js');
const { StreamableHTTPServerTransport } = require('../node_modules/@modelcontextprotocol/sdk/dist/cjs/server/streamableHttp.js');
const express = require('express');
const { z } = require('zod');
const crypto = require('crypto');
const http = require('http');
const https = require('https');

const MCP_PORT = parseInt(process.env.BLOOM_MCP_PORT || '9245');
const SERVER_NAME = 'bloom-desktop-control-mcp-server';
const SERVER_VERSION = '1.0.0';
const RAILWAY_URL = process.env.SARAH_RAILWAY_URL || 'https://autonomous-sarah-rodriguez-production.up.railway.app';
const POLL_INTERVAL_MS = 1000;

let _robot = null;
function getRobot() {
  if (!_robot) {
    try { _robot = require('robotjs'); }
    catch { throw new Error('robotjs unavailable'); }
  }
  return _robot;
}

function parseKey(raw) {
  const parts = raw.toLowerCase().trim().split('+');
  const key = parts[parts.length - 1];
  const modMap = { cmd:'command', meta:'command', ctrl:'control', alt:'alt', shift:'shift', win:'command' };
  const modifiers = parts.slice(0, -1).map(m => modMap[m] || m);
  return { key, modifiers };
}

function ok(text, structured) {
  const r = { content: [{ type: 'text', text }] };
  if (structured !== undefined) r.structuredContent = structured;
  return r;
}

function railwayFetch(path, method, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(RAILWAY_URL + path);
    const isHttps = url.protocol === 'https:';
    const lib = isHttps ? https : http;
    const data = body ? JSON.stringify(body) : null;
    const options = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      method: method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {})
      },
      timeout: 5000
    };
    const req = lib.request(options, (res) => {
      let raw = '';
      res.on('data', d => raw += d);
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); }
        catch { resolve({ _raw: raw }); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    if (data) req.write(data);
    req.end();
  });
}

class DesktopMCPServer {
  constructor() {
    this._glowCallback = null;
    this._httpServer = null;
    this._token = process.env.BLOOM_MCP_TOKEN || null;
    this._started = false;
    this._sessionId = 'desktop_' + crypto.randomBytes(6).toString('hex');
    this._pollTimer = null;
    this._polling = false;
  }

  setGlowCallback(fn) { this._glowCallback = fn; }

  _triggerGlow() {
    if (this._glowCallback) {
      try { this._glowCallback(); } catch (e) {}
    }
  }

  // ??? Tool executor ???????????????????????????????????????????????????????????
  async _executeTool(tool, args) {
    this._triggerGlow();
    switch (tool) {
      case 'bloom_get_screen_info': {
        const robot = getRobot();
        const size = robot.getScreenSize();
        const pos = robot.getMousePos();
        return { success: true, result: { width: size.width, height: size.height, mouseX: pos.x, mouseY: pos.y } };
      }
      case 'bloom_take_screenshot': {
        // Use Electron desktopCapturer for real screenshot with image data
        const { desktopCapturer, screen } = require('electron');
        const primaryDisplay = screen.getPrimaryDisplay();
        const { width, height } = primaryDisplay.size;
        const sources = await desktopCapturer.getSources({
          types: ['screen'],
          thumbnailSize: { width, height }
        });
        // Find the source matching the primary display
        const source = sources.find(s => String(s.display_id) === String(primaryDisplay.id)) || sources[0];
        if (!source) return { success: false, result: { error: 'No screen source found' } };
        // thumbnail is a NativeImage — convert to base64 JPEG
        const jpeg = source.thumbnail.toJPEG(85);
        const base64 = jpeg.toString('base64');
        return { success: true, result: { captured: true, width, height, image: base64, mimeType: 'image/jpeg' } };
      }
      case 'bloom_click': {
        const robot = getRobot();
        const { x, y, button = 'left' } = args;
        robot.moveMouse(x, y);
        robot.mouseClick(button);
        return { success: true, result: `Clicked ${button} at (${x}, ${y})` };
      }
      case 'bloom_double_click': {
        const robot = getRobot();
        const { x, y } = args;
        robot.moveMouse(x, y);
        robot.mouseClick('left', true);
        return { success: true, result: `Double-clicked at (${x}, ${y})` };
      }
      case 'bloom_move_mouse': {
        robot.moveMouse(args.x, args.y);
        return { success: true, result: `Mouse at (${args.x}, ${args.y})` };
      }
      case 'bloom_scroll': {
        const robot = getRobot();
        const { x, y, direction, amount = 3 } = args;
        robot.moveMouse(x, y);
        if (direction === 'up') robot.scrollMouse(0, amount);
        else if (direction === 'down') robot.scrollMouse(0, -amount);
        else if (direction === 'left') robot.scrollMouse(-amount, 0);
        else robot.scrollMouse(amount, 0);
        return { success: true, result: `Scrolled ${direction} ${amount} at (${x}, ${y})` };
      }
      case 'bloom_drag': {
        const robot = getRobot();
        const { fromX, fromY, toX, toY } = args;
        robot.moveMouse(fromX, fromY);
        robot.mouseToggle('down');
        robot.dragMouse(toX, toY);
        robot.mouseToggle('up');
        return { success: true, result: `Dragged (${fromX},${fromY}) to (${toX},${toY})` };
      }
      case 'bloom_type_text': {
        const robot = getRobot();
        robot.typeString(args.text);
        return { success: true, result: `Typed ${args.text.length} chars` };
      }
      case 'bloom_key_press': {
        const robot = getRobot();
        const { key: mainKey, modifiers } = parseKey(args.key);
        if (modifiers.length > 0) robot.keyTap(mainKey, modifiers);
        else robot.keyTap(mainKey);
        return { success: true, result: `Pressed ${args.key}` };
      }
      default:
        return { success: false, error: `Unknown tool: ${tool}` };
    }
  }

  // ??? Polling loop ????????????????????????????????????????????????????????????
  async _register() {
    try {
      await railwayFetch('/api/desktop/register', 'POST', {
        sessionId: this._sessionId,
        platform: process.platform,
        version: SERVER_VERSION
      });
      console.log('[bloom-desktop] Registered with Railway. Session:', this._sessionId);
    } catch (e) {
      console.warn('[bloom-desktop] Railway register failed (will retry via poll):', e.message);
    }
  }

  async _poll() {
    if (this._polling) return; // don't stack if slow
    this._polling = true;
    try {
      const res = await railwayFetch(
        '/api/desktop/pending?sessionId=' + this._sessionId,
        'GET'
      );
      // Re-register if Railway lost our session (redeploy wipes in-memory sessions)
      if (res.error && (res.error.includes('not found') || res.error.includes('Unknown session'))) {
        console.warn('[bloom-desktop] Session lost on Railway \u2014 re-registering...');
        await this._register();
        return;
      }
      if (res.commands && res.commands.length > 0) {
        for (const cmd of res.commands) {
          let outcome;
          try {
            outcome = await this._executeTool(cmd.tool, cmd.args || {});
          } catch (e) {
            outcome = { success: false, error: e.message };
          }
          railwayFetch('/api/desktop/result', 'POST', {
            sessionId: this._sessionId,
            commandId: cmd.commandId,
            success: outcome.success,
            result: outcome.result,
            error: outcome.error
          }).catch(() => {});
        }
      }
    } catch (e) {
      // Network blip � silent, will retry next tick
    } finally {
      this._polling = false;
    }
  }

  _startPollingLoop() {
    this._register();
    this._pollTimer = setInterval(() => this._poll(), POLL_INTERVAL_MS);
    console.log('[bloom-desktop] Polling Railway for commands every', POLL_INTERVAL_MS, 'ms');
  }

  // ??? MCP server (local dev) ??????????????????????????????????????????????????
  _buildMcpServer() {
    const self = this;
    const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

    server.registerTool('bloom_get_screen_info', {
      title: 'Get Screen Info',
      description: 'Get screen dimensions and current mouse position.',
      inputSchema: z.object({}).strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    }, async () => {
      const r = await self._executeTool('bloom_get_screen_info', {});
      return ok(`Screen: ${r.result.width}x${r.result.height}. Mouse at (${r.result.mouseX}, ${r.result.mouseY}).`, r.result);
    });

    server.registerTool('bloom_take_screenshot', {
      title: 'Take Screenshot',
      description: 'Capture the current screen state.',
      inputSchema: z.object({}).strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    }, async () => {
      const r = await self._executeTool('bloom_take_screenshot', {});
      return ok(`Screenshot captured. ${r.result.width}x${r.result.height}px.`, r.result);
    });

    server.registerTool('bloom_click', {
      title: 'Click',
      description: 'Move mouse to (x,y) and click. Args: x, y, button (left|right|middle).',
      inputSchema: z.object({ x: z.number(), y: z.number(), button: z.enum(['left','right','middle']).default('left') }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    }, async (args) => { const r = await self._executeTool('bloom_click', args); return ok(r.result); });

    server.registerTool('bloom_double_click', {
      title: 'Double Click',
      description: 'Double-click at (x,y).',
      inputSchema: z.object({ x: z.number(), y: z.number() }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    }, async (args) => { const r = await self._executeTool('bloom_double_click', args); return ok(r.result); });

    server.registerTool('bloom_move_mouse', {
      title: 'Move Mouse',
      description: 'Move mouse to (x,y) without clicking.',
      inputSchema: z.object({ x: z.number(), y: z.number() }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    }, async (args) => { const r = await self._executeTool('bloom_move_mouse', args); return ok(r.result); });

    server.registerTool('bloom_scroll', {
      title: 'Scroll',
      description: 'Scroll at (x,y). direction: up|down|left|right, amount 1-20.',
      inputSchema: z.object({ x: z.number(), y: z.number(), direction: z.enum(['up','down','left','right']), amount: z.number().int().min(1).max(20).default(3) }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    }, async (args) => { const r = await self._executeTool('bloom_scroll', args); return ok(r.result); });

    server.registerTool('bloom_drag', {
      title: 'Drag',
      description: 'Click-drag from (fromX,fromY) to (toX,toY).',
      inputSchema: z.object({ fromX: z.number(), fromY: z.number(), toX: z.number(), toY: z.number() }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    }, async (args) => { const r = await self._executeTool('bloom_drag', args); return ok(r.result); });

    server.registerTool('bloom_type_text', {
      title: 'Type Text',
      description: 'Type text at current cursor position.',
      inputSchema: z.object({ text: z.string().min(1).max(5000) }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    }, async (args) => { const r = await self._executeTool('bloom_type_text', args); return ok(r.result); });

    server.registerTool('bloom_key_press', {
      title: 'Key Press',
      description: 'Press a key or combo. Examples: enter, tab, escape, cmd+c, cmd+v.',
      inputSchema: z.object({ key: z.string().min(1) }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    }, async (args) => { const r = await self._executeTool('bloom_key_press', args); return ok(r.result); });

    return server;
  }

  start() {
    if (this._started) return;
    this._started = true;

    // 1. HTTP server � local dev / direct MCP calls
    const mcpServer = this._buildMcpServer();
    const app = express();
    app.use(express.json());
    const token = this._token;
    app.use((req, res, next) => {
      if (req.path === '/health') { next(); return; }
      if (!token) { next(); return; }
      const provided = req.headers['x-bloom-token'] || req.query.token;
      if (provided !== token) { res.status(401).json({ error: 'Unauthorized' }); return; }
      next();
    });
    app.get('/health', (_req, res) => {
      res.json({ status: 'online', server: SERVER_NAME, version: SERVER_VERSION, tools: 9, sessionId: this._sessionId });
    });
    app.post('/mcp', async (req, res) => {
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      res.on('close', () => transport.close());
      await mcpServer.connect(transport);
      await transport.handleRequest(req, res, req.body);
    });
    this._httpServer = app.listen(MCP_PORT, '127.0.0.1', () => {
      console.log('[' + SERVER_NAME + '] HTTP MCP on http://127.0.0.1:' + MCP_PORT + '/mcp');
      if (!token) console.warn('[' + SERVER_NAME + '] WARNING: No BLOOM_MCP_TOKEN set (dev mode)');
    });

    // 2. Polling loop � works for all users behind routers
    this._startPollingLoop();
  }

  stop() {
    if (this._pollTimer) { clearInterval(this._pollTimer); this._pollTimer = null; }
    if (this._httpServer) { this._httpServer.close(); this._httpServer = null; }
    this._started = false;
  }
}

module.exports = DesktopMCPServer;
