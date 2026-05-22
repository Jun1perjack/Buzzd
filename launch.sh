#!/bin/bash
BUZZD_DIR="$(cd "$(dirname "$0")" && pwd)"
PORT="${PORT:-3000}"

export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

cleanup() {
  [ -n "$SERVER_PID" ] && kill "$SERVER_PID" 2>/dev/null
  exit 0
}
trap cleanup EXIT INT TERM

pkill -f "node.*server" 2>/dev/null
sleep 0.5

cd "$BUZZD_DIR/server"
npm start > /tmp/buzzd.log 2>&1 &
SERVER_PID=$!

for i in $(seq 1 30); do
  curl -sf "http://localhost:$PORT/health" > /dev/null && break
  sleep 1
done

HOST_URL="http://localhost:$PORT/host"

KIOSK="--kiosk --no-first-run --disable-features=TranslateUI --noerrdialogs"
flatpak run org.chromium.Chromium $KIOSK "$HOST_URL" 2>/dev/null \
  || flatpak run com.google.Chrome  $KIOSK "$HOST_URL" 2>/dev/null \
  || chromium-browser               $KIOSK "$HOST_URL" 2>/dev/null \
  || chromium                       $KIOSK "$HOST_URL" 2>/dev/null \
  || flatpak run org.mozilla.firefox --kiosk "$HOST_URL" 2>/dev/null \
  || firefox                        --kiosk "$HOST_URL" 2>/dev/null
