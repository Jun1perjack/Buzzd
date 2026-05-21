'use strict';

require('dotenv').config();

const http = require('http');
const express = require('express');
const cors = require('cors');
const WebSocket = require('ws');
const ngrok = require('@ngrok/ngrok');
const qrcode = require('qrcode-terminal');

const roomManager = require('./roomManager');
const controller = require('./controller');

const PORT = parseInt(process.env.PORT || '3000', 10);
const VERCEL_URL = (process.env.VERCEL_URL || 'http://localhost:5500').replace(/\/$/, '');
const PING_INTERVAL_MS = 30_000;

// ── Express REST server ────────────────────────────────────────────────────────

const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => res.send('OK'));

app.get('/status', (_req, res) => {
  res.json(roomManager.getStatus());
});

// ── HTTP + WebSocket server ────────────────────────────────────────────────────

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.buzzSlot = null;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === 'join') {
      roomManager.handleJoin(ws, msg, wss, controller.pressButton.bind(controller));
    } else if (msg.type === 'pong') {
      ws.isAlive = true;
    }
    // button/release messages are handled per-player in roomManager
  });

  ws.on('close', () => {
    roomManager.handleDisconnect(ws, wss);
  });

  ws.on('error', () => {
    roomManager.handleDisconnect(ws, wss);
  });
});

// Keepalive ping
const pingInterval = setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.send(JSON.stringify({ type: 'ping' }));
  }
}, PING_INTERVAL_MS);

wss.on('close', () => clearInterval(pingInterval));

// ── Startup ───────────────────────────────────────────────────────────────────

async function start() {
  await controller.init();

  server.listen(PORT, () => {
    console.log(`WebSocket server listening on port ${PORT}`);
  });

  const roomCode = roomManager.roomCode();

  let wsUrl = `ws://localhost:${PORT}`;
  let joinUrl = `${VERCEL_URL}/?server=${encodeURIComponent(wsUrl)}&code=${roomCode}`;

  if (process.env.NGROK_AUTHTOKEN) {
    try {
      const tunnel = await ngrok.forward({
        addr: PORT,
        authtoken: process.env.NGROK_AUTHTOKEN,
      });
      const tunnelUrl = tunnel.url(); // https://xxx.ngrok-free.app
      wsUrl = tunnelUrl.replace(/^https?/, 'wss');
      roomManager.setNgrokUrl(tunnelUrl);
      joinUrl = `${VERCEL_URL}/?server=${encodeURIComponent(wsUrl)}&code=${roomCode}`;
      console.log(`Ngrok tunnel: ${tunnelUrl}`);
    } catch (err) {
      console.warn(`[ngrok] Failed to start tunnel: ${err.message}`);
      console.warn('[ngrok] Players will need to connect over LAN.');
    }
  } else {
    console.log('[ngrok] No NGROK_AUTHTOKEN set — skipping tunnel. Players must be on the same network.');
  }

  printBanner(roomCode, joinUrl, wsUrl);
}

function printBanner(roomCode, joinUrl, wsUrl) {
  console.log('\n╔══════════════════════════════════════════════╗');
  console.log('║           BUZZD CONTROLLER                   ║');
  console.log('╠══════════════════════════════════════════════╣');
  console.log(`║  Room code : ${roomCode.padEnd(32)}║`);
  console.log('╚══════════════════════════════════════════════╝\n');

  console.log('Scan this QR code to join:\n');
  qrcode.generate(joinUrl, { small: true });
  console.log(`\nJoin URL: ${joinUrl}`);
  console.log(`WS URL  : ${wsUrl}`);
  console.log('\nWaiting for players...\n');
}

start().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

process.on('SIGINT', () => {
  controller.destroy();
  process.exit(0);
});
