#!/bin/bash
# Buzzd launcher — starts the controller server and opens the lobby in a kiosk browser.
# Add as a Non-Steam game pointing to this file.

BUZZD_DIR="$(cd "$(dirname "$0")" && pwd)"
PORT="${PORT:-3000}"

# Source nvm so npm/node are on PATH when launched from Steam
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

cleanup() {
  [ -n "$SERVER_PID" ] && kill "$SERVER_PID" 2>/dev/null
  exit 0
}
trap cleanup EXIT INT TERM

# Kill any leftover server from a previous session
pkill -f "node.*server" 2>/dev/null
sleep 0.5

# Start the server and log to file (tail /tmp/buzzd.log to debug)
cd "$BUZZD_DIR/server"
npm start > /tmp/buzzd.log 2>&1 &
SERVER_PID=$!

# Wait up to 30 s for the server to be healthy
for i in $(seq 1 30); do
  curl -sf "http://localhost:$PORT/health" > /dev/null && break
  sleep 1
done

# Build the host URL — browser is on the same machine so localhost works
VERCEL_URL=$(grep -m1 '^VERCEL_URL=' "$BUZZD_DIR/server/.env" | cut -d= -f2 | tr -d '[:space:]')
SERVER_PARAM=$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1], safe=''))" "http://localhost:$PORT")
HOST_URL="${VERCEL_URL}/host?server=${SERVER_PARAM}"

# Launch Chromium in kiosk mode — tries common install locations in order
KIOSK="--kiosk --no-first-run --disable-features=TranslateUI --noerrdialogs"
flatpak run org.chromium.Chromium $KIOSK "$HOST_URL" 2>/dev/null \
  || flatpak run com.google.Chrome  $KIOSK "$HOST_URL" 2>/dev/null \
  || chromium-browser               $KIOSK "$HOST_URL" 2>/dev/null \
  || chromium                       $KIOSK "$HOST_URL" 2>/dev/null \
  || flatpak run org.mozilla.firefox -kiosk "$HOST_URL" 2>/dev/null \
  || echo "[buzzd] No browser found — install Chromium via Discover"

# Browser exited — cleanup handled by trap above
