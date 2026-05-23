'use strict';

require('dotenv').config();

const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const express = require('express');
const cors = require('cors');
const WebSocket = require('ws');
const qrcode = require('qrcode-terminal');

const roomManager = require('./roomManager');
const controller = require('./controller');
const gameManager = require('./gameManager');

const PORT = parseInt(process.env.PORT || '3000', 10);
const VERCEL_URL = (process.env.VERCEL_URL || 'http://localhost:5500').replace(/\/$/, '');
const PING_INTERVAL_MS = 30_000;

let lanBaseUrl = null;
let cloudflaredProcess = null;

// ── Helpers ───────────────────────────────────────────────────────────────────

function getLanIp() {
  for (const iface of Object.values(os.networkInterfaces())) {
    for (const addr of iface) {
      if (addr.family === 'IPv4' && !addr.internal) return addr.address;
    }
  }
  return null;
}

function startCloudflared(port) {
  return new Promise((resolve, reject) => {
    const child = spawn('cloudflared', [
      'tunnel', '--url', `http://localhost:${port}`, '--no-autoupdate',
    ]);

    cloudflaredProcess = child;

    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error('timed out after 30s'));
    }, 30_000);

    // cloudflared prints the tunnel URL to stderr
    child.stderr.on('data', (data) => {
      const match = data.toString().match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);
      if (match) {
        clearTimeout(timeout);
        resolve(match[0]);
      }
    });

    child.on('error', () => {
      clearTimeout(timeout);
      reject(new Error('cloudflared not found — is it installed?'));
    });
  });
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

const FRONTEND_DIR = path.join(__dirname, '..');
app.get('/',     (_req, res) => res.sendFile(path.join(FRONTEND_DIR, 'index.html')));
app.get('/host', (_req, res) => res.sendFile(path.join(FRONTEND_DIR, 'host.html')));
app.use(express.static(FRONTEND_DIR));

app.get('/health', (_req, res) => res.send('OK'));

app.get('/status', (_req, res) => {
  res.json({ ...roomManager.getStatus(), vercelUrl: process.env.VERCEL_URL || null, lanUrl: lanBaseUrl });
});

app.get('/games', (_req, res) => {
  res.json(gameManager.getGames());
});

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
      if (ws.buzzSlot === 1 && !roomManager.getStatus().gameStarted) {
        send(ws, { type: 'games', games: gameManager.getGames() });
      }
    } else if (msg.type === 'start') {
      if (ws.buzzSlot === 1) {
        roomManager.startGame(wss);
        launchPcsx2(msg.gameId || null);
      }
    } else if (msg.type === 'pong') {
      ws.isAlive = true;
    }
  });

  ws.on('close', () => roomManager.handleDisconnect(ws, wss));
  ws.on('error', () => roomManager.handleDisconnect(ws, wss));
});

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

  try {
    const tunnelUrl = await startCloudflared(PORT);
    wsUrl = tunnelUrl.replace(/^https/, 'wss');
    roomManager.setNgrokUrl(tunnelUrl);
    joinUrl = `${VERCEL_URL}/?server=${encodeURIComponent(wsUrl)}&code=${roomCode}`;
    hostUrl = `${VERCEL_URL}/host?server=${encodeURIComponent(tunnelUrl)}`;
    console.log(`Cloudflare tunnel: ${tunnelUrl}`);
  } catch (err) {
    console.warn(`[cloudflared] ${err.message}`);
    const lanIp = getLanIp();
    if (lanIp) {
      lanBaseUrl = `http://${lanIp}:${PORT}`;
      wsUrl = `ws://${lanIp}:${PORT}`;
      joinUrl = `${lanBaseUrl}/?server=${encodeURIComponent(wsUrl)}&code=${roomCode}`;
      hostUrl = `${lanBaseUrl}/host`;
      console.warn(`[cloudflared] Falling back to LAN — players must be on the same network.`);
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
  if (cloudflaredProcess) cloudflaredProcess.kill();
  process.exit(0);
});
