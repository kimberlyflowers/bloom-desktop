// BLOOM Desktop — Renderer
let frames = 0;
let lastFrameTime = 0;
let fpsHistory = [];
let statusPolling = null;

// These get set dynamically after auth
let SARAH_URL = 'https://autonomous-sarah-rodriguez-production.up.railway.app';
let currentUser = null;
let currentOrg = null;
let currentAgent = null;

function el(id) { return document.getElementById(id); }

// ── INIT ──────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
  el('emergency-key').textContent =
    window.electronAPI?.platform === 'darwin' ? 'Cmd+Shift+Esc' : 'Ctrl+Shift+Esc';

  // Try restoring a previous session
  if (window.authAPI) {
    const result = await window.authAPI.tryRestore();
    if (result && result.success) {
      onAuthSuccess(result);
      return;
    }
  }

  // No stored session — show sign-in screen
  showScreen('signin');
});

// ── AUTH ─────────────────────────────────────────────────────────────────
function showScreen(screen) {
  el('screen-signin').style.display = screen === 'signin' ? 'flex' : 'none';
  el('screen-app').style.display = screen === 'app' ? 'block' : 'none';
}

async function handleSignIn() {
  const email = el('signin-email').value.trim();
  const password = el('signin-password').value;
  const errorEl = el('signin-error');
  const btn = el('signin-btn');

  if (!email || !password) {
    errorEl.textContent = 'Enter your email and password';
    return;
  }

  errorEl.textContent = '';
  btn.textContent = 'Signing in...';
  btn.disabled = true;

  try {
    const result = await window.authAPI.signIn(email, password);

    if (!result.success) {
      errorEl.textContent = result.error || 'Sign-in failed';
      btn.textContent = 'Sign In';
      btn.disabled = false;
      return;
    }

    onAuthSuccess(result);
  } catch (err) {
    errorEl.textContent = 'Connection error. Try again.';
    btn.textContent = 'Sign In';
    btn.disabled = false;
  }
}

function onAuthSuccess(result) {
  currentUser = result.user;
  currentOrg = result.org;
  currentAgent = result.agent;

  // Populate the UI with real data
  const agentName = currentAgent?.name || 'Your Bloomie';
  const initials = agentName.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  el('agent-avatar').textContent = initials;
  el('agent-name-display').textContent = agentName;
  el('agent-role-display').textContent = `AI Employee · ${currentOrg?.name || 'BLOOM'}`;
  el('dashboard-link-text').textContent = `Open ${agentName.split(' ')[0]}'s Dashboard`;

  // Switch to app screen
  showScreen('app');

  // Start status polling and FPS bar
  startStatusPolling();
  animateFpsBar();

  // Register desktop with Railway (fire-and-forget)
  window.authAPI.registerDesktop().catch(() => {});
}

async function handleSignOut() {
  if (window.authAPI) {
    await window.authAPI.signOut();
  }
  currentUser = null;
  currentOrg = null;
  currentAgent = null;

  // Reset form
  el('signin-email').value = '';
  el('signin-password').value = '';
  el('signin-error').textContent = '';
  el('signin-btn').textContent = 'Sign In';
  el('signin-btn').disabled = false;

  // Stop polling
  if (statusPolling) {
    clearInterval(statusPolling);
    statusPolling = null;
  }

  showScreen('signin');
}

// Enter key submits signin form
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && el('screen-signin').style.display !== 'none') {
    handleSignIn();
  }
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

// ── TAB SWITCHING ─────────────────────────────────────────────────────────
function switchTab(tab) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.getElementById('tab-' + tab).classList.add('active');
  document.getElementById('panel-status').style.display = tab === 'status' ? 'block' : 'none';
  document.getElementById('panel-cowork').style.display = tab === 'cowork' ? 'block' : 'none';
  if (tab === 'cowork' && !window._sseConnected) connectSSE();
}

// ── SSE TASK PROGRESS ─────────────────────────────────────────────────────
let _sseSource = null;
window._sseConnected = false;

function connectSSE() {
  if (_sseSource) _sseSource.close();
  const statusEl = el('cowork-status');
  statusEl.textContent = 'Connecting...';
  statusEl.className = 'cowork-status';

  _sseSource = new EventSource(SARAH_URL + '/api/chat/progress-stream?sessionId=default');

  _sseSource.onopen = () => {
    statusEl.textContent = 'Connected';
    statusEl.className = 'cowork-status live';
    window._sseConnected = true;
  };

  _sseSource.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.connected) return;
      if (data.todos) renderTodos(data.todos);
    } catch (e) {}
  };

  _sseSource.onerror = () => {
    statusEl.textContent = 'Reconnecting...';
    statusEl.className = 'cowork-status';
    window._sseConnected = false;
  };
}

function renderTodos(todos) {
  const list = el('todo-list');
  if (!todos || todos.length === 0) {
    const name = currentAgent?.name?.split(' ')[0] || 'your Bloomie';
    list.innerHTML = `<div class="todo-empty">Waiting for ${escapeHtml(name)} to start a task...</div>`;
    return;
  }
  list.innerHTML = todos.map(t => {
    const icon = t.status === 'completed' ? '\u2713' : t.status === 'in_progress' ? '\u25B6' : '';
    const label = t.status === 'in_progress' ? t.activeForm : t.content;
    return `<div class="todo-item ${t.status}">
      <div class="todo-icon">${icon}</div>
      <span class="todo-text">${escapeHtml(label)}</span>
    </div>`;
  }).join('');
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
