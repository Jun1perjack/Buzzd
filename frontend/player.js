'use strict';

const BUTTONS = ['buzz', 'blue', 'orange', 'green', 'yellow'];
const BACKOFF_STEPS = [1000, 2000, 4000, 8000, 16000, 30000];

let ws = null;
let reconnectAttempt = 0;
let reconnectTimer = null;
let serverUrl = null;
let roomCode = null;
let playerName = null;
let hasJoined = false;

// ── DOM refs ─────────────────────────────────────────────────────────────────

const joinScreen = document.getElementById('join-screen');
const controllerScreen = document.getElementById('controller-screen');
const reconnectOverlay = document.getElementById('reconnect-overlay');
const reconnectMsg = document.getElementById('reconnect-msg');

const inputCode = document.getElementById('input-code');
const inputName = document.getElementById('input-name');
const btnJoin = document.getElementById('btn-join');
const statusMsg = document.getElementById('status-msg');
const playerInfo = document.getElementById('player-info');

// ── URL param pre-fill ────────────────────────────────────────────────────────

(function prefill() {
  const params = new URL(location.href).searchParams;
  const srv = params.get('server');
  const code = params.get('code');
  if (srv) serverUrl = srv.replace(/^https?/, 'wss');
  if (code) inputCode.value = code;
})();

// ── Join ──────────────────────────────────────────────────────────────────────

btnJoin.addEventListener('click', attemptJoin);
inputName.addEventListener('keydown', (e) => { if (e.key === 'Enter') attemptJoin(); });
inputCode.addEventListener('keydown', (e) => { if (e.key === 'Enter') inputName.focus(); });

function attemptJoin() {
  const code = inputCode.value.trim().toUpperCase();
  const name = inputName.value.trim();

  if (!code) { shake(inputCode); return; }
  if (!name) { shake(inputName); return; }

  roomCode = code;
  playerName = name;

  // Use ?server= param if available, otherwise prompt
  if (!serverUrl) {
    setStatus('No server URL. Use the QR code link from the host.', 'error');
    return;
  }

  btnJoin.disabled = true;
  setStatus('Connecting…');
  connect();
}

function shake(el) {
  el.classList.remove('error');
  void el.offsetWidth; // reflow
  el.classList.add('error');
  el.focus();
  setTimeout(() => el.classList.remove('error'), 500);
}

function setStatus(msg, type = '') {
  statusMsg.textContent = msg;
  statusMsg.className = 'status-msg ' + type;
}

// ── WebSocket ─────────────────────────────────────────────────────────────────

function connect() {
  if (ws) {
    ws.onclose = null;
    ws.onerror = null;
    try { ws.close(); } catch {}
    ws = null;
  }

  ws = new WebSocket(serverUrl);

  ws.onopen = () => {
    reconnectAttempt = 0;
    ws.send(JSON.stringify({ type: 'join', roomCode, playerName }));
  };

  ws.onmessage = (event) => {
    let msg;
    try { msg = JSON.parse(event.data); } catch { return; }
    handleMessage(msg);
  };

  ws.onclose = () => onDisconnect();
  ws.onerror = () => onDisconnect();
}

function handleMessage(msg) {
  switch (msg.type) {
    case 'joined':
      hasJoined = true;
      reconnectAttempt = 0;
      reconnectOverlay.classList.add('hidden');
      showController(msg.slot, msg.playerName);
      break;

    case 'error':
      btnJoin.disabled = false;
      const messages = {
        ROOM_FULL: 'Room is full (4 players max).',
        INVALID_CODE: 'Wrong room code.',
        NAME_TAKEN: 'That name is already connected.',
        INVALID_NAME: 'Please enter a valid name.',
      };
      setStatus(messages[msg.code] || 'Connection error.', 'error');
      break;

    case 'ping':
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'pong' }));
      }
      break;

    case 'players':
      // Could show connected count if desired
      break;
  }
}

function onDisconnect() {
  if (!hasJoined) {
    btnJoin.disabled = false;
    setStatus('Connection failed. Check the server URL.', 'error');
    return;
  }

  // Release all buttons to prevent stuck inputs
  releaseAllButtons();

  // Show reconnect overlay
  reconnectOverlay.classList.remove('hidden');
  scheduleReconnect();
}

function scheduleReconnect() {
  clearTimeout(reconnectTimer);
  const delay = BACKOFF_STEPS[Math.min(reconnectAttempt, BACKOFF_STEPS.length - 1)];
  reconnectAttempt++;
  reconnectMsg.textContent = `Reconnecting in ${Math.round(delay / 1000)}s…`;
  reconnectTimer = setTimeout(() => {
    reconnectMsg.textContent = 'Reconnecting…';
    connect();
  }, delay);
}

// ── Controller UI ─────────────────────────────────────────────────────────────

function showController(slot, name) {
  joinScreen.classList.add('hidden');
  controllerScreen.classList.remove('hidden');
  playerInfo.innerHTML = `Player <strong>${slot}</strong> — <strong>${name}</strong>`;
}

function sendButton(button, state) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'button', button, state }));
  }
}

function releaseAllButtons() {
  for (const button of BUTTONS) {
    sendButton(button, 0);
  }
}

// Attach events to all controller buttons
document.addEventListener('DOMContentLoaded', () => {
  const allButtons = document.querySelectorAll('[data-button]');

  allButtons.forEach((el) => {
    const button = el.dataset.button;

    function onPress(e) {
      e.preventDefault();
      el.classList.add('pressed');
      sendButton(button, 1);
    }

    function onRelease(e) {
      e.preventDefault();
      el.classList.remove('pressed');
      sendButton(button, 0);
    }

    el.addEventListener('touchstart', onPress, { passive: false });
    el.addEventListener('touchend', onRelease, { passive: false });
    el.addEventListener('touchcancel', onRelease, { passive: false });
    el.addEventListener('mousedown', onPress);
    el.addEventListener('mouseup', onRelease);
    el.addEventListener('mouseleave', (e) => {
      if (e.buttons > 0) onRelease(e); // drag away while held
    });

    // Prevent context menu on long press
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  });
});
