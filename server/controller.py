#!/usr/bin/env python3
"""
Buzz virtual controller process.
Reads JSON button commands from stdin, injects them via uinput.
Protocol: {"slot": 1-4, "buttonIndex": 0-4, "state": 0|1}
"""

import sys
import json

BTN_TRIGGER_HAPPY1 = 0x2c0
BUS_USB = 0x03


def main():
    try:
        from evdev import UInput, ecodes
    except ImportError:
        sys.stderr.write("[controller.py] evdev not installed. Run: pip3 install evdev\n")
        sys.stderr.flush()
        sys.stdout.write("error: evdev not found\n")
        sys.stdout.flush()
        # Stay alive so the Node process doesn't error — it will detect fallback mode
        for _ in sys.stdin:
            pass
        return

    button_codes = list(range(BTN_TRIGGER_HAPPY1, BTN_TRIGGER_HAPPY1 + 20))
    capabilities = {ecodes.EV_KEY: button_codes}

    try:
        ui = UInput(
            capabilities,
            name="Buzz Controller",
            vendor=0x054C,
            product=0x1000,
            bustype=BUS_USB,
            version=1,
        )
    except Exception as e:
        sys.stderr.write(f"[controller.py] Failed to create UInput device: {e}\n")
        sys.stderr.flush()
        sys.stdout.write("error: uinput failed\n")
        sys.stdout.flush()
        for _ in sys.stdin:
            pass
        return

    sys.stdout.write("ready\n")
    sys.stdout.flush()

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
            slot = int(msg["slot"])
            button_index = int(msg["buttonIndex"])
            state = int(msg["state"])
            code = BTN_TRIGGER_HAPPY1 + (slot - 1) * 5 + button_index
            ui.write(ecodes.EV_KEY, code, state)
            ui.syn()
        except Exception:
            pass


if __name__ == "__main__":
    main()
