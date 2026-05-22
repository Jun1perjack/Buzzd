'use strict';

const BUTTONS = ['buzz', 'blue', 'orange', 'green', 'yellow'];

// Audio feedback for browsers without Vibration API (iOS Safari)
let _audioCtx = null;
function _ctx() {
  if (!_audioCtx) _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (_audioCtx.state === 'suspended') _audioCtx.resume();
  return _audioCtx;
}
function playClick() {
  const ctx = _ctx(), osc = ctx.createOscillator(), g = ctx.createGain();
  osc.connect(g); g.connect(ctx.destination);
  osc.type = 'sine'; osc.frequency.value = 1100;
  g.gain.setValueAtTime(0.25, ctx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.025);
  osc.start(); osc.stop(ctx.currentTime + 0.025);
}
function playBuzz() {
  const ctx = _ctx(), osc = ctx.createOscillator(), g = ctx.createGain();
  osc.connect(g); g.connect(ctx.destination);
  osc.type = 'square';
  osc.frequency.setValueAtTime(130, ctx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(60, ctx.currentTime + 0.18);
  g.gain.setValueAtTime(0.3, ctx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18);
  osc.start(); osc.stop(ctx.currentTime + 0.19);
}
const BACKOFF_STEPS = [1000, 2000, 4000, 8000, 16000, 30000];

let ws = null;
let reconnectAttempt = 0;
let reconnectTimer = null;
let serverUrl = null;
let roomCode = null;
let playerName = null;
let hasJoined = false;

let devMode = false;
let ownSlot = 1;
let devTargetSlot = 1;
let selectedGameId = null;

// ── DOM refs ─────────────────────────────────────────────────────────────────

const joinScreen = document.getElementById('join-screen');
const lobbyScreen = document.getElementById('lobby-screen');
const lobbyPlayersEl = document.getElementById('lobby-players');
const lobbyInfoEl = document.getElementById('lobby-info');
const pickerScreen = document.getElementById('picker-screen');
const pickerInfo = document.getElementById('picker-info');
const gameGrid = document.getElementById('game-grid');
const pickerEmpty = document.getElementById('picker-empty');
const btnStartPicker = document.getElementById('btn-start-picker');
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
      if (msg.gameStarted) {
        showController(msg.slot, msg.playerName);
      } else if (msg.slot === 1) {
        showPickerLoading(msg.slot, msg.playerName);
      } else {
        showLobby(msg.slot, msg.playerName);
      }
      break;

    case 'games':
      renderGames(msg.games);
      break;

    case 'start':
      showController(ownSlot, playerName);
      break;

    case 'error': {
      btnJoin.disabled = false;
      const messages = {
        ROOM_FULL: 'Room is full (4 players max).',
        INVALID_CODE: 'Wrong room code.',
        NAME_TAKEN: 'That name is already connected.',
        INVALID_NAME: 'Please enter a valid name.',
      };
      setStatus(messages[msg.code] || 'Connection error.', 'error');
      break;
    }

    case 'ping':
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'pong' }));
      }
      break;

    case 'players':
      updateLobbyPlayers(msg.players);
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

// ── Game Picker UI (Player 1 / host) ──────────────────────────────────────────

function showPickerLoading(slot, name) {
  ownSlot = slot;
  joinScreen.classList.add('hidden');
  pickerScreen.classList.remove('hidden');
  pickerInfo.innerHTML = `You are the host — <strong>Player ${slot}</strong>`;
}

function renderGames(games) {
  // Remove any previously rendered cards (keep the empty-state element)
  Array.from(gameGrid.children).forEach((el) => {
    if (el !== pickerEmpty) gameGrid.removeChild(el);
  });

  if (!games.length) {
    pickerEmpty.classList.remove('hidden');
    return;
  }
  pickerEmpty.classList.add('hidden');

  games.forEach((game) => {
    const card = document.createElement('button');
    card.className = 'game-card';
    card.dataset.gameId = game.id;

    const cover = document.createElement('div');
    cover.className = 'game-cover';

    const fallback = document.createElement('span');
    fallback.className = 'game-cover-fallback';
    fallback.textContent = game.name[0].toUpperCase();
    cover.appendChild(fallback);

    if (game.coverUrl) {
      const img = document.createElement('img');
      img.src = game.coverUrl;
      img.alt = game.name;
      img.loading = 'lazy';
      img.onerror = () => img.remove();
      cover.appendChild(img);
    }

    const label = document.createElement('span');
    label.className = 'game-name';
    label.textContent = game.name;

    card.appendChild(cover);
    card.appendChild(label);
    card.addEventListener('click', () => selectGame(game.id));
    gameGrid.appendChild(card);
  });
}

