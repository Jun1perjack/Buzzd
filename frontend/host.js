'use strict';

let ngrokBase = null;  // the https:// URL of the server
let pollTimer = null;
let joinUrl = null;

const POLL_INTERVAL_MS = 3000;
const VERCEL_URL = window.location.origin;

// ── DOM refs ─────────────────────────────────────────────────────────────────

const ngrokInput = document.getElementById('ngrok-input');
const btnConnect = document.getElementById('btn-connect-server');
const serverStatus = document.getElementById('server-status');
const setupSection = document.getElementById('setup-section');
const dashSection = document.getElementById('dash-section');
const roomCodeEl = document.getElementById('room-code');
const joinUrlEl = document.getElementById('join-url-text');
const btnCopy = document.getElementById('btn-copy');
const qrCanvas = document.getElementById('qr-canvas');
const playerSlots = document.querySelectorAll('.player-slot');
const btnStartGame = document.getElementById('btn-start-game');
const startStatus = document.getElementById('start-status');

// ── Connect to server ─────────────────────────────────────────────────────────

btnConnect.addEventListener('click', connectToServer);
ngrokInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') connectToServer(); });

// Auto-connect if ?server= param is present (e.g. link from server banner)
(function autoConnect() {
  const srv = new URL(location.href).searchParams.get('server');
  if (!srv) return;
  setupSection.classList.add('hidden');
  ngrokBase = srv.startsWith('http') ? srv.replace(/\/$/, '') : `https://${srv}`;
  fetchStatus()
    .then(onServerConnected)
    .catch((err) => {
      setupSection.classList.remove('hidden');
      serverStatus.textContent = `Auto-connect failed: ${err.message}`;
      serverStatus.className = 'status-msg error';
    });
})();

async function connectToServer() {
  const raw = ngrokInput.value.trim().replace(/\/$/, '');
  if (!raw) return;

  ngrokBase = raw.startsWith('http') ? raw : `https://${raw}`;
  btnConnect.disabled = true;
  serverStatus.textContent = 'Connecting…';
  serverStatus.className = 'status-msg';

  try {
    const data = await fetchStatus();
    onServerConnected(data);
  } catch (err) {
    serverStatus.textContent = `Could not reach server: ${err.message}`;
    serverStatus.className = 'status-msg error';
    btnConnect.disabled = false;
    ngrokBase = null;
  }
}

async function fetchStatus() {
  const res = await fetch(`${ngrokBase}/status`, {
    headers: { 'ngrok-skip-browser-warning': 'true' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function onServerConnected(data) {
  const roomCode = data.roomCode;
  const wsUrl = ngrokBase.replace(/^https?/, 'wss');
  joinUrl = `${VERCEL_URL}/?server=${encodeURIComponent(wsUrl)}&code=${roomCode}`;

  setupSection.classList.add('hidden');
  dashSection.classList.remove('hidden');

  roomCodeEl.textContent = roomCode;
  joinUrlEl.textContent = joinUrl;

  renderQR(joinUrl);
  renderPlayers(data.players || []);

  startPolling();
}

// ── Polling ───────────────────────────────────────────────────────────────────

function startPolling() {
  stopPolling();
  pollTimer = setInterval(async () => {
    try {
      const data = await fetchStatus();
      renderPlayers(data.players || []);
    } catch {
      // Silently ignore transient failures
    }
  }, POLL_INTERVAL_MS);
}

function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

// ── Render players ────────────────────────────────────────────────────────────

function renderPlayers(players) {
  // Reset all slots
  playerSlots.forEach((slot, idx) => {
    const num = idx + 1;
    const dot = slot.querySelector('.slot-dot');
    const nameEl = slot.querySelector('.slot-name');
    const player = players.find((p) => p.slot === num);

    if (player) {
      nameEl.textContent = player.name;
      nameEl.classList.remove('slot-empty');
      dot.className = `slot-dot${player.connected ? ' connected' : ''}`;
    } else {
      nameEl.textContent = 'Empty';
      nameEl.classList.add('slot-empty');
      dot.className = 'slot-dot';
    }
  });
}

// ── QR code ───────────────────────────────────────────────────────────────────

function renderQR(url) {
  if (typeof QRCode === 'undefined') return;
  qrCanvas.innerHTML = '';
  new QRCode(qrCanvas, {
    text: url,
    width: 200,
    height: 200,
    colorDark: '#000000',
    colorLight: '#ffffff',
    correctLevel: QRCode.CorrectLevel.M,
  });
}

// ── Copy join URL ─────────────────────────────────────────────────────────────

btnCopy.addEventListener('click', async () => {
  if (!joinUrl) return;
  try {
    await navigator.clipboard.writeText(joinUrl);
    btnCopy.textContent = 'Copied!';
    setTimeout(() => { btnCopy.textContent = 'Copy Link'; }, 2000);
  } catch {
    // Fallback: select the text
    const range = document.createRange();
    range.selectNode(joinUrlEl);
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(range);
  }
});

// ── Start Game ────────────────────────────────────────────────────────────────

btnStartGame.addEventListener('click', async () => {
  btnStartGame.disabled = true;
  startStatus.textContent = 'Starting…';
  startStatus.className = 'status-msg';
  try {
    const res = await fetch(`${ngrokBase}/start`, {
      method: 'POST',
      headers: { 'ngrok-skip-browser-warning': 'true' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    startStatus.textContent = 'Game started!';
    startStatus.className = 'status-msg ok';
    btnStartGame.textContent = 'Game Running';
  } catch (err) {
    startStatus.textContent = `Failed: ${err.message}`;
    startStatus.className = 'status-msg error';
    btnStartGame.disabled = false;
  }
});

// ── Reset (change ngrok URL) ──────────────────────────────────────────────────

document.getElementById('btn-reset').addEventListener('click', () => {
  stopPolling();
  ngrokBase = null;
  joinUrl = null;
  setupSection.classList.remove('hidden');
  dashSection.classList.add('hidden');
  serverStatus.textContent = '';
  serverStatus.className = 'status-msg';
  btnConnect.disabled = false;
});
