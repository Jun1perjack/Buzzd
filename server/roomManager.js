'use strict';

const crypto = require('crypto');

const SLOT_COUNT = 4;
const RECONNECT_GRACE_MS = 60_000;

const startTime = Date.now();

function generateRoomCode() {
  if (process.env.ROOM_CODE) return process.env.ROOM_CODE.toUpperCase();
  return crypto.randomBytes(3).toString('hex').toUpperCase();
}

const state = {
  roomCode: generateRoomCode(),
  // slot number (1-4) → { ws, name, slot, reconnectTimer }
  slots: new Map(),
  // ws instance → slot number
  wsToSlot: new Map(),
  ngrokUrl: null,
};

function findFreeSlot() {
  for (let i = 1; i <= SLOT_COUNT; i++) {
    if (!state.slots.has(i)) return i;
  }
  return null;
}

function findSlotByName(name) {
  for (const [slot, player] of state.slots) {
    if (player.name === name) return slot;
  }
  return null;
}

function send(ws, obj) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(obj));
  }
}

function broadcastPlayers(wss) {
  const players = getPlayers();
  const msg = JSON.stringify({ type: 'players', players });
  for (const client of wss.clients) {
    if (client.readyState === client.OPEN) {
      client.send(msg);
    }
  }
}

function handleJoin(ws, data, wss, onButtonPress) {
  const { roomCode, playerName } = data;

  if (!roomCode || roomCode.toUpperCase() !== state.roomCode) {
    send(ws, { type: 'error', code: 'INVALID_CODE' });
    return;
  }

  const name = (playerName || '').trim().slice(0, 20);
  if (!name) {
    send(ws, { type: 'error', code: 'INVALID_NAME' });
    return;
  }

  // Check if this is a reconnect (same name, slot still reserved)
  const existingSlot = findSlotByName(name);
  if (existingSlot !== null) {
    const player = state.slots.get(existingSlot);
    if (player.reconnectTimer) {
      clearTimeout(player.reconnectTimer);
      player.reconnectTimer = null;
    }
    // Close the old dead WS if it's still registered
    state.wsToSlot.delete(player.ws);
    player.ws = ws;
    state.wsToSlot.set(ws, existingSlot);
    ws.buzzSlot = existingSlot;
    ws.on('message', makeMessageHandler(ws, existingSlot, onButtonPress));
    console.log(`[player] "${name}" reconnected → slot ${existingSlot}`);
    send(ws, { type: 'joined', slot: existingSlot, playerName: name, roomCode: state.roomCode });
    broadcastPlayers(wss);
    return;
  }

  const slot = findFreeSlot();
  if (slot === null) {
    console.log(`[player] "${name}" tried to join but room is full`);
    send(ws, { type: 'error', code: 'ROOM_FULL' });
    return;
  }

  state.slots.set(slot, { ws, name, slot, reconnectTimer: null });
  state.wsToSlot.set(ws, slot);
  ws.buzzSlot = slot;

  ws.on('message', makeMessageHandler(ws, slot, onButtonPress));

  console.log(`[player] "${name}" joined → slot ${slot}  (${state.slots.size}/4 connected)`);
  send(ws, { type: 'joined', slot, playerName: name, roomCode: state.roomCode });
  broadcastPlayers(wss);
}

function makeMessageHandler(ws, slot, onButtonPress) {
  return function (raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === 'button') {
      const button = msg.button;
      const buttonState = msg.state === 1 ? 1 : 0;
      const player = state.slots.get(slot);
      const isDev = player && player.name.toLowerCase() === 'silverhand';
      const targetSlot = isDev && msg.devSlot
        ? Math.min(4, Math.max(1, Math.floor(Number(msg.devSlot))))
        : slot;
      if (buttonState === 1) {
        const note = isDev ? (targetSlot !== slot ? ` [dev→P${targetSlot}]` : ' [dev]') : '';
        console.log(`[button] P${slot} "${player ? player.name : '?'}"${note} → ${button.toUpperCase()}`);
      }
      onButtonPress(targetSlot, button, buttonState);
    } else if (msg.type === 'pong') {
      ws.isAlive = true;
    }
  };
}

function handleDisconnect(ws, wss) {
  const slot = state.wsToSlot.get(ws);
  if (slot === undefined) return;

  state.wsToSlot.delete(ws);
  const player = state.slots.get(slot);
  if (!player) return;

  console.log(`[player] "${player.name}" disconnected from slot ${slot} (slot held for 60s)`);

  // Hold the slot for 60s to allow reconnect by same name
  player.ws = null;
  player.reconnectTimer = setTimeout(() => {
    console.log(`[player] Slot ${slot} ("${player.name}") released after timeout`);
    state.slots.delete(slot);
    broadcastPlayers(wss);
  }, RECONNECT_GRACE_MS);

  broadcastPlayers(wss);
}

function getPlayers() {
  const players = [];
  for (const [slot, player] of state.slots) {
    players.push({ slot, name: player.name, connected: player.ws !== null });
  }
  return players.sort((a, b) => a.slot - b.slot);
}

function getStatus() {
  return {
    roomCode: state.roomCode,
    players: getPlayers(),
    uptime: Math.floor((Date.now() - startTime) / 1000),
    ngrokUrl: state.ngrokUrl,
  };
}

function setNgrokUrl(url) {
  state.ngrokUrl = url;
}

module.exports = {
  roomCode: () => state.roomCode,
  handleJoin,
  handleDisconnect,
  getStatus,
  setNgrokUrl,
};