function selectGame(id) {
  selectedGameId = id;
  document.querySelectorAll('.game-card').forEach((c) => {
    c.classList.toggle('selected', c.dataset.gameId === id);
  });
  btnStartPicker.disabled = false;
  btnStartPicker.textContent = 'Start Game ▶';
}

// ── Lobby UI ──────────────────────────────────────────────────────────────────

function showLobby(slot, name) {
  ownSlot = slot;
  joinScreen.classList.add('hidden');
  lobbyScreen.classList.remove('hidden');
  lobbyInfoEl.innerHTML = `You are <strong>Player ${slot}</strong> — <strong>${name}</strong>`;
}


function updateLobbyPlayers(players) {
  if (lobbyScreen.classList.contains('hidden')) return;
  lobbyPlayersEl.innerHTML = '';
  for (let i = 1; i <= 4; i++) {
    const p = players.find((pl) => pl.slot === i);
    const item = document.createElement('div');
    item.className = 'lobby-player-item';
    item.innerHTML = `
      <span class="slot-num">${i}</span>
      <span class="slot-name${p ? '' : ' slot-empty'}">${p ? p.name : 'Empty'}</span>
      <span class="slot-dot${p && p.connected ? ' connected' : ''}"></span>
    `;
    lobbyPlayersEl.appendChild(item);
  }
}

// ── Controller UI ─────────────────────────────────────────────────────────────

function showController(slot, name) {
  ownSlot = slot;
  joinScreen.classList.add('hidden');
  lobbyScreen.classList.add('hidden');
  pickerScreen.classList.add('hidden');
  controllerScreen.classList.remove('hidden');
  playerInfo.innerHTML = `Player <strong>${slot}</strong> — <strong>${name}</strong>`;

  if (name.toLowerCase() === 'silverhand') {
    devMode = true;
    devTargetSlot = slot;
    controllerScreen.classList.add('dev-mode');
    document.getElementById('dev-panel').classList.remove('hidden');
    document.querySelectorAll('.dev-slot-btn').forEach(btn => {
      btn.classList.toggle('active', parseInt(btn.dataset.slot) === slot);
    });
    document.getElementById('dev-target-label').textContent = `P${slot}`;
  }
}

function sendButton(button, state) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    const msg = { type: 'button', button, state };
    if (devMode) msg.devSlot = devTargetSlot;
    ws.send(JSON.stringify(msg));
  }
}

function releaseAllButtons() {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  for (const button of BUTTONS) {
    ws.send(JSON.stringify({ type: 'button', button, state: 0 }));
    if (devMode && devTargetSlot !== ownSlot) {
      ws.send(JSON.stringify({ type: 'button', button, state: 0, devSlot: devTargetSlot }));
    }
  }
}

// Attach events to all controller buttons
document.addEventListener('DOMContentLoaded', () => {
  // Game picker start button
  btnStartPicker.addEventListener('click', () => {
    if (!selectedGameId || !ws || ws.readyState !== WebSocket.OPEN) return;
    btnStartPicker.disabled = true;
    btnStartPicker.textContent = 'Starting…';
    ws.send(JSON.stringify({ type: 'start', gameId: selectedGameId }));
  });

  // Dev slot picker
  document.querySelectorAll('.dev-slot-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      devTargetSlot = parseInt(btn.dataset.slot);
      document.querySelectorAll('.dev-slot-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('dev-target-label').textContent = `P${devTargetSlot}`;
    });
  });

  const allButtons = document.querySelectorAll('[data-button]');

  allButtons.forEach((el) => {
    const button = el.dataset.button;

    function onPress(e) {
      e.preventDefault();
      el.classList.add('pressed');
      if (navigator.vibrate) {
        navigator.vibrate(button === 'buzz' ? [30, 20, 60] : 15);
      } else {
        button === 'buzz' ? playBuzz() : playClick();
      }
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
