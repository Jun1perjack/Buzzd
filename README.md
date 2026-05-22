<div align="center">

# BUZZD

### Turn your phones into Buzz! controllers

*Self-hosted multiplayer Buzz! PS2 on Steam Deck — no dongles, no apps, just scan and play*

[![Players](https://img.shields.io/badge/players-up%20to%204-red?style=flat-square)](https://github.com/jun1perjack/buzzd)
[![Platform](https://img.shields.io/badge/platform-Steam%20Deck-1a9fff?style=flat-square)](https://github.com/jun1perjack/buzzd)
[![Node](https://img.shields.io/badge/node-%3E%3D18-green?style=flat-square)](https://github.com/jun1perjack/buzzd)

</div>

---

## What is this?

BUZZD is a self-hosted server that turns any phone browser into a working Buzz! controller. Players scan a QR code, pick a name, and instantly get a big red **BUZZ** button and four coloured answer buttons — no app install, no dongles, no fussing with USB receivers.

The host (Player 1) browses the ROM library from their phone, picks a game, and hits Start. PCSX2 launches automatically. Everyone plays.

```
📱 phones  ──WebSocket──▶  ngrok tunnel  ──▶  Steam Deck  ──uinput──▶  PCSX2
```

---

## Features

- 📱 **Works on any phone** — browser-based, no app needed, no pairing
- 👥 **Up to 4 players** — each gets a BUZZ button + 4 colour answer buttons
- 🎮 **Game picker** — host browses your ROM library with SteamGridDB cover art
- 🚀 **Steam-native launcher** — shows up as a game, opens a fullscreen lobby with QR code
- 🌐 **Play over internet** — ngrok tunnel means players don't need to be on the same Wi-Fi
- 👑 **Host picks and starts** — Player 1 selects the game from their phone
- 🔌 **Virtual controller via uinput** — no special PCSX2 plugins or config required

---

## How it works

1. **Launch Buzzd from Steam** → server starts, fullscreen lobby appears with a QR code
2. **Players scan** the QR on their phones and enter a name
3. **Player 1 (host)** sees a game picker with cover art — taps a game to select it
4. **Tap Start** → PCSX2 launches with that ISO, all phones flip to the controller view
5. **Play!**

---

## Requirements

| | |
|---|---|
| **Steam Deck** | SteamOS 3.x (or any Linux desktop) |
| **PCSX2** | AppImage or Flatpak — install via Discover |
| **Buzz! PS2 ISO** | Any Buzz! game ripped to `.iso`, `.bin`, `.chd` etc. |
| **Node.js ≥ 18** | Install via [nvm](https://github.com/nvm-sh/nvm) |
| **Chromium** | Install via Discover |
| **ngrok account** | Free tier works perfectly |

---

## Setup

### 1. Clone and run the setup script

```bash
git clone https://github.com/jun1perjack/buzzd ~/Buzzd
cd ~/Buzzd
./setup.sh
```

`setup.sh` walks you through everything interactively:

- Runs `npm install`
- Auto-detects your PCSX2 path (`.desktop` file, common AppImage locations, Flatpak)
- Auto-detects your ROMs folder (checks EmuDeck default paths)
- Asks for your optional SteamGridDB API key (free — for game cover art)
- Writes `server/.env` with your settings
- Makes `launch.sh` executable

### 2. Add to Steam

1. Desktop Mode → Steam → **Add a Game** → **Add a Non-Steam Game**
2. Browse to `~/Buzzd/launch.sh` → **Add Selected Programs**
3. Rename the entry to **Buzzd**
4. Right-click → **Manage** → **Set custom artwork** — grab the images from `steam-art/`

### 3. Set up uinput (one-time)

The virtual controller needs write access to `/dev/uinput`:

```bash
echo 'KERNEL=="uinput", GROUP="input", MODE="0660"' | sudo tee /etc/udev/rules.d/99-uinput.rules
sudo udevadm control --reload-rules && sudo udevadm trigger
sudo usermod -aG input $USER
# Log out and back in (or reboot)
```

> You may need to redo this after a major SteamOS update.

### 4. Get a free ngrok token

Sign up at [ngrok.com](https://ngrok.com), copy your auth token, and add it to `server/.env`:

```env
NGROK_AUTHTOKEN=your_token_here
```

Without ngrok, players must be on the same Wi-Fi as the Deck.

### 5. SteamGridDB key (optional — for cover art)

[steamgriddb.com](https://www.steamgriddb.com) → sign in → Preferences → API → Generate key:

```env
STEAMGRIDDB_API_KEY=your_key_here
```

---

## Configuration (`server/.env`)

| Variable | Description | Example |
|---|---|---|
| `NGROK_AUTHTOKEN` | ngrok auth token | `abc123...` |
| `ROMS_DIR` | Path to your PS2 ROMs folder | `/home/deck/Emulation/roms/ps2` |
| `ROMS_FILTER` | Only show ROMs whose filename contains this | `buzz` |
| `PCSX2_CMD` | PCSX2 base command — ISO appended at runtime | `flatpak run net.pcsx2.PCSX2 --fullscreen` |
| `STEAMGRIDDB_API_KEY` | For game cover art in the picker | `abc123...` |
| `VERCEL_URL` | Frontend URL | `https://buzzd.vercel.app` |
| `ROOM_CODE` | Pin the room code across sessions | `BUZZ42` |

---

## Updating

```bash
cd ~/Buzzd
git pull origin main
./setup.sh
```

Always run `./setup.sh` after pulling — it reapplies permissions and handles new dependencies. Your `.env` values are preserved.

---

## Troubleshooting

**Buttons don't register in PCSX2**
The uinput device must exist before PCSX2 starts. Launching via `launch.sh` or from Steam handles this. If you start PCSX2 manually, start the Buzzd server first.

**`/dev/uinput: permission denied`**
Run the udev rule steps above. Make sure you've logged out and back in after `usermod`.

**Server won't start / blank screen from Steam**
Check `/tmp/buzzd.log` for errors. Make sure `node -v` works in a terminal.

**PCSX2 doesn't launch with the selected game**
Test your `PCSX2_CMD` in terminal — paste it with a quoted ISO path on the end. The value in `.env` should be the base command only, no ISO path.

**QR code won't connect**
Check that `NGROK_AUTHTOKEN` is set and the server output shows `Ngrok tunnel: https://...`. Without ngrok, the QR only works on the same network.

**Cover art not loading**
Cover fetching runs in the background after startup. Wait a few seconds and re-open the game picker. Without `STEAMGRIDDB_API_KEY`, letter placeholders are shown instead.

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│  Steam Deck                                         │
│                                                     │
│  launch.sh                                          │
│    ├── npm start (server/server.js)                 │
│    │     ├── roomManager  — player slots            │
│    │     ├── gameManager  — ROM scan + cover art    │
│    │     └── controller   — uinput virtual pad      │
│    │                                                │
│    └── Chromium → localhost:3000/host  (lobby)      │
│                                                     │
└──────────────────────┬──────────────────────────────┘
                       │ ngrok (wss://)
           ┌───────────┴────────────┐
    📱 Players 2–4           📱 Player 1 (host)
    Controller UI            Game picker → Start
```

---

<div align="center">

Built for the couch. Tested on *Buzz! The Music Quiz*.

*If something breaks, `/tmp/buzzd.log` is your friend.*

</div>
