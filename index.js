import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { isValid, parse } from '@tma.js/init-data-node';

const app = express();
app.use(express.json());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const AIRTABLE_API = 'https://api.airtable.com/v0';

function cfg() {
  return {
    // Telegram
    BOT_TOKEN: process.env.BOT_TOKEN,

    // Airtable
    AIRTABLE_TOKEN: process.env.AIRTABLE_TOKEN,
    AIRTABLE_BASE_ID: process.env.AIRTABLE_BASE_ID,
    AIRTABLE_PLAYERS_TABLE: process.env.AIRTABLE_PLAYERS_TABLE || 'Players',

    // Fields (match your Airtable screenshots)
    FIELD_NAME: 'Name',
    FIELD_TELEGRAM_ID: 'Telegram ID',
    FIELD_TELEGRAM_USERNAME: 'Telegram Username',
    FIELD_INDIVIDUAL_RATING: 'Individual Rating',
    FIELD_GAMES_PLAYED: 'Games Played',
    FIELD_WINS: 'Wins',
    FIELD_LOSSES: 'Losses',
    FIELD_LAST_UPDATED: 'Last Updated',

    DEFAULT_RATING: Number(process.env.DEFAULT_RATING || 1000),
    AIRTABLE_TIMEOUT_MS: Number(process.env.AIRTABLE_TIMEOUT_MS || 12000),
  };
}

// Simple request log (no secrets)
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

function requireEnvForAirtable(res) {
  const c = cfg();
  const missing = [];
  if (!c.AIRTABLE_TOKEN) missing.push('AIRTABLE_TOKEN');
  if (!c.AIRTABLE_BASE_ID) missing.push('AIRTABLE_BASE_ID');
  if (!c.AIRTABLE_PLAYERS_TABLE) missing.push('AIRTABLE_PLAYERS_TABLE');
  if (missing.length) {
    res
      .status(500)
      .json({ ok: false, error: `Missing env: ${missing.join(', ')}` });
    return false;
  }
  return true;
}

function airtableHeaders() {
  const c = cfg();
  // Airtable auth is Bearer token :contentReference[oaicite:2]{index=2}
  return {
    Authorization: `Bearer ${c.AIRTABLE_TOKEN}`,
    'Content-Type': 'application/json',
  };
}

function airtablePlayersUrl() {
  const c = cfg();
  // /v0/{baseId}/{tableNameOrId} :contentReference[oaicite:3]{index=3}
  return `${AIRTABLE_API}/${encodeURIComponent(
    c.AIRTABLE_BASE_ID
  )}/${encodeURIComponent(c.AIRTABLE_PLAYERS_TABLE)}`;
}

async function airtableRequest(method, url, body) {
  const c = cfg();
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), c.AIRTABLE_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method,
      headers: airtableHeaders(),
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    const text = await res.text();
    let json;
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      json = { raw: text };
    }

    if (!res.ok) {
      const err = new Error(
        json?.error?.message || json?.message || `Airtable error: ${res.status}`
      );
      err.status = 502;
      err.details = json;
      throw err;
    }
    return json;
  } catch (e) {
    if (e?.name === 'AbortError') {
      const err = new Error(
        `Airtable request timed out after ${c.AIRTABLE_TIMEOUT_MS}ms`
      );
      err.status = 504;
      throw err;
    }
    throw e;
  } finally {
    clearTimeout(t);
  }
}

function getInitDataFromReq(req) {
  return req.headers['x-telegram-init-data'] || req.body?.initData || '';
}

// Telegram requires server-side initData validation before trust :contentReference[oaicite:4]{index=4}
function validateTelegramInitDataOrThrow(initData) {
  const c = cfg();
  if (!c.BOT_TOKEN) {
    const err = new Error('BOT_TOKEN is not set');
    err.status = 500;
    throw err;
  }
  if (!initData) {
    const err = new Error('initData is required');
    err.status = 400;
    throw err;
  }
  if (!isValid(initData, c.BOT_TOKEN)) {
    const err = new Error('Invalid initData');
    err.status = 401;
    throw err;
  }
  return parse(initData);
}

