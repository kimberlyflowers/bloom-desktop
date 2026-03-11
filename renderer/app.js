// BLOOM Desktop — Renderer
let frames = 0;
let lastFrameTime = 0;
let fpsHistory = [];
let statusPolling = null;

const SARAH_URL = 'https://autonomous-sarah-rodriguez-production.up.railway.app';

function el(id) { return document.getElementById(id); }

// ── INIT ──────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  el('emergency-key').textContent =
    window.electronAPI?.platform === 'darwin' ? 'Cmd+Shift+Esc' : 'Ctrl+Shift+Esc';

  startStatusPolling();
  animateFpsBar();
});

// ── STATUS POLLING ─────────────────────────────────────────────────────────
function startStatusPolling() {
  pollStatus();
  statusPolling = setInterval(pollStatus, 2000);
}

async function pollStatus() {
  if (!window.bridgeAPI) return;
  try {
    const status = await window.bridgeAPI.getStatus();
    updateStreamStatus(status);
  } catch (e) {
    setDot('error', 'Error');
  }
}

function updateStreamStatus(status) {
  if (status.captureActive) {
    setDot('live', 'Streaming live');
    el('btn-stop').disabled = false;
    el('control-border').classList.add('active');
  } else {
    setDot('connecting', 'Connecting...');
    el('btn-stop').disabled = true;
    el('control-border').classList.remove('active');
  }

  el('browser-val').textContent = status.browserConnected ? 'Connected' : 'Idle';
  el('browser-val').className = 'val ' + (status.browserConnected ? 'ok' : '');
}

function setDot(state, label) {
  const dot = el('stream-dot');
  dot.className = 'status-dot ' + state;
  el('stream-label').textContent = label;
}

// ── FPS BAR HEARTBEAT ──────────────────────────────────────────────────────
function animateFpsBar() {
  let pos = 0;
  let dir = 1;
  setInterval(() => {
    pos += dir * 3;
    if (pos >= 100) dir = -1;
    if (pos <= 0)   dir =  1;
    el('fps-bar').style.width = pos + '%';
  }, 40);
}

// ── FRAME COUNTER (if main process sends frame events) ────────────────────
if (window.bridgeAPI?.onBridgeStatus) {
  window.bridgeAPI.onBridgeStatus((event, status) => {
    updateStreamStatus(status);
  });
}

// ── ACTIONS ───────────────────────────────────────────────────────────────
async function testDashboard() {
  const btn = el('btn-test');
  btn.textContent = 'Testing...';
  btn.disabled = true;

  try {
    const result = await window.bridgeAPI?.testDashboard();
    if (result?.success) {
      el('latency-val').textContent = result.latencyMs + 'ms';
      el('latency-val').className = 'val ok';
      btn.textContent = 'Connected';
      setTimeout(() => {
        btn.textContent = 'Test Connection';
        btn.disabled = false;
      }, 2000);
    } else {
      el('latency-val').textContent = 'Error';
      el('latency-val').className = 'val warn';
      btn.textContent = 'Test Connection';
      btn.disabled = false;
    }
  } catch (e) {
    btn.textContent = 'Test Connection';
    btn.disabled = false;
  }
}

function emergencyStop() {
  window.electronAPI?.revokePermission('Emergency stop');
  window.bridgeAPI?.glowHide();
  setDot('error', 'Stopped');
  el('control-border').classList.remove('active');
}

function openDashboard() {
  window.bridgeAPI?.openExternal(SARAH_URL);
}
