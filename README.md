# Buzzd

A Jackbox-style Buzz! Quiz TV controller for PCSX2 on Steam Deck. Players join via their phones and their button presses are injected into PCSX2 as virtual controller inputs.

```
Phone browsers  ──WebSocket──▶  ngrok  ──▶  Steam Deck server  ──▶  uinput  ──▶  PCSX2
```

---

## How It Works

1. You run the Node.js server on your Steam Deck
2. The server auto-starts an ngrok tunnel and prints a QR code to the terminal
3. Players scan the QR code with their phones and tap "Join Game"
4. Button presses are sent over WebSocket and injected into PCSX2 as gamepad inputs
5. PCSX2's Buzz plugin reads those inputs like a real controller

---

## Prerequisites

- **Node.js** ≥ 18 on your Steam Deck
- A free **ngrok account** — sign up at [ngrok.com](https://ngrok.com) and copy your auth token
- PCSX2 installed on the Steam Deck (via Discover or Flatpak)
- The Buzz! Quiz TV ISO loaded in PCSX2
- A **Vercel** account for hosting the frontend (free tier is fine)

---

## 1 — Steam Deck Server Setup

### uinput permissions (do this once)

The virtual controller requires access to `/dev/uinput`. On SteamOS:

```bash
# Switch to Desktop Mode first

# Create a udev rule so your user can access uinput
echo 'KERNEL=="uinput", GROUP="input", MODE="0660"' | sudo tee /etc/udev/rules.d/99-uinput.rules

# Reload udev rules
sudo udevadm control --reload-rules && sudo udevadm trigger

# Add yourself to the input group
sudo usermod -aG input $USER

# Log out and back in (or reboot) for the group change to take effect
```

> **SteamOS note:** The base filesystem is immutable. If `npm install` fails with native build errors, run the server inside a **Distrobox** container (Arch-based) or enable Developer Mode in Steam Settings and install `base-devel` via `pacman`.

### Install and run

```bash
# Clone the repo
git clone https://github.com/jun1perjack/buzzd.git
cd buzzd/server

# Install dependencies
npm install

# Copy the example env file and fill in your ngrok auth token
cp .env.example .env
nano .env   # set NGROK_AUTHTOKEN and VERCEL_URL

# Start the server
npm start
```

You should see output like:

```
╔══════════════════════════════════════════════╗
║           BUZZD CONTROLLER                   ║
╠══════════════════════════════════════════════╣
║  Room code : ABCD12                          ║
╚══════════════════════════════════════════════╝

Scan this QR code to join:

[QR code here]

Join URL: https://buzzd.vercel.app/?server=wss%3A%2F%2Fabc.ngrok-free.app&code=ABCD12
Ngrok tunnel: https://abc.ngrok-free.app
```

Players scan the QR code and enter their name. Done.

---

## 2 — ngrok Setup

1. Create a free account at [ngrok.com](https://ngrok.com)
2. Copy your **auth token** from the ngrok dashboard
3. Paste it as `NGROK_AUTHTOKEN` in `server/.env`

The server starts ngrok automatically — no separate terminal needed.

> **Free tier:** Your ngrok URL changes every session. If you have a paid ngrok account with a static domain, put it in `.env` — it will be reused automatically.

---

## 3 — Deploy Frontend to Vercel

```bash
# Install Vercel CLI if you don't have it
npm install -g vercel

cd frontend/
vercel --prod
```

Follow the prompts. After deployment, copy the URL (e.g. `https://buzzd.vercel.app`) and set it as `VERCEL_URL` in `server/.env`.

Alternatively, push to GitHub and connect the repo in the Vercel dashboard. Set the **root directory** to `frontend/`.

### Host page

Visit `https://buzzd.vercel.app/host` to see a monitoring view of connected players. If you want to share a QR code from a screen instead of the terminal, paste your ngrok URL there.

---

## 4 — Configure PCSX2

The server creates a virtual gamepad named **"Buzz Controller"** with 20 buttons mapped to `BTN_TRIGGER_HAPPY1` through `BTN_TRIGGER_HAPPY20`.

### Button layout

| Code | Decimal | Assignment |
|------|---------|------------|
| BTN_TRIGGER_HAPPY1  | 704 | Player 1 — BUZZ |
| BTN_TRIGGER_HAPPY2  | 705 | Player 1 — Blue |
| BTN_TRIGGER_HAPPY3  | 706 | Player 1 — Orange |
| BTN_TRIGGER_HAPPY4  | 707 | Player 1 — Green |
| BTN_TRIGGER_HAPPY5  | 708 | Player 1 — Yellow |
| BTN_TRIGGER_HAPPY6  | 709 | Player 2 — BUZZ |
| ...  | ... | (same pattern × 4) |
| BTN_TRIGGER_HAPPY20 | 723 | Player 4 — Yellow |

### Steps in PCSX2

1. Start the Buzzd server **before** opening PCSX2 (so the virtual device is present)
2. In PCSX2: **Settings → Controllers**
3. Select the **USB** tab
4. Set USB port 1 to **Buzz Controller**
5. Click **Configure** and map each of the 20 inputs to the corresponding trigger-happy button on the "Buzz Controller" device

> PCSX2 should auto-detect the device. If it doesn't appear, run `evtest` in a terminal to confirm the virtual device is visible to the OS.

---

## 5 — Playing

1. Start `node server.js` on the Steam Deck
2. Wait for the QR code to appear in the terminal
3. Players scan the QR code (or visit the join URL) on their phones
4. Enter a name and tap **Join Game**
5. Start the game in PCSX2

The big red **BUZZ** button and four coloured answer buttons appear on each player's phone. The page is full-screen optimised for portrait mode.

---

## Troubleshooting

**`/dev/uinput: permission denied`**
Run the udev rule steps in section 1. Make sure you've logged out and back in after adding yourself to the `input` group.

**`uinput` native module fails to build**
Install build tools: on SteamOS use a Distrobox Arch container, or run `sudo pacman -S base-devel nodejs npm` in Dev Mode.

**Players can't connect / QR code leads to wrong URL**
Make sure `VERCEL_URL` in `.env` matches your deployed Vercel URL exactly (no trailing slash, correct `https://`).

**ngrok shows an interstitial browser page**
WebSocket connections (used by the player page) bypass the ngrok interstitial automatically. The host page's `/status` polling includes the `ngrok-skip-browser-warning` header.

**Buttons not registering in PCSX2**
Ensure PCSX2 is launched *after* the Buzzd server (so the uinput device exists at PCSX2 startup). Re-open the controller config in PCSX2 to re-scan devices.

**Server works but no QR code printed**
`qrcode-terminal` may not install correctly in some environments. The join URL is always printed as plain text as a fallback — copy it manually.
