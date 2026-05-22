#!/usr/bin/env python3
"""
Buzz virtual keyboard via uinput — no pip required.
Each button press is sent as a standard keyboard keystroke so PCSX2 can
bind it directly in Settings → Controllers → USB → Buzz Controller.

Key layout:
  Player 1: 1=Red  2=Blue  3=Orange  4=Green  5=Yellow
  Player 2: 6=Red  7=Blue  8=Orange  9=Green  0=Yellow
  Player 3: Q=Red  W=Blue  E=Orange  R=Green  T=Yellow
  Player 4: A=Red  S=Blue  D=Orange  F=Green  G=Yellow

Protocol (stdin): {"slot": 1-4, "buttonIndex": 0-4, "state": 0|1}
"""

import sys
import os
import fcntl
import struct
import time
import json

UI_SET_EVBIT   = 0x40045564
UI_SET_KEYBIT  = 0x40045565
UI_DEV_CREATE  = 0x5501
UI_DEV_DESTROY = 0x5502

EV_SYN     = 0x00
EV_KEY     = 0x01
SYN_REPORT = 0
BUS_USB    = 0x03

UDEV_FMT  = '80sHHHHI256i'
EVENT_FMT = '<qqHHi'

# 20 keyboard key codes — 4 players × 5 buttons (Linux scancode values)
#   P1: 1 2 3 4 5     P2: 6 7 8 9 0
#   P3: Q W E R T     P4: A S D F G
BUTTON_KEYS = [
    2, 3, 4, 5, 6,       # Player 1
    7, 8, 9, 10, 11,     # Player 2
    16, 17, 18, 19, 20,  # Player 3  (Q W E R T)
    30, 31, 32, 33, 34,  # Player 4  (A S D F G)
]


def create_device():
    fd = os.open('/dev/uinput', os.O_WRONLY | os.O_NONBLOCK)

    fcntl.ioctl(fd, UI_SET_EVBIT, EV_KEY)
    for code in BUTTON_KEYS:
        fcntl.ioctl(fd, UI_SET_KEYBIT, code)

    dev = struct.pack(
        UDEV_FMT,
        b'Buzz Controller'.ljust(80, b'\x00'),
        BUS_USB, 0x1234, 0x5678, 1,
        0,
        *([0] * 256),
    )
    os.write(fd, dev)
    fcntl.ioctl(fd, UI_DEV_CREATE, 0)
    time.sleep(0.1)
    return fd


def send_event(fd, ev_type, code, value):
    t = time.time()
    sec = int(t)
    usec = int((t - sec) * 1_000_000)
    os.write(fd, struct.pack(EVENT_FMT, sec, usec, ev_type, code, value))


def main():
    try:
        fd = create_device()
    except PermissionError:
        sys.stderr.write('[controller.py] Permission denied on /dev/uinput.\n')
        sys.stderr.write('[controller.py] Follow the udev rule setup in the README.\n')
        sys.stderr.flush()
        sys.stdout.write('error: permission denied\n')
        sys.stdout.flush()
        for _ in sys.stdin:
            pass
        return
    except Exception as e:
        sys.stderr.write(f'[controller.py] Failed to create device: {e}\n')
        sys.stderr.flush()
        sys.stdout.write(f'error: {e}\n')
        sys.stdout.flush()
        for _ in sys.stdin:
            pass
        return

    sys.stdout.write('ready\n')
    sys.stdout.flush()

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
            slot         = int(msg['slot'])
            button_index = int(msg['buttonIndex'])
            state        = int(msg['state'])
            code = BUTTON_KEYS[(slot - 1) * 5 + button_index]
            send_event(fd, EV_KEY, code, state)
            send_event(fd, EV_SYN, SYN_REPORT, 0)
        except Exception:
            pass

    try:
        fcntl.ioctl(fd, UI_DEV_DESTROY, 0)
        os.close(fd)
    except Exception:
        pass


if __name__ == '__main__':
    main()
