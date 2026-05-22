'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');

const ROM_EXTENSIONS = new Set(['.iso', '.bin', '.img', '.cso', '.chd', '.mdf']);

let games = [];
let apiKey = null;

function cleanName(filename) {
  return path.basename(filename, path.extname(filename))
    .replace(/[\[\(][^\]\)]*[\]\)]/g, '')  // strip (PAL), [NTSC-U], etc.
    .replace(/[_\.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function makeId(filename) {
  return path.basename(filename, path.extname(filename))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function httpsGet(url, headers) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { reject(new Error('Invalid JSON')); }
      });
    });
    req.on('error', reject);
    req.setTimeout(8000, () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

async function fetchCover(gameName) {
  if (!apiKey) return null;
  try {
    const headers = { Authorization: `Bearer ${apiKey}` };
    const search = await httpsGet(
      `https://www.steamgriddb.com/api/v2/search/autocomplete/${encodeURIComponent(gameName)}`,
      headers
    );
    if (!search.success || !search.data.length) return null;

    const grids = await httpsGet(
      `https://www.steamgriddb.com/api/v2/grids/game/${search.data[0].id}?dimensions=600x900`,
      headers
    );
    if (!grids.success || !grids.data.length) return null;
    return grids.data[0].thumb || grids.data[0].url || null;
  } catch (err) {
    console.warn(`[games] Cover fetch failed for "${gameName}": ${err.message}`);
    return null;
  }
}

async function init(romsDir, key) {
  apiKey = key || null;
  games = [];

  if (!romsDir) {
    console.log('[games] ROMS_DIR not set — game picker will be empty');
    return;
  }

  let files;
  try {
    files = fs.readdirSync(romsDir);
  } catch (err) {
    console.warn(`[games] Cannot read ROMS_DIR "${romsDir}": ${err.message}`);
    return;
  }

  const romFiles = files
    .filter((f) => ROM_EXTENSIONS.has(path.extname(f).toLowerCase()))
    .sort();

  console.log(`[games] Found ${romFiles.length} ROM(s) in ${romsDir}`);

  games = romFiles.map((f) => ({
    id: makeId(f),
    name: cleanName(f),
    filepath: path.join(romsDir, f),
    coverUrl: null,
  }));

  if (!apiKey || !games.length) return;

  // Fetch covers in the background — don't block startup
  (async () => {
    for (const game of games) {
      game.coverUrl = await fetchCover(game.name);
      if (game.coverUrl) console.log(`[games] Cover found: "${game.name}"`);
    }
    console.log('[games] Cover fetch complete');
  })().catch((err) => console.warn(`[games] Cover error: ${err.message}`));
}

function getGames() {
  return games.map(({ id, name, coverUrl }) => ({ id, name, coverUrl }));
}

function getGame(id) {
  return games.find((g) => g.id === id) || null;
}

module.exports = { init, getGames, getGame };
