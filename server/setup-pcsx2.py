#!/usr/bin/env python3
"""
Patches PCSX2.ini with the correct Buzz Controller button mappings.
Run this while the Buzzd server is running (so the virtual device exists).

Usage:
  cd ~/Buzzd/server
  npm start          # in one terminal
  python3 setup-pcsx2.py   # in another terminal
"""

import os
import sys
import glob
import re
import shutil
from datetime import datetime

DEVICE_NAME   = "Buzz Controller"
PCSX2_INI     = os.path.expanduser("~/.config/PCSX2/inis/PCSX2.ini")
SERVER_HEALTH = "http://localhost:3000/health"

# Button names as PCSX2 labels them for the BuzzController USB type
BUTTON_LABELS = ["Red", "Blue", "Orange", "Green", "Yellow"]


# ── Device detection ──────────────────────────────────────────────────────────

def sorted_event_devices():
    paths = glob.glob("/sys/class/input/event*")
    return sorted(paths, key=lambda p: int(re.search(r"event(\d+)", p).group(1)))


def device_name(dev_path):
    f = os.path.join(dev_path, "device", "name")
    try:
        return open(f).read().strip()
    except OSError:
        return None


def has_gamepad_keys(dev_path):
    """True if the device reports BTN_JOYSTICK/GAMEPAD or BTN_TRIGGER_HAPPY range keys."""
    cap_file = os.path.join(dev_path, "device", "capabilities", "key")
    try:
        raw = open(cap_file).read().strip()
        if not raw or all(c in "0 " for c in raw):
            return False
        bitmask = int(raw.replace(" ", ""), 16)
        # BTN_JOYSTICK 0x120, BTN_GAMEPAD 0x130, BTN_TRIGGER_HAPPY 0x2c0
        gamepad_ranges = list(range(0x120, 0x140)) + list(range(0x2c0, 0x2e0))
        return any(bitmask & (1 << b) for b in gamepad_ranges)
    except Exception:
        return False


def find_buzz_index():
    """
    Returns (pcsx2_index, event_name) for the Buzz Controller, or (None, None).
    PCSX2 assigns indices to evdev devices in event-number order, counting only
    devices that have gamepad-like key capabilities.
    """
    index = 0
    for path in sorted_event_devices():
        name = device_name(path)
        if name == DEVICE_NAME:
            return index, os.path.basename(path)
        if has_gamepad_keys(path):
            index += 1
    return None, None


# ── INI patching ──────────────────────────────────────────────────────────────

def build_usb_section(evdev_index):
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
                f"Player{player}/{label} = "
                f"evdev/{evdev_index}/{DEVICE_NAME}/Button{button_num}"
            )
    return "\n".join(lines)


def patch_ini(ini_path, usb_section):
    with open(ini_path, "r") as f:
        content = f.read()

    # Remove existing [USB1] and [USB1/BuzzController] sections
    content = re.sub(
        r"\[USB1\].*?(?=\n\[|\Z)",
        "",
        content,
        flags=re.DOTALL,
    )
    content = re.sub(
        r"\[USB1/BuzzController\].*?(?=\n\[|\Z)",
        "",
        content,
        flags=re.DOTALL,
    )
    # Clean up extra blank lines left behind
    content = re.sub(r"\n{3,}", "\n\n", content).rstrip()

    content = content + "\n\n" + usb_section + "\n"
    with open(ini_path, "w") as f:
        f.write(content)


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    print("=== Buzzd PCSX2 Setup ===\n")

    # 1. Check server is running
    try:
        import urllib.request
        urllib.request.urlopen(SERVER_HEALTH, timeout=2)
        print("✓ Buzzd server is running")
    except Exception:
        print("✗ Buzzd server is not running.")
        print("  Start it first:  cd ~/Buzzd/server && npm start")
        sys.exit(1)

    # 2. Find virtual device
    evdev_index, event_name = find_buzz_index()
    if evdev_index is None:
        print(f'✗ Virtual "{DEVICE_NAME}" device not found.')
        print("  Check that the server started successfully and uinput")
        print("  permissions are set up (see setup page step 4).")
        sys.exit(1)
    print(f'✓ Found "{DEVICE_NAME}" → {event_name}  (PCSX2 evdev index: {evdev_index})')

    # 3. Check PCSX2.ini exists
    if not os.path.isfile(PCSX2_INI):
        print(f"\n✗ PCSX2.ini not found at:\n  {PCSX2_INI}")
        print("  Open PCSX2 once first so it creates its config files, then re-run this script.")
        sys.exit(1)
    print(f"✓ Found PCSX2.ini at {PCSX2_INI}")

    # 4. Back up and patch
    backup = PCSX2_INI + ".bak-" + datetime.now().strftime("%Y%m%d%H%M%S")
    shutil.copy2(PCSX2_INI, backup)
    print(f"✓ Backup saved → {backup}")

    usb_section = build_usb_section(evdev_index)
    patch_ini(PCSX2_INI, usb_section)

    print("\n✓ PCSX2.ini patched! Applied mappings:\n")
    for player in range(1, 5):
        buttons = "  ".join(BUTTON_LABELS)
        print(f"  Player {player}: {buttons}")
    print()
    print("Open PCSX2 and check Settings → Controllers → USB.")
    print("If inputs aren't mapped, try re-running the script —")
    print("it may need to be run after PCSX2 has loaded the config once.")


if __name__ == "__main__":
    main()
