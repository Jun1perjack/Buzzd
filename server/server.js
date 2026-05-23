'use strict';

require('dotenv').config();

const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const express = require('express');
const cors = require('cors');
const WebSocket = require('ws');
const ngrok = require('@ngrok/ngrok');
const qrcode = require('qrcode-terminal');

const roomManager = require('./roomManager');
const controller = require('./controller');
const gameManager = require('./gameManager');

const PORT = parseInt(process.env.PORT || '3000', 10);
const VERCEL_URL = (process.env.VERCEL_URL || 'http://localhost:5500').replace(/\/$/, '');
const PING_INTERVAL_MS = 30_000;

// ── Helpers ───────────────────────────────────────────────────────────────────

function getLanIp() {
  for (const iface of Object.values(os.networkInterfaces())) {
    for (const addr of iface) {
      if (addr.family === 'IPv4' && !addr.internal) return addr.address;
    }
  }
  return null;
}

function send(ws, obj) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
}

function launchPcsx2(gameId) {
  const base = process.env.PCSX2_CMD;
  if (!base) {
    console.log('[server] PCSX2_CMD not set — skipping launch');
    return;
  }
  const game = gameId ? gameManager.getGame(gameId) : null;
  const cmd = game ? `${base} "${game.filepath}"` : base;
  const child = spawn(cmd, { shell: true, detached: true, stdio: 'ignore' });
  child.unref();
  console.log(`[server] Launched: ${cmd}`);
}

// ── Express REST server ────────────────────────────────────────────────────────

const app = express();
app.use(cors());
app.use(express.json());

// Serve the frontend locally — avoids mixed-content issues when launched from Steam
const FRONTEND_DIR = path.join(__dirname, '..');
app.get('/',     (_req, res) => res.sendFile(path.join(FRONTEND_DIR, 'index.html')));
app.get('/host', (_req, res) => res.sendFile(path.join(FRONTEND_DIR, 'host.html')));
app.use(express.static(FRONTEND_DIR));

app.get('/health', (_req, res) => res.send('OK'));

app.get('/status', (_req, res) => {
  // Include vercelUrl so the host page can build correct player join links
  res.json({ ...roomManager.getStatus(), vercelUrl: process.env.VERCEL_URL || null });
});

app.get('/games', (_req, res) => {
  res.json(gameManager.getGames());
});

// Host-page "Start Game" button (no game selection — launches to PCSX2 menu or PCSX2_CMD as-is)
app.post('/start', (req, res) => {
  const { gameId } = req.body || {};
  roomManager.startGame(wss);
  launchPcsx2(gameId || null);
  res.json({ ok: true });
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
      // If Player 1 just joined and game hasn't started, send the game list
      if (ws.buzzSlot === 1 && !roomManager.getStatus().gameStarted) {
        send(ws, { type: 'games', games: gameManager.getGames() });
      }
    } else if (msg.type === 'start') {
      // Only Player 1 (host) can start the game from their phone
      if (ws.buzzSlot === 1) {
        roomManager.startGame(wss);
        launchPcsx2(msg.gameId || null);
      }
    } else if (msg.type === 'pong') {
      ws.isAlive = true;
    }
    // button messages are handled per-player in roomManager
  });

  ws.on('close', () => roomManager.handleDisconnect(ws, wss));
  ws.on('error', () => roomManager.handleDisconnect(ws, wss));
});

// Keepalive ping
const pingInterval = setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.send(JSON.stringify({ type: 'ping' }));
  }
}, PING_INTERVAL_MS);

wss.on('close', () => clearInterval(pingInterval));

// ── Startup ───────────────────────────────────────────────────────────────────

async function start() {
  await controller.init();
  await gameManager.init(process.env.ROMS_DIR, process.env.STEAMGRIDDB_API_KEY, process.env.ROMS_FILTER);

  server.listen(PORT, () => {
    console.log(`WebSocket server listening on port ${PORT}`);
  });

  const roomCode = roomManager.roomCode();

  let wsUrl = `ws://localhost:${PORT}`;
  let joinUrl = `${VERCEL_URL}/?server=${encodeURIComponent(wsUrl)}&code=${roomCode}`;
  let hostUrl = `${VERCEL_URL}/host?server=${encodeURIComponent(`http://localhost:${PORT}`)}`;

  if (process.env.NGROK_AUTHTOKEN) {
    try {
      const ngrokTimeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('timed out after 15s')), 15_000)
      );
      const tunnel = await Promise.race([
        ngrok.forward({ addr: PORT, authtoken: process.env.NGROK_AUTHTOKEN }),
        ngrokTimeout,
      ]);
      const tunnelUrl = tunnel.url();
      wsUrl = tunnelUrl.replace(/^https?/, 'wss');
      roomManager.setNgrokUrl(tunnelUrl);
      joinUrl = `${VERCEL_URL}/?server=${encodeURIComponent(wsUrl)}&code=${roomCode}`;
      hostUrl = `${VERCEL_URL}/host?server=${encodeURIComponent(tunnelUrl)}`;
      console.log(`Ngrok tunnel: ${tunnelUrl}`);
    } catch (err) {
      console.warn(`[ngrok] Failed to start tunnel: ${err.message}`);
      const lanIp = getLanIp();
      if (lanIp) {
        wsUrl = `ws://${lanIp}:${PORT}`;
        joinUrl = `${VERCEL_URL}/?server=${encodeURIComponent(wsUrl)}&code=${roomCode}`;
        hostUrl = `${VERCEL_URL}/host?server=${encodeURIComponent(`http://${lanIp}:${PORT}`)}`;
        console.warn(`[ngrok] Falling back to LAN IP: ${lanIp} — players must be on the same network.`);
      } else {
        console.warn('[ngrok] No LAN IP found — players will need to connect manually.');
      }
    }
  } else {
    console.log('[ngrok] No NGROK_AUTHTOKEN set — skipping tunnel. Players must be on the same network.');
    const lanIp = getLanIp();
    if (lanIp) {
      wsUrl = `ws://${lanIp}:${PORT}`;
      joinUrl = `${VERCEL_URL}/?server=${encodeURIComponent(wsUrl)}&code=${roomCode}`;
      hostUrl = `${VERCEL_URL}/host?server=${encodeURIComponent(`http://${lanIp}:${PORT}`)}`;
      console.log(`[ngrok] LAN fallback: ${lanIp}`);
    }
  }

  printBanner(roomCode, joinUrl, hostUrl, wsUrl);
}

function printBanner(roomCode, joinUrl, hostUrl, wsUrl) {
  console.log('\n╔══════════════════════════════════════════════╗');
  console.log('║           BUZZD CONTROLLER                   ║');
  console.log('╠══════════════════════════════════════════════╣');
  console.log(`║  Room code : ${roomCode.padEnd(32)}║`);
  console.log('╚══════════════════════════════════════════════╝\n');

  console.log('Scan this QR code to join:\n');
  qrcode.generate(joinUrl, { small: true });
  console.log(`\nJoin URL : ${joinUrl}`);
  console.log(`Host URL : ${hostUrl}`);
  console.log(`WS URL   : ${wsUrl}`);
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
