'use strict';

const { spawn } = require('child_process');
const path = require('path');

const BASE_CODE = 0x2c0; // BTN_TRIGGER_HAPPY1 = 704

const BUTTON_INDEX = {
  buzz: 0,
  blue: 1,
  orange: 2,
  green: 3,
  yellow: 4,
};

let proc = null;
let ready = false;
let fallbackMode = false;

const READY_TIMEOUT_MS = 5000;

async function init() {
  return new Promise((resolve) => {
    const scriptPath = path.join(__dirname, 'controller.py');

    try {
      proc = spawn('python3', [scriptPath], {
        stdio: ['pipe', 'pipe', 'inherit'],
      });
    } catch (err) {
      console.warn(`[controller] Could not spawn Python process: ${err.message}`);
      fallbackMode = true;
      return resolve();
    }

    const timer = setTimeout(() => {
      if (!ready) {
        console.warn('[controller] Timed out — running in fallback (log-only) mode');
        fallbackMode = true;
        resolve();
      }
    }, READY_TIMEOUT_MS);

    proc.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      if (!ready) {
        if (text.includes('ready')) {
          ready = true;
          clearTimeout(timer);
          console.log('[controller] Virtual Buzz controller created via uinput');
          resolve();
        } else if (text.includes('error')) {
          clearTimeout(timer);
          ready = true; // prevent duplicate "exited early" warning
          console.warn(`[controller] controller.py: ${text.trim()}`);
          console.warn('[controller] Running in fallback (log-only) mode');
          fallbackMode = true;
          resolve();
        }
      }
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      if (!ready) {
        console.warn(`[controller] Python process error: ${err.message}`);
        console.warn('[controller] Is python3 installed? Running in fallback mode.');
        fallbackMode = true;
        resolve();
      }
    });

    proc.on('exit', (code) => {
      if (!ready) {
        clearTimeout(timer);
        console.warn(`[controller] controller.py exited early (code ${code}) — fallback mode`);
        fallbackMode = true;
        resolve();
      }
      proc = null;
    });
  });
}

function pressButton(playerSlot, buttonName, state) {
  const buttonIndex = BUTTON_INDEX[buttonName];
  if (buttonIndex === undefined) return;

  const code = BASE_CODE + (playerSlot - 1) * 5 + buttonIndex;
  const sdlButton = (playerSlot - 1) * 5 + buttonIndex;
  const label = state === 1 ? 'PRESS' : 'RELEASE';
  console.log(`[uinput] P${playerSlot} ${buttonName.toUpperCase().padEnd(6)} ${label.padEnd(7)} → SDL-?/Button${sdlButton}  (BTN_TRIGGER_HAPPY${sdlButton + 1}, code ${code})`);

  if (fallbackMode || !proc) {
    return;
  }

  const msg = JSON.stringify({ slot: playerSlot, buttonIndex, state });
  try {
    proc.stdin.write(msg + '\n');
  } catch {
    // stdin may be closed if the process exited unexpectedly
  }
}

function destroy() {
  if (proc) {
    try { proc.kill(); } catch {}
    proc = null;
  }
}

module.exports = { init, pressButton, destroy };
