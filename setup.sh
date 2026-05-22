#!/bin/bash
# Buzzd setup script — run once after cloning/pulling.

set -e
BUZZD_DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="$BUZZD_DIR/server/.env"

# ── Colours ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BOLD='\033[1m'; NC='\033[0m'
ok()   { echo -e "${GREEN}✔${NC} $*"; }
warn() { echo -e "${YELLOW}⚠${NC}  $*"; }
ask()  { echo -e "${BOLD}$*${NC}"; }

echo ""
echo -e "${BOLD}╔══════════════════════════════╗${NC}"
echo -e "${BOLD}║     BUZZD SETUP              ║${NC}"
echo -e "${BOLD}╚══════════════════════════════╝${NC}"
echo ""

# ── 1. npm install ────────────────────────────────────────────────────────────
echo -e "${BOLD}[1/5] Installing server dependencies...${NC}"
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

if ! command -v npm &>/dev/null; then
  warn "npm not found. Install Node.js (via nvm) then re-run this script."
  exit 1
fi

cd "$BUZZD_DIR/server" && npm install --silent && ok "Dependencies installed"
cd "$BUZZD_DIR"

# ── 2. Detect PCSX2 ───────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}[2/5] Detecting PCSX2...${NC}"

DETECTED_PCSX2=""

# Check .desktop file Exec line
DESKTOP="$HOME/.local/share/applications/PCSX2-QT.desktop"
if [ -f "$DESKTOP" ]; then
  EXEC_LINE=$(grep -m1 '^Exec=' "$DESKTOP" | sed 's/^Exec=//' | sed 's/ %[fFuU]//' | xargs)
  if [ -n "$EXEC_LINE" ]; then
    DETECTED_PCSX2="$EXEC_LINE --fullscreen --nogui"
    ok "Found via .desktop: $EXEC_LINE"
  fi
fi

# Fallback: common AppImage locations
if [ -z "$DETECTED_PCSX2" ]; then
  for P in \
    "$HOME/Applications/PCSX2-Qt.AppImage" \
    "$HOME/Applications/pcsx2.AppImage" \
    "$HOME/Emulation/tools/pcsx2/pcsx2-Qt.AppImage" \
    "$HOME/Desktop/PCSX2-Qt.AppImage"
  do
    if [ -f "$P" ]; then
      DETECTED_PCSX2="$P --fullscreen --nogui"
      ok "Found AppImage: $P"
      break
    fi
  done
fi

# Fallback: flatpak
if [ -z "$DETECTED_PCSX2" ] && flatpak list 2>/dev/null | grep -qi pcsx2; then
  DETECTED_PCSX2="flatpak run net.pcsx2.PCSX2 --fullscreen"
  ok "Found Flatpak: net.pcsx2.PCSX2"
fi

if [ -z "$DETECTED_PCSX2" ]; then
  warn "Could not auto-detect PCSX2."
  ask "Enter your PCSX2 command (base only, no ISO path) or leave blank to skip:"
  read -r USER_PCSX2
  DETECTED_PCSX2="$USER_PCSX2"
else
  ask "PCSX2 command detected (press Enter to accept, or type a replacement):"
  echo "  $DETECTED_PCSX2"
  read -r USER_PCSX2
  [ -n "$USER_PCSX2" ] && DETECTED_PCSX2="$USER_PCSX2"
fi

# ── 3. ROM directory ──────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}[3/5] ROM directory...${NC}"

# Read existing value if .env already exists
EXISTING_ROMS=$(grep -m1 '^ROMS_DIR=' "$ENV_FILE" 2>/dev/null | cut -d= -f2 | tr -d '[:space:]' || true)

# Auto-detect common EmuDeck/ES-DE paths
DETECTED_ROMS=""
for P in \
  "$HOME/Emulation/roms/ps2" \
  "$HOME/Emulation/roms/PS2" \
  "$HOME/Games/PS2" \
  "$HOME/roms/ps2"
do
  if [ -d "$P" ]; then
    DETECTED_ROMS="$P"
    ok "Found ROM folder: $P"
    break
  fi
done

