'use strict';
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp');
const express = require('express');
const { z } = require('zod');

const MCP_PORT = parseInt(process.env.BLOOM_MCP_PORT || '9245');
const SERVER_NAME = 'bloom-desktop-control-mcp-server';
const SERVER_VERSION = '1.0.0';

let _robot = null;
function getRobot() {
  if (!_robot) {
    try { _robot = require('robotjs'); }
    catch { throw new Error('robotjs unavailable — BLOOM Desktop must be fully installed.'); }
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

class DesktopMCPServer {
  constructor() {
    this._glowCallback = null;
    this._server = null;
    this._httpServer = null;
    this._token = process.env.BLOOM_MCP_TOKEN || null;
    this._started = false;
  }

  setGlowCallback(fn) {
    this._glowCallback = fn;
  }

  _triggerGlow() {
    if (this._glowCallback) {
      try { this._glowCallback(); } catch (e) { /* non-fatal */ }
    }
  }

  _buildMcpServer() {
    const self = this;
    const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

    server.registerTool('bloom_get_screen_info', {
      title: 'Get Screen Info',
      description: 'Get screen dimensions and current mouse position. Call before computing click coordinates.',
      inputSchema: z.object({}).strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    }, async () => {
      self._triggerGlow();
      const robot = getRobot();
      const size = robot.getScreenSize();
      const pos = robot.getMousePos();
      return ok(`Screen: ${size.width}x${size.height}px. Mouse at (${pos.x}, ${pos.y}).`, { width: size.width, height: size.height, x: pos.x, y: pos.y });
    });

    server.registerTool('bloom_take_screenshot', {
      title: 'Take Screenshot',
      description: 'Capture the current screen state. Take before clicking to verify element positions.',
      inputSchema: z.object({}).strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    }, async () => {
      self._triggerGlow();
      const robot = getRobot();
      const size = robot.getScreenSize();
      robot.screen.capture(0, 0, size.width, size.height);
      return ok(`Screenshot captured. Screen is ${size.width}x${size.height}px.`, { width: size.width, height: size.height, captured: true });
    });

    server.registerTool('bloom_click', {
      title: 'Click',
      description: 'Move mouse to (x,y) and click. Args: x, y, button (left|right|middle, default left).',
      inputSchema: z.object({
        x: z.number().describe('X pixels from left edge'),
        y: z.number().describe('Y pixels from top edge'),
        button: z.enum(['left','right','middle']).default('left'),
      }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    }, async ({ x, y, button }) => {
      self._triggerGlow();
      const robot = getRobot();
      robot.moveMouse(x, y);
      robot.mouseClick(button);
      return ok(`Clicked ${button} at (${x}, ${y}).`);
    });

    server.registerTool('bloom_double_click', {
      title: 'Double Click',
      description: 'Double-click at (x,y). Use for opening files and apps.',
      inputSchema: z.object({
        x: z.number(),
        y: z.number(),
      }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    }, async ({ x, y }) => {
      self._triggerGlow();
      const robot = getRobot();
      robot.moveMouse(x, y);
      robot.mouseClick('left', true);
      return ok(`Double-clicked at (${x}, ${y}).`);
    });

    server.registerTool('bloom_move_mouse', {
      title: 'Move Mouse',
      description: 'Move mouse to (x,y) without clicking. Use to hover and reveal tooltips.',
      inputSchema: z.object({
        x: z.number(),
        y: z.number(),
      }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    }, async ({ x, y }) => {
      self._triggerGlow();
      getRobot().moveMouse(x, y);
      return ok(`Mouse moved to (${x}, ${y}).`);
    });

    server.registerTool('bloom_scroll', {
      title: 'Scroll',
      description: 'Scroll at (x,y). Args: x, y, direction (up|down|left|right), amount 1-20 (default 3).',
      inputSchema: z.object({
        x: z.number(),
        y: z.number(),
        direction: z.enum(['up','down','left','right']),
        amount: z.number().int().min(1).max(20).default(3),
      }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    }, async ({ x, y, direction, amount }) => {
      self._triggerGlow();
      const robot = getRobot();
      robot.moveMouse(x, y);
      if (direction === 'up') robot.scrollMouse(0, amount);
      else if (direction === 'down') robot.scrollMouse(0, -amount);
      else if (direction === 'left') robot.scrollMouse(-amount, 0);
      else robot.scrollMouse(amount, 0);
      return ok(`Scrolled ${direction} ${amount} ticks at (${x}, ${y}).`);
    });

    server.registerTool('bloom_drag', {
      title: 'Drag',
      description: 'Click-drag from (fromX,fromY) to (toX,toY).',
      inputSchema: z.object({
        fromX: z.number(), fromY: z.number(), toX: z.number(), toY: z.number(),
      }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    }, async ({ fromX, fromY, toX, toY }) => {
      self._triggerGlow();
      const robot = getRobot();
      robot.moveMouse(fromX, fromY);
      robot.mouseToggle('down');
      robot.dragMouse(toX, toY);
      robot.mouseToggle('up');
      return ok(`Dragged from (${fromX}, ${fromY}) to (${toX}, ${toY}).`);
    });

    server.registerTool('bloom_type_text', {
      title: 'Type Text',
      description: 'Type text at current cursor. Use bloom_click to focus a field first. Args: text (max 5000 chars).',
      inputSchema: z.object({
        text: z.string().min(1).max(5000),
      }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    }, async ({ text }) => {
      self._triggerGlow();
      getRobot().typeString(text);
      const preview = text.length > 80 ? text.slice(0, 80) + '...' : text;
      return ok(`Typed: "${preview}"`);
    });

    server.registerTool('bloom_key_press', {
      title: 'Key Press',
      description: 'Press a key or combo. Examples: enter, tab, escape, cmd+c, cmd+v, cmd+z, cmd+a, cmd+w.',
      inputSchema: z.object({
        key: z.string().min(1),
      }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    }, async ({ key }) => {
      self._triggerGlow();
      const robot = getRobot();
      const { key: mainKey, modifiers } = parseKey(key);
      if (modifiers.length > 0) robot.keyTap(mainKey, modifiers);
      else robot.keyTap(mainKey);
      return ok(`Pressed: ${key}`);
    });

    return server;
  }

  start() {
    if (this._started) return;
    this._started = true;

    const mcpServer = this._buildMcpServer();
    const app = express();
    app.use(express.json());
    const token = this._token;

    app.use((req, res, next) => {
      if (req.path === '/health') { next(); return; }
      if (!token) { next(); return; }
      const provided = req.headers['x-bloom-token'] || req.query.token;
      if (provided !== token) {
        res.status(401).json({ error: 'Unauthorized — invalid BLOOM Desktop token' });
        return;
      }
      next();
    });

    app.get('/health', (_req, res) => {
      res.json({ status: 'online', server: SERVER_NAME, version: SERVER_VERSION, tools: 9 });
    });

    app.post('/mcp', async (req, res) => {
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      res.on('close', () => transport.close());
      await mcpServer.connect(transport);
      await transport.handleRequest(req, res, req.body);
    });

    this._httpServer = app.listen(MCP_PORT, '127.0.0.1', () => {
      console.log(`[${SERVER_NAME}] Running on http://127.0.0.1:${MCP_PORT}/mcp`);
      console.log(`[${SERVER_NAME}] Health: http://127.0.0.1:${MCP_PORT}/health`);
      if (!token) console.warn(`[${SERVER_NAME}] WARNING: No BLOOM_MCP_TOKEN set (dev mode)`);
    });
  }

  stop() {
    if (this._httpServer) {
      this._httpServer.close();
      this._httpServer = null;
    }
    this._started = false;
  }
}

module.exports = DesktopMCPServer;
