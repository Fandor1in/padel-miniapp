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

    // Fields (match your screenshots by default)
    FIELD_NAME: process.env.AIRTABLE_FIELD_NAME || 'Name',
    FIELD_TELEGRAM_ID: process.env.AIRTABLE_FIELD_TELEGRAM_ID || 'Telegram ID',
    FIELD_TELEGRAM_USERNAME:
      process.env.AIRTABLE_FIELD_TELEGRAM_USERNAME || 'Telegram Username',
    FIELD_INDIVIDUAL_RATING:
      process.env.AIRTABLE_FIELD_INDIVIDUAL_RATING || 'Individual Rating',
    FIELD_GAMES_PLAYED:
      process.env.AIRTABLE_FIELD_GAMES_PLAYED || 'Games Played',
    FIELD_WINS: process.env.AIRTABLE_FIELD_WINS || 'Wins',
    FIELD_LOSSES: process.env.AIRTABLE_FIELD_LOSSES || 'Losses',
    FIELD_LAST_UPDATED:
      process.env.AIRTABLE_FIELD_LAST_UPDATED || 'Last Updated',

    DEFAULT_RATING: Number(process.env.DEFAULT_RATING || 1000),
  };
}

function requireEnvForAirtable(res) {
  const c = cfg();
  const missing = [];
  if (!c.AIRTABLE_TOKEN) missing.push('AIRTABLE_TOKEN');
  if (!c.AIRTABLE_BASE_ID) missing.push('AIRTABLE_BASE_ID');
  if (!c.AIRTABLE_PLAYERS_TABLE) missing.push('AIRTABLE_PLAYERS_TABLE');

  if (missing.length) {
    res.status(500).json({
      ok: false,
      error: `Airtable env is not configured. Missing: ${missing.join(', ')}`,
    });
    return false;
  }
  return true;
}

function airtableHeaders() {
  const c = cfg();
  return {
    Authorization: `Bearer ${c.AIRTABLE_TOKEN}`,
    'Content-Type': 'application/json',
  };
}

function airtablePlayersTableUrl() {
  const c = cfg();
  // /v0/{baseId}/{tableIdOrName} :contentReference[oaicite:5]{index=5}
  return `${AIRTABLE_API}/${encodeURIComponent(
    c.AIRTABLE_BASE_ID
  )}/${encodeURIComponent(c.AIRTABLE_PLAYERS_TABLE)}`;
}

async function airtableRequest(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: airtableHeaders(),
    body: body ? JSON.stringify(body) : undefined,
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
}

// Telegram initData validation (must be server-side) :contentReference[oaicite:6]{index=6}
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

  const ok = isValid(initData, c.BOT_TOKEN); // boolean :contentReference[oaicite:7]{index=7}
  if (!ok) {
    const err = new Error('Invalid initData');
    err.status = 401;
    throw err;
  }

  return parse(initData);
}

function getInitDataFromReq(req) {
  return req.headers['x-telegram-init-data'] || req.body?.initData || '';
}

function buildDisplayNameFromTelegramUser(user) {
  const full = [user?.first_name, user?.last_name]
    .filter(Boolean)
    .join(' ')
    .trim();
  if (full) return full;
  if (user?.username) return `@${user.username}`;
  return `User ${user?.id ?? ''}`.trim();
}