function displayNameFromTg(user) {
  const full = [user?.first_name, user?.last_name]
    .filter(Boolean)
    .join(' ')
    .trim();
  if (full) return full;
  if (user?.username) return `@${user.username}`;
  return `User ${user?.id ?? ''}`.trim();
}

function normalizePlayer(rec) {
  const c = cfg();
  const f = rec.fields || {};
  return {
    id: rec.id,
    name: f[c.FIELD_NAME] || '',
    telegramId: f[c.FIELD_TELEGRAM_ID] ?? null,
    telegramUsername: f[c.FIELD_TELEGRAM_USERNAME] || '',
    rating:
      typeof f[c.FIELD_INDIVIDUAL_RATING] === 'number'
        ? f[c.FIELD_INDIVIDUAL_RATING]
        : Number(f[c.FIELD_INDIVIDUAL_RATING] || 0),
    gamesPlayed:
      typeof f[c.FIELD_GAMES_PLAYED] === 'number'
        ? f[c.FIELD_GAMES_PLAYED]
        : Number(f[c.FIELD_GAMES_PLAYED] || 0),
    wins:
      typeof f[c.FIELD_WINS] === 'number'
        ? f[c.FIELD_WINS]
        : Number(f[c.FIELD_WINS] || 0),
    losses:
      typeof f[c.FIELD_LOSSES] === 'number'
        ? f[c.FIELD_LOSSES]
        : Number(f[c.FIELD_LOSSES] || 0),
    lastUpdated: f[c.FIELD_LAST_UPDATED] || null,
  };
}

async function findPlayerByTelegramId(telegramIdNumber) {
  const c = cfg();
  const params = new URLSearchParams();
  params.set('maxRecords', '1');
  params.set(
    'filterByFormula',
    `{${c.FIELD_TELEGRAM_ID}} = ${telegramIdNumber}`
  ); // :contentReference[oaicite:5]{index=5}
  const url = `${airtablePlayersUrl()}?${params.toString()}`;
  const data = await airtableRequest('GET', url);
  return data?.records?.[0] || null;
}

async function createPlayer(fields) {
  // Airtable create records format: { records: [{ fields: {...}}] } :contentReference[oaicite:6]{index=6}
  const data = await airtableRequest('POST', airtablePlayersUrl(), {
    records: [{ fields }],
  });
  return data?.records?.[0] || null;
}

async function updatePlayer(recordId, fields) {
  const data = await airtableRequest('PATCH', airtablePlayersUrl(), {
    records: [{ id: recordId, fields }],
  });
  return data?.records?.[0] || null;
}

async function listPlayersByRating() {
  const c = cfg();
  const records = [];
  let offset = null;

  do {
    const params = new URLSearchParams();
    params.set('pageSize', '100');
    params.set('sort[0][field]', c.FIELD_INDIVIDUAL_RATING);
    params.set('sort[0][direction]', 'desc'); // :contentReference[oaicite:7]{index=7}
    if (offset) params.set('offset', offset);

    const url = `${airtablePlayersUrl()}?${params.toString()}`;
    const data = await airtableRequest('GET', url);
    if (Array.isArray(data?.records)) records.push(...data.records);
    offset = data?.offset || null;
  } while (offset);

  return records;
}

// ---------------- API ----------------

app.get('/api/health', (req, res) => res.json({ ok: true }));

// Debug: confirm Airtable auth/base/table are correct
app.post('/api/debug/airtable', async (req, res) => {
  try {
    if (!requireEnvForAirtable(res)) return;
    const initData = getInitDataFromReq(req);
    validateTelegramInitDataOrThrow(initData);

    const url = `${airtablePlayersUrl()}?pageSize=1`;
    const data = await airtableRequest('GET', url);

    res.json({
      ok: true,
      message: 'Airtable reachable',
      sampleCount: Array.isArray(data?.records) ? data.records.length : 0,
    });
  } catch (e) {
    console.error('debug airtable error:', e?.message, e?.details || '');
    res
      .status(e.status || 500)
      .json({ ok: false, error: e.message, details: e.details || null });
  }
});

