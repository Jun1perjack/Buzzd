#!/bin/bash
# Buzzd launcher — starts the controller server and opens the lobby in a kiosk browser.
# Add as a Non-Steam game pointing to this file.
# Debug: tail -f /tmp/buzzd-launch.log

LOG=/tmp/buzzd-launch.log
exec > >(tee -a "$LOG") 2>&1
echo "=== Buzzd launch $(date) ==="

# Resolve the directory this script lives in — Steam may pass a relative or
# symlinked path, so try several methods and fall back to the deck default.
if [ -n "${BASH_SOURCE[0]}" ]; then
  BUZZD_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd 2>/dev/null)"
fi
[ -d "$BUZZD_DIR/server" ] || BUZZD_DIR="$(cd "$(dirname "$0")" && pwd 2>/dev/null)"
[ -d "$BUZZD_DIR/server" ] || BUZZD_DIR="/home/deck/Buzzd"
echo "BUZZD_DIR=$BUZZD_DIR"

PORT="${PORT:-3000}"

# Source nvm so npm/node are on PATH when launched from Steam
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

if ! command -v npm &>/dev/null; then
  echo "ERROR: npm not found — check NVM_DIR ($NVM_DIR)"
  exit 1
fi
echo "node=$(node -v) npm=$(npm -v)"

cleanup() {
  echo "Cleaning up (SERVER_PID=$SERVER_PID)..."
  [ -n "$SERVER_PID" ] && kill "$SERVER_PID" 2>/dev/null
  exit 0
}
trap cleanup EXIT INT TERM

# Kill any leftover server from a previous session
pkill -f "node.*server" 2>/dev/null
sleep 0.5

# Start the server
cd "$BUZZD_DIR/server" || { echo "ERROR: can't cd to $BUZZD_DIR/server"; exit 1; }
echo "Starting server..."
npm start >> "$LOG" 2>&1 &
SERVER_PID=$!
echo "Server PID: $SERVER_PID"

# Wait up to 30 s for the server to be healthy
echo "Waiting for server health..."
for i in $(seq 1 30); do
  if curl -sf "http://localhost:$PORT/health" > /dev/null; then
    echo "Server ready (${i}s)"
    break
  fi
  sleep 1
done

HOST_URL="http://localhost:$PORT/host"
echo "Opening: $HOST_URL"

# Detect and launch a browser in kiosk mode
launch_browser() {
  local kiosk_args="--kiosk --no-first-run --disable-features=TranslateUI --noerrdialogs"

  if flatpak list 2>/dev/null | grep -q "org.chromium.Chromium"; then
    echo "Using: Chromium (flatpak)"
    flatpak run org.chromium.Chromium $kiosk_args "$1"
  elif flatpak list 2>/dev/null | grep -q "com.google.Chrome"; then
    echo "Using: Chrome (flatpak)"
    flatpak run com.google.Chrome $kiosk_args "$1"
  elif command -v chromium-browser &>/dev/null; then
    echo "Using: chromium-browser"
    chromium-browser $kiosk_args "$1"
  elif command -v chromium &>/dev/null; then
    echo "Using: chromium"
    chromium $kiosk_args "$1"
  elif flatpak list 2>/dev/null | grep -q "org.mozilla.firefox"; then
    echo "Using: Firefox (flatpak)"
    flatpak run org.mozilla.firefox --kiosk "$1"
  elif command -v firefox &>/dev/null; then
    echo "Using: firefox"
    firefox --kiosk "$1"
  else
    echo "ERROR: No browser found. Install Chromium via Discover."
    return 1
  fi
}

launch_browser "$HOST_URL"
