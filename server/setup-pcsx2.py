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

# PCSX2 key format: BuzzDevice_Red1, BuzzDevice_Blue1, etc.


# ── Device detection via sysfs (mirrors SDL2's evdev enumeration) ─────────────

# On 64-bit Linux each capabilities word is an unsigned long (64 bits).
_WORD_BITS = 64

def _read_cap_int(path):
    """Read a sysfs capabilities file; return as Python int where bit N = code N."""
    try:
        with open(path) as f:
            words = f.read().split()
    except OSError:
        return 0
    result = 0
    for w in words:
        result = (result << _WORD_BITS) | int(w, 16)
    return result


def _is_sdl_joystick(event_num):
    """
    Return True if SDL2 would enumerate /dev/input/eventN as a joystick.
    SDL classifies a device as a joystick when it has:
      - EV_ABS with at least one axis, OR
      - EV_KEY with buttons in the joystick/gamepad/trigger-happy ranges.
    """
    base = f"/sys/class/input/event{event_num}/device/capabilities"
    ev = _read_cap_int(f"{base}/ev")

    EV_KEY = 1
    EV_ABS = 3

    if ev & (1 << EV_ABS):
        if _read_cap_int(f"{base}/abs"):
            return True

    if ev & (1 << EV_KEY):
        key = _read_cap_int(f"{base}/key")
        # BTN_MISC/JOYSTICK 0x100–0x11f, BTN_GAMEPAD 0x120–0x13f,
        # BTN_DIGI 0x140–0x14f, BTN_WHEEL 0x150–0x151,
        # BTN_TRIGGER_HAPPY 0x2c0–0x2e7
        for lo, hi in ((0x100, 0x152), (0x2c0, 0x2e8)):
            for bit in range(lo, hi):
                if key & (1 << bit):
                    return True

    return False


def find_buzz_sdl_index():
    """
    Find the 0-based SDL joystick index for DEVICE_NAME.
    SDL2 enumerates /dev/input/eventN devices (sorted by N) that pass its
    joystick classification test — the position of our device in that list
    is its SDL index.
    Returns (sdl_index, event_device_name) or (None, None).
    """
    input_dir = "/sys/class/input"
    try:
        entries = os.listdir(input_dir)
    except OSError:
        return None, None

    event_nums = sorted(
        int(e[5:]) for e in entries
        if e.startswith("event") and e[5:].isdigit()
    )

    sdl_idx = 0
    for num in event_nums:
        try:
            with open(f"{input_dir}/event{num}/device/name") as f:
                name = f.read().strip()
        except OSError:
            continue

        if not _is_sdl_joystick(num):
            continue

        if name == DEVICE_NAME:
            return sdl_idx, f"event{num}"

        sdl_idx += 1

    return None, None


# ── INI patching ──────────────────────────────────────────────────────────────

def build_usb_section(sdl_index):
    lines = [
        "[USB1]",
        "Type = BuzzDevice",
    ]
    for player in range(1, 5):
        for btn_index, label in enumerate(BUTTON_LABELS):
            button_num = (player - 1) * 5 + btn_index
            key = f"BuzzDevice_{label}{player}"
            lines.append(f"{key} = SDL-{sdl_index}/JoyButton{button_num}")
    return "\n".join(lines)


def patch_ini(ini_path, usb_section):
    with open(ini_path, "r") as f:
        content = f.read()

    # Remove existing USB1 section (and any USB1/subsections)
    content = re.sub(r"\[USB1[^\]]*\].*?(?=\n\[|\Z)", "", content, flags=re.DOTALL)
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
    sdl_index, event_dev = find_buzz_sdl_index()
    if sdl_index is None:
        print(f'✗ Virtual "{DEVICE_NAME}" not found in /sys/class/input.')
        print("  Make sure the server started cleanly and uinput permissions are set up.")
        sys.exit(1)
    print(f'✓ Found "{DEVICE_NAME}" ({event_dev})')
    print(f'  SDL joystick index: {sdl_index}  →  will use SDL-{sdl_index}/JoyButton0 … JoyButton19')

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
            key = f"BuzzDevice_{label}{player}"
            print(f"  {key.ljust(20)} = SDL-{sdl_index}/JoyButton{button_num}")
    print()
    print("Open PCSX2 → Settings → Controllers → USB to confirm.")


if __name__ == "__main__":
    main()
