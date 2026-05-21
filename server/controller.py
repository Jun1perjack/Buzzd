#!/usr/bin/env python3
"""
Buzz virtual controller using pure Python stdlib — no pip required.
Talks to /dev/uinput directly via os, fcntl, and struct.
Protocol (stdin): {"slot": 1-4, "buttonIndex": 0-4, "state": 0|1}
"""

import sys
import os
import fcntl
import struct
import time
import json

# ioctl request codes
UI_SET_EVBIT   = 0x40045564  # _IOW('U', 100, int)
UI_SET_KEYBIT  = 0x40045565  # _IOW('U', 101, int)
UI_DEV_CREATE  = 0x5501      # _IO('U', 1)
UI_DEV_DESTROY = 0x5502      # _IO('U', 2)

EV_SYN      = 0x00
EV_KEY      = 0x01
SYN_REPORT  = 0
BUS_USB     = 0x03

BTN_TRIGGER_HAPPY1 = 0x2c0

# struct uinput_user_dev layout (1116 bytes):
#   name[80], input_id{bustype,vendor,product,version}(4×H),
#   ff_effects_max(I), absmax[64](i), absmin[64](i), absfuzz[64](i), absflat[64](i)
UDEV_FMT = '80sHHHHI256i'

# struct input_event on 64-bit Linux (24 bytes):
#   tv_sec(q=8), tv_usec(q=8), type(H=2), code(H=2), value(i=4)
EVENT_FMT = '<qqHHi'


def create_device():
    fd = os.open('/dev/uinput', os.O_WRONLY | os.O_NONBLOCK)

    fcntl.ioctl(fd, UI_SET_EVBIT, EV_KEY)
    for code in range(BTN_TRIGGER_HAPPY1, BTN_TRIGGER_HAPPY1 + 20):
        fcntl.ioctl(fd, UI_SET_KEYBIT, code)

    dev = struct.pack(
        UDEV_FMT,
        b'Buzz Controller'.ljust(80, b'\x00'),
        BUS_USB, 0x1234, 0x5678, 1,  # generic VID/PID — avoids SDL GameController DB remapping
        0,                            # ff_effects_max
        *([0] * 256),                 # abs arrays (absmax, absmin, absfuzz, absflat)
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
            code = BTN_TRIGGER_HAPPY1 + (slot - 1) * 5 + button_index
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
