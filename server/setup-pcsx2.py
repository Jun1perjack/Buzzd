#!/usr/bin/env python3
"""
Patches PCSX2.ini with the correct Buzz Controller button mappings.
Run this while the Buzzd server is running (so the virtual device exists).

Usage:
  cd ~/Buzzd/server
  npm start                 # in one terminal
  python3 setup-pcsx2.py   # in another terminal
"""

import os
import sys
import re
import shutil
import urllib.request
from datetime import datetime

DEVICE_NAME   = "Buzz Controller"
PCSX2_INI     = os.path.expanduser("~/.config/PCSX2/inis/PCSX2.ini")
SERVER_HEALTH = "http://localhost:3000/health"

BUTTON_LABELS = ["Red", "Blue", "Orange", "Green", "Yellow"]


# ── Device detection via /proc/bus/input/devices ─────────────────────────────

def find_buzz_sdl_index():
    """
    Parse /proc/bus/input/devices to find the SDL joystick index for the
    Buzz Controller. PCSX2 uses SDL, which numbers joysticks by their js
    device number (js0=SDL-0, js1=SDL-1, etc.).
    Returns (sdl_index, handlers_string) or (None, None).
    """
    try:
        with open("/proc/bus/input/devices") as f:
            content = f.read()
    except OSError:
        return None, None

    for block in content.strip().split("\n\n"):
        if f'Name="{DEVICE_NAME}"' not in block:
            continue
        for line in block.splitlines():
            if line.startswith("H: Handlers="):
                handlers = line.split("=", 1)[1]
                m = re.search(r"\bjs(\d+)\b", handlers)
                if m:
                    return int(m.group(1)), handlers.strip()
        # Device found but no js handler — uinput permissions may be missing
        return None, None

    return None, None


# ── INI patching ──────────────────────────────────────────────────────────────

def build_usb_section(sdl_index):
    lines = [
        "[USB1]",
        "Type = BuzzController",
        "",
        "[USB1/BuzzController]",
    ]
    for player in range(1, 5):
        for btn_index, label in enumerate(BUTTON_LABELS):
            button_num = (player - 1) * 5 + btn_index
            lines.append(
                f"Player{player}/{label} = SDL-{sdl_index}/Button{button_num}"
            )
    return "\n".join(lines)


def patch_ini(ini_path, usb_section):
    with open(ini_path, "r") as f:
        content = f.read()

    # Remove existing USB1 sections
    content = re.sub(r"\[USB1\].*?(?=\n\[|\Z)", "", content, flags=re.DOTALL)
    content = re.sub(r"\[USB1/BuzzController\].*?(?=\n\[|\Z)", "", content, flags=re.DOTALL)
    content = re.sub(r"\n{3,}", "\n\n", content).rstrip()
    content = content + "\n\n" + usb_section + "\n"

    with open(ini_path, "w") as f:
        f.write(content)


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    print("=== Buzzd PCSX2 Setup ===\n")

    # 1. Check server is running
    try:
        urllib.request.urlopen(SERVER_HEALTH, timeout=2)
        print("✓ Buzzd server is running")
    except Exception:
        print("✗ Buzzd server is not running.")
        print("  Start it first:  cd ~/Buzzd/server && npm start")
        sys.exit(1)

    # 2. Find SDL joystick index
    sdl_index, handlers = find_buzz_sdl_index()
    if sdl_index is None:
        print(f'✗ Virtual "{DEVICE_NAME}" device not found in /proc/bus/input/devices.')
        print("  Make sure the server started cleanly and uinput permissions are set up.")
        sys.exit(1)
    print(f'✓ Found "{DEVICE_NAME}" (handlers: {handlers})')
    print(f'  SDL joystick index: {sdl_index}  →  will use SDL-{sdl_index}/Button0 … Button19')

    # 3. Check PCSX2.ini exists
    if not os.path.isfile(PCSX2_INI):
        print(f"\n✗ PCSX2.ini not found at:\n  {PCSX2_INI}")
        print("  Open PCSX2 once to create its config, then re-run this script.")
        sys.exit(1)
    print(f"✓ Found PCSX2.ini")

    # 4. Back up and patch
    backup = PCSX2_INI + ".bak-" + datetime.now().strftime("%Y%m%d%H%M%S")
    shutil.copy2(PCSX2_INI, backup)
    print(f"✓ Backup saved → {os.path.basename(backup)}")

    usb_section = build_usb_section(sdl_index)
    patch_ini(PCSX2_INI, usb_section)

    print("\n✓ PCSX2.ini patched! Mappings written:\n")
    for player in range(1, 5):
        for btn_index, label in enumerate(BUTTON_LABELS):
            button_num = (player - 1) * 5 + btn_index
            print(f"  Player{player}/{label.ljust(6)} = SDL-{sdl_index}/Button{button_num}")
    print()
    print("Open PCSX2 → Settings → Controllers → USB to confirm.")


if __name__ == "__main__":
    main()