function normalizePlayerRecord(rec) {
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

async function findPlayerByTelegramIdNumeric(telegramIdNumber) {
  const c = cfg();
  const tableUrl = airtablePlayersTableUrl();

  // Telegram ID field is NUMBER in your schema
  const formula = `{${c.FIELD_TELEGRAM_ID}} = ${telegramIdNumber}`;

  const params = new URLSearchParams();
  params.set('maxRecords', '1');
  params.set('filterByFormula', formula); // :contentReference[oaicite:8]{index=8}

  const url = `${tableUrl}?${params.toString()}`;
  const data = await airtableRequest('GET', url);
  return data?.records?.[0] || null;
}

async function createPlayer(fields) {
  const tableUrl = airtablePlayersTableUrl();
  // Create records format :contentReference[oaicite:9]{index=9}
  const body = { records: [{ fields }] };
  const data = await airtableRequest('POST', tableUrl, body);
  return data?.records?.[0] || null;
}

async function updatePlayer(recordId, fields) {
  const tableUrl = airtablePlayersTableUrl();
  const body = { records: [{ id: recordId, fields }] };
  const data = await airtableRequest('PATCH', tableUrl, body);
  return data?.records?.[0] || null;
}

async function listPlayersSortedByRatingDesc() {
  const c = cfg();
  const tableUrl = airtablePlayersTableUrl();

  const records = [];
  let offset = null;

  // sort[0][field] / sort[0][direction] :contentReference[oaicite:10]{index=10}
  do {
    const params = new URLSearchParams();
    params.set('pageSize', '100');
    params.set('sort[0][field]', c.FIELD_INDIVIDUAL_RATING);
    params.set('sort[0][direction]', 'desc');
    if (offset) params.set('offset', offset);

    const url = `${tableUrl}?${params.toString()}`;
    const data = await airtableRequest('GET', url);

    if (Array.isArray(data?.records)) records.push(...data.records);
    offset = data?.offset || null;
  } while (offset);

  return records;
}

// ---------------- API ----------------

app.get('/api/health', (req, res) => res.json({ ok: true }));

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
    const existing = await findPlayerByTelegramIdNumeric(telegramId);

    res.json({
      ok: true,
      user,
      joined: Boolean(existing),
      player: existing ? normalizePlayerRecord(existing) : null,
    });
  } catch (e) {
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
    const name = buildDisplayNameFromTelegramUser(user);
    const username = user.username || '';

    const existing = await findPlayerByTelegramIdNumeric(telegramId);

    if (existing) {
      // Update identity fields, keep existing rating/wins/etc
      const fieldsToUpdate = {
        [c.FIELD_NAME]: name,
        [c.FIELD_TELEGRAM_USERNAME]: username,
        [c.FIELD_LAST_UPDATED]: new Date().toISOString(),
      };
      const saved = await updatePlayer(existing.id, fieldsToUpdate);
      return res.json({
        ok: true,
        player: saved ? normalizePlayerRecord(saved) : null,
      });
    }

    // Create new player
    const fieldsToCreate = {
      [c.FIELD_NAME]: name,
      [c.FIELD_TELEGRAM_ID]: telegramId,
      [c.FIELD_TELEGRAM_USERNAME]: username,
      [c.FIELD_INDIVIDUAL_RATING]: c.DEFAULT_RATING,
      [c.FIELD_GAMES_PLAYED]: 0,
      [c.FIELD_WINS]: 0,
      [c.FIELD_LOSSES]: 0,
      [c.FIELD_LAST_UPDATED]: new Date().toISOString(),
    };

    const created = await createPlayer(fieldsToCreate);
    return res.json({
      ok: true,
      player: created ? normalizePlayerRecord(created) : null,
    });
  } catch (e) {
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

    const records = await listPlayersSortedByRatingDesc();
    res.json({ ok: true, players: records.map(normalizePlayerRecord) });
  } catch (e) {
    res
      .status(e.status || 500)
      .json({ ok: false, error: e.message, details: e.details || null });
  }
});

// ---------------- Frontend serving ----------------

const distPath = path.join(__dirname, 'web', 'dist');
app.use(express.static(distPath));

// Express v5 wildcard must be named (no app.get("*")) :contentReference[oaicite:11]{index=11}
app.get('/*splat', (req, res) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ ok: false, error: 'Not found' });
  }
  return res.sendFile(path.join(distPath, 'index.html'));
});

const port = process.env.PORT || 8080;
app.listen(port, '0.0.0.0', () => console.log(`Server listening on ${port}`));