SUGGESTED="${EXISTING_ROMS:-${DETECTED_ROMS:-$HOME/Emulation/roms/ps2}}"
ask "ROM folder path (press Enter to use: $SUGGESTED):"
read -r USER_ROMS
ROMS_DIR="${USER_ROMS:-$SUGGESTED}"
ok "Using: $ROMS_DIR"

# ── 4. SteamGridDB API key ────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}[4/5] SteamGridDB API key (for game cover art)...${NC}"
echo "  Free key at: steamgriddb.com → sign in → Preferences → API"

EXISTING_KEY=$(grep -m1 '^STEAMGRIDDB_API_KEY=' "$ENV_FILE" 2>/dev/null | cut -d= -f2 | tr -d '[:space:]' || true)
if [ -n "$EXISTING_KEY" ] && [ "$EXISTING_KEY" != "your_key_here" ]; then
  ask "Existing key found. Press Enter to keep it, or paste a new one:"
  read -r USER_KEY
  SGDB_KEY="${USER_KEY:-$EXISTING_KEY}"
else
  ask "Paste your SteamGridDB API key (or press Enter to skip):"
  read -r SGDB_KEY
fi

[ -n "$SGDB_KEY" ] && ok "API key set" || warn "Skipping — covers will show letter placeholders"

# ── 5. Write .env ─────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}[5/5] Writing server/.env...${NC}"

EXISTING_NGROK=$(grep -m1 '^NGROK_AUTHTOKEN=' "$ENV_FILE" 2>/dev/null | grep -v 'your_ngrok' | cut -d= -f2 | tr -d '[:space:]' || true)
EXISTING_VERCEL=$(grep -m1 '^VERCEL_URL=' "$ENV_FILE" 2>/dev/null | cut -d= -f2 | tr -d '[:space:]' || true)
EXISTING_CODE=$(grep -m1 '^ROOM_CODE=' "$ENV_FILE" 2>/dev/null | cut -d= -f2 | tr -d '[:space:]' || true)

NGROK_LINE="NGROK_AUTHTOKEN=${EXISTING_NGROK:-your_ngrok_authtoken_here}"
VERCEL_LINE="VERCEL_URL=${EXISTING_VERCEL:-https://buzzd.vercel.app}"
PCSX2_LINE="${DETECTED_PCSX2:+PCSX2_CMD=$DETECTED_PCSX2}"
ROMS_LINE="ROMS_DIR=$ROMS_DIR"
SGDB_LINE="${SGDB_KEY:+STEAMGRIDDB_API_KEY=$SGDB_KEY}"
CODE_LINE="${EXISTING_CODE:+ROOM_CODE=$EXISTING_CODE}"

cat > "$ENV_FILE" <<EOF
PORT=3000
$NGROK_LINE
$VERCEL_LINE
${CODE_LINE}

${ROMS_LINE}
ROMS_FILTER=buzz
${SGDB_LINE}

${PCSX2_LINE}
EOF

# Clean up blank lines from optional vars that were empty
sed -i '/^$/N;/^\n$/d' "$ENV_FILE"
ok "Wrote $ENV_FILE"

# ── Make scripts executable ───────────────────────────────────────────────────
chmod +x "$BUZZD_DIR/launch.sh"
ok "launch.sh is executable"

# ── Done ─────────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}${BOLD}All done!${NC}"
echo ""
echo "  Test the server:   cd ~/Buzzd/server && npm start"
echo "  Launch via script: ~/Buzzd/launch.sh"
echo ""
echo -e "${BOLD}To add to Steam:${NC}"
echo "  1. Steam → Add a Game → Add a Non-Steam Game"
echo "  2. Browse → select: $BUZZD_DIR/launch.sh"
echo "  3. Rename it to 'Buzzd' and add artwork if you like"
echo ""

# Offer to add to Steam automatically via steamos-add-to-steam
if command -v steamos-add-to-steam &>/dev/null; then
  ask "Add to Steam automatically now? [y/N]"
  read -r ADD_STEAM
  if [[ "$ADD_STEAM" =~ ^[Yy]$ ]]; then
    steamos-add-to-steam "$BUZZD_DIR/launch.sh" && ok "Added to Steam — restart Steam to see it"
  fi
fi