app.post('/api/me', async (req, res) => {
  try {
    if (!requireEnvForAirtable(res)) return;

    const initData = getInitDataFromReq(req);
    const data = validateTelegramInitDataOrThrow(initData);

    const user = data.user;
    if (!user?.id)
      return res
        .status(400)
        .json({ ok: false, error: 'Telegram user is missing' });

    const telegramId = Number(user.id);
    const existing = await findPlayerByTelegramId(telegramId);

    res.json({
      ok: true,
      user,
      joined: Boolean(existing),
      player: existing ? normalizePlayer(existing) : null,
    });
  } catch (e) {
    console.error('me error:', e?.message, e?.details || '');
    res
      .status(e.status || 500)
      .json({ ok: false, error: e.message, details: e.details || null });
  }
});

app.post('/api/join', async (req, res) => {
  try {
    if (!requireEnvForAirtable(res)) return;

    const initData = getInitDataFromReq(req);
    const data = validateTelegramInitDataOrThrow(initData);

    const user = data.user;
    if (!user?.id)
      return res
        .status(400)
        .json({ ok: false, error: 'Telegram user is missing' });

    const c = cfg();
    const telegramId = Number(user.id);
    const name = displayNameFromTg(user);
    const username = user.username || '';

    console.log('join: telegramId =', telegramId);

    const existing = await findPlayerByTelegramId(telegramId);

    if (existing) {
      console.log('join: existing record =', existing.id);
      const saved = await updatePlayer(existing.id, {
        [c.FIELD_NAME]: name,
        [c.FIELD_TELEGRAM_USERNAME]: username,
        [c.FIELD_LAST_UPDATED]: new Date().toISOString(),
      });
      return res.json({
        ok: true,
        player: saved ? normalizePlayer(saved) : null,
        action: 'updated',
      });
    }

    console.log('join: creating new player');
    const created = await createPlayer({
      [c.FIELD_NAME]: name,
      [c.FIELD_TELEGRAM_ID]: telegramId,
      [c.FIELD_TELEGRAM_USERNAME]: username,
      [c.FIELD_INDIVIDUAL_RATING]: c.DEFAULT_RATING,
      [c.FIELD_GAMES_PLAYED]: 0,
      [c.FIELD_WINS]: 0,
      [c.FIELD_LOSSES]: 0,
      [c.FIELD_LAST_UPDATED]: new Date().toISOString(),
    });

    return res.json({
      ok: true,
      player: created ? normalizePlayer(created) : null,
      action: 'created',
    });
  } catch (e) {
    console.error('join error:', e?.message, e?.details || '');
    res
      .status(e.status || 500)
      .json({ ok: false, error: e.message, details: e.details || null });
  }
});

app.post('/api/players', async (req, res) => {
  try {
    if (!requireEnvForAirtable(res)) return;

    const initData = getInitDataFromReq(req);
    validateTelegramInitDataOrThrow(initData);

    const records = await listPlayersByRating();
    res.json({ ok: true, players: records.map(normalizePlayer) });
  } catch (e) {
    console.error('players error:', e?.message, e?.details || '');
    res
      .status(e.status || 500)
      .json({ ok: false, error: e.message, details: e.details || null });
  }
});

// ---------------- Frontend serving ----------------

const distPath = path.join(__dirname, 'web', 'dist');
app.use(express.static(distPath));

// Express v5 catch-all must be named
app.get('/*splat', (req, res) => {
  if (req.path.startsWith('/api'))
    return res.status(404).json({ ok: false, error: 'Not found' });
  return res.sendFile(path.join(distPath, 'index.html'));
});

const port = process.env.PORT || 8080;
app.listen(port, '0.0.0.0', () => console.log(`Server listening on ${port}`));
