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
    BOT_TOKEN: process.env.BOT_TOKEN,

    AIRTABLE_TOKEN: process.env.AIRTABLE_TOKEN,
    AIRTABLE_BASE_ID: process.env.AIRTABLE_BASE_ID,

    T_PLAYERS: process.env.AIRTABLE_PLAYERS_TABLE || 'Players',
    T_PAIRS: process.env.AIRTABLE_PAIRS_TABLE || 'Pairs',
    T_MATCHES: process.env.AIRTABLE_MATCHES_TABLE || 'Matches',
    T_SETSCORES: process.env.AIRTABLE_SETSCORES_TABLE || 'SetScores',

    // Players
    P_NAME: 'Name',
    P_TG_ID: 'Telegram ID',
    P_TG_USERNAME: 'Telegram Username',
    P_INDIV_RATING: 'Individual Rating',
    P_GP: 'Games Played',
    P_W: 'Wins',
    P_L: 'Losses',

    // Pairs
    PR_PLAYER1: 'Player 1',
    PR_PLAYER2: 'Player 2',
    PR_RATING: 'Pair Rating',
    PR_GP: 'Games Played',
    PR_W: 'Wins',
    PR_L: 'Losses',

    // Matches
    M_DATE: 'Date',
    M_TIME: 'Time',
    M_STATUS: 'Status',
    M_PAIR1: 'Pair 1',
    M_PAIR2: 'Pair 2',
    M_INITIATED_BY: 'Initiated By',
    M_CONFIRMED_BY: 'Confirmed By',
    M_SCORE: 'Score',
    M_DISPUTE_REASON: 'Dispute Reason',

    // SetScores
    S_MATCH: 'Match',
    S_SET_NO: 'Set N°',
    S_P1: 'Pair 1 Score',
    S_P2: 'Pair 2 Score',
    S_WINNER_PAIR: 'Winner Pair',

    STATUS_PENDING: 'PENDING_CONFIRMATION',
    STATUS_CONFIRMED: 'CONFIRMED',
    STATUS_DISPUTED: 'DISPUTED',
    STATUS_REJECTED: 'REJECTED',

    DEFAULT_RATING: Number(process.env.DEFAULT_RATING || 1000),
    ELO_K_PAIR: Number(process.env.ELO_K_PAIR || 32),
    ELO_K_PLAYER: Number(process.env.ELO_K_PLAYER || 32),

    AIRTABLE_TIMEOUT_MS: Number(process.env.AIRTABLE_TIMEOUT_MS || 12000),
  };
}

app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

function requireEnv(res) {
  const c = cfg();
  const missing = [];
  if (!c.BOT_TOKEN) missing.push('BOT_TOKEN');
  if (!c.AIRTABLE_TOKEN) missing.push('AIRTABLE_TOKEN');
  if (!c.AIRTABLE_BASE_ID) missing.push('AIRTABLE_BASE_ID');
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
  return {
    Authorization: `Bearer ${c.AIRTABLE_TOKEN}`,
    'Content-Type': 'application/json',
  };
}

function tableUrl(tableNameOrId) {
  const c = cfg();
  return `${AIRTABLE_API}/${encodeURIComponent(
    c.AIRTABLE_BASE_ID
  )}/${encodeURIComponent(tableNameOrId)}`;
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

/**
 * ---- Airtable schema cache (Metadata API) ----
 * Uses field IDs for writes to avoid name mismatch.
 */
let schemaCachePromise = null;

function norm(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[º°]/g, '°')
    .replace(/№/g, 'n')
    .replace(/[^\p{L}\p{N} °]/gu, '');
}

function fieldAliasesFor(tableKey, fieldName) {
  const c = cfg();
  if (tableKey === c.T_SETSCORES && fieldName === c.S_SET_NO) {
    return [
      'Set Nº',
      'Set No',
      'Set №',
      'Set N',
      'Set',
      'Set #',
      'Set Num',
      'Set Number',
    ];
  }
  return [];
}

async function getBaseSchema() {
  const c = cfg();
  if (!schemaCachePromise) {
    schemaCachePromise = (async () => {
      const url = `https://api.airtable.com/v0/meta/bases/${encodeURIComponent(
        c.AIRTABLE_BASE_ID
      )}/tables`;
      const data = await airtableRequest('GET', url);

      const tables = Array.isArray(data?.tables) ? data.tables : [];
      const byName = {};
      const byId = {};

      for (const t of tables) {
        const tableId = t.id;
        const tableName = t.name;
        const fields = Array.isArray(t.fields) ? t.fields : [];

        const fieldsByName = {};
        const fieldsById = {};
        const fieldsByNormName = {};

        for (const f of fields) {
          fieldsByName[f.name] = f;
          fieldsById[f.id] = f;
          fieldsByNormName[norm(f.name)] = f;
        }

        const tableObj = {
          id: tableId,
          name: tableName,
          fieldsByName,
          fieldsById,
          fieldsByNormName,
        };
        byName[tableName] = tableObj;
        byId[tableId] = tableObj;
      }

      return { byName, byId };
    })().catch(e => {
      console.error(
        'Schema load failed (check schema.bases:read scope):',
        e?.message || e
      );
      return null;
    });
  }
  return schemaCachePromise;
}

async function resolveFieldKey(tableKey, fieldName) {
  const schema = await getBaseSchema();
  if (!schema) return fieldName;

  const table = schema.byName[tableKey] || schema.byId[tableKey];
  if (!table) return fieldName;

  if (table.fieldsByName[fieldName]) return table.fieldsByName[fieldName].id;

  for (const a of fieldAliasesFor(tableKey, fieldName)) {
    if (table.fieldsByName[a]) return table.fieldsByName[a].id;
  }

  const n = norm(fieldName);
  if (table.fieldsByNormName[n]) return table.fieldsByNormName[n].id;

  for (const a of fieldAliasesFor(tableKey, fieldName)) {
    const na = norm(a);
    if (table.fieldsByNormName[na]) return table.fieldsByNormName[na].id;
  }

  return fieldName;
}

async function mapFields(tableKey, fieldsObj) {
  const out = {};
  for (const [k, v] of Object.entries(fieldsObj || {})) {
    const key = await resolveFieldKey(tableKey, k);
    out[key] = v;
  }
  return out;
}

async function listAll(tableName, paramsObj = {}) {
  const records = [];
  let offset = null;

  do {
    const params = new URLSearchParams();
    params.set('pageSize', String(paramsObj.pageSize || 100));
    if (paramsObj.maxRecords)
      params.set('maxRecords', String(paramsObj.maxRecords));
    if (paramsObj.filterByFormula)
      params.set('filterByFormula', paramsObj.filterByFormula);

    if (Array.isArray(paramsObj.sort)) {
      paramsObj.sort.forEach((s, i) => {
        params.set(`sort[${i}][field]`, s.field);
        params.set(`sort[${i}][direction]`, s.direction || 'asc');
      });
    }
    if (offset) params.set('offset', offset);

    const url = `${tableUrl(tableName)}?${params.toString()}`;
    const data = await airtableRequest('GET', url);

    if (Array.isArray(data?.records)) records.push(...data.records);
    offset = data?.offset || null;
  } while (offset);

  return records;
}

async function getRecord(tableName, recordId) {
  return airtableRequest('GET', `${tableUrl(tableName)}/${recordId}`);
}

async function createRecords(tableName, records) {
  const mapped = [];
  for (const r of records) {
    mapped.push({ ...r, fields: await mapFields(tableName, r.fields) });
  }
  return airtableRequest('POST', tableUrl(tableName), {
    records: mapped,
    typecast: true,
  });
}

async function updateRecords(tableName, records) {
  const mapped = [];
  for (const r of records) {
    mapped.push({ ...r, fields: await mapFields(tableName, r.fields) });
  }
  return airtableRequest('PATCH', tableUrl(tableName), {
    records: mapped,
    typecast: true,
  });
}

function getInitDataFromReq(req) {
  return req.headers['x-telegram-init-data'] || req.body?.initData || '';
}

function validateTelegramInitDataOrThrow(initData) {
  const c = cfg();
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

function toNum(v, fallback = 0) {
  if (typeof v === 'number') return v;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function normalizePlayer(rec) {
  const c = cfg();
  const f = rec.fields || {};
  return {
    id: rec.id,
    name: f[c.P_NAME] || '',
    telegramId: f[c.P_TG_ID] ?? null,
    telegramUsername: f[c.P_TG_USERNAME] || '',
    rating: toNum(f[c.P_INDIV_RATING], c.DEFAULT_RATING),
    gamesPlayed: toNum(f[c.P_GP], 0),
    wins: toNum(f[c.P_W], 0),
    losses: toNum(f[c.P_L], 0),
  };
}

function normalizePair(rec) {
  const c = cfg();
  const f = rec.fields || {};
  return {
    id: rec.id,
    player1: Array.isArray(f[c.PR_PLAYER1]) ? f[c.PR_PLAYER1][0] : null,
    player2: Array.isArray(f[c.PR_PLAYER2]) ? f[c.PR_PLAYER2][0] : null,
    rating: toNum(f[c.PR_RATING], c.DEFAULT_RATING),
    gamesPlayed: toNum(f[c.PR_GP], 0),
    wins: toNum(f[c.PR_W], 0),
    losses: toNum(f[c.PR_L], 0),
  };
}

function normalizeMatch(rec) {
  const c = cfg();
  const f = rec.fields || {};
  return {
    id: rec.id,
    date: f[c.M_DATE] || null,
    time: f[c.M_TIME] || '',
    status: f[c.M_STATUS] || '',
    pair1: Array.isArray(f[c.M_PAIR1]) ? f[c.M_PAIR1][0] : null,
    pair2: Array.isArray(f[c.M_PAIR2]) ? f[c.M_PAIR2][0] : null,
    initiatedBy: Array.isArray(f[c.M_INITIATED_BY])
      ? f[c.M_INITIATED_BY][0]
      : null,
    confirmedBy: Array.isArray(f[c.M_CONFIRMED_BY]) ? f[c.M_CONFIRMED_BY] : [],
    score: f[c.M_SCORE] || '',
    disputeReason: f[c.M_DISPUTE_REASON] || '',
  };
}

function normalizeSetScore(rec) {
  const c = cfg();
  const f = rec.fields || {};
  return {
    id: rec.id,
    match: Array.isArray(f[c.S_MATCH]) ? f[c.S_MATCH][0] : null,
    setNo: toNum(f[c.S_SET_NO], 0),
    p1: toNum(f[c.S_P1], 0),
    p2: toNum(f[c.S_P2], 0),
    winnerPair: Array.isArray(f[c.S_WINNER_PAIR])
      ? f[c.S_WINNER_PAIR][0]
      : null,
  };
}

function eloDelta(rA, rB, scoreA, k) {
  const expectedA = 1 / (1 + Math.pow(10, (rB - rA) / 400));
  return k * (scoreA - expectedA);
}

function validateSetGames(a, b, setIndex1Based) {
  const p1 = Number(a);
  const p2 = Number(b);
  if (!Number.isFinite(p1) || !Number.isFinite(p2) || p1 < 0 || p2 < 0) {
    throw new Error(`Invalid set score at set ${setIndex1Based}`);
  }
  if (p1 === p2) throw new Error(`Set ${setIndex1Based} cannot be a draw`);

  const w = Math.max(p1, p2);
  const l = Math.min(p1, p2);

  const ok = (w === 6 && l <= 4) || (w === 7 && (l === 5 || l === 6));
  if (!ok) {
    throw new Error(
      `Invalid padel set score ${p1}-${p2} at set ${setIndex1Based}. Allowed: 6-0..6-4, 7-5, 7-6.`
    );
  }
  return { p1, p2 };
}

async function getOrCreatePlayerByTelegram(initData) {
  const c = cfg();
  const data = validateTelegramInitDataOrThrow(initData);
  const user = data.user;
  if (!user?.id) {
    const err = new Error('Telegram user is missing');
    err.status = 400;
    throw err;
  }

  const tgId = Number(user.id);

  const found = await listAll(c.T_PLAYERS, {
    maxRecords: 1,
    filterByFormula: `{${c.P_TG_ID}} = ${tgId}`,
  });

  return { data, user, existing: found[0] || null };
}

async function findOrCreatePair(playerAId, playerBId, playersById) {
  const c = cfg();
  if (!playerAId || !playerBId)
    throw new Error('Both players are required for a pair');
  if (playerAId === playerBId)
    throw new Error('Pair cannot have the same player twice');

  const pairs = await listAll(c.T_PAIRS, { maxRecords: 1000 });
  for (const rec of pairs) {
    const p = normalizePair(rec);
    const a = p.player1;
    const b = p.player2;
    if (!a || !b) continue;
    if (
      (a === playerAId && b === playerBId) ||
      (a === playerBId && b === playerAId)
    ) {
      return { pairRec: rec, created: false };
    }
  }

  const rA = playersById[playerAId]?.rating ?? c.DEFAULT_RATING;
  const rB = playersById[playerBId]?.rating ?? c.DEFAULT_RATING;
  const initialPairRating = Math.round((rA + rB) / 2);

  const created = await createRecords(c.T_PAIRS, [
    {
      fields: {
        [c.PR_PLAYER1]: [playerAId],
        [c.PR_PLAYER2]: [playerBId],
        [c.PR_RATING]: initialPairRating,
        [c.PR_GP]: 0,
        [c.PR_W]: 0,
        [c.PR_L]: 0,
      },
    },
  ]);

  return { pairRec: created?.records?.[0], created: true };
}

function uniq(arr) {
  return [...new Set((arr || []).filter(Boolean))];
}

function setIntersection(a, b) {
  const s = new Set(a);
  return b.some(x => s.has(x));
}

async function applyRatingsForMatch(matchRec, setScoresForMatch) {
  const c = cfg();
  const m = normalizeMatch(matchRec);

  if (!m.pair1 || !m.pair2) throw new Error('Match missing Pair 1/Pair 2');
  if (!Array.isArray(setScoresForMatch) || setScoresForMatch.length < 2)
    throw new Error('Match missing SetScores');

  const pairsById = {};
  const playersById = {};

  const players = await listAll(c.T_PLAYERS, { maxRecords: 1000 });
  players.forEach(r => (playersById[r.id] = normalizePlayer(r)));

  const pairs = await listAll(c.T_PAIRS, { maxRecords: 1000 });
  pairs.forEach(r => (pairsById[r.id] = normalizePair(r)));

  const p1 = pairsById[m.pair1];
  const p2 = pairsById[m.pair2];
  if (!p1 || !p2) throw new Error('Pair records not found for match');

  const p1Players = [p1.player1, p1.player2].filter(Boolean);
  const p2Players = [p2.player1, p2.player2].filter(Boolean);
  if (p1Players.length !== 2 || p2Players.length !== 2)
    throw new Error('Pair must have exactly 2 players');

  const ss = setScoresForMatch
    .map(normalizeSetScore)
    .sort((a, b) => a.setNo - b.setNo);

  const setWins = ss.reduce(
    (acc, s) => {
      if (s.p1 > s.p2) acc.p1++;
      else acc.p2++;
      return acc;
    },
    { p1: 0, p2: 0 }
  );

  const pair1Won = setWins.p1 > setWins.p2;
  const scoreA = pair1Won ? 1 : 0;

  const deltaPair = eloDelta(p1.rating, p2.rating, scoreA, c.ELO_K_PAIR);
  const newP1Rating = Math.round(p1.rating + deltaPair);
  const newP2Rating = Math.round(p2.rating - deltaPair);

  const p1Avg = Math.round(
    (playersById[p1Players[0]].rating + playersById[p1Players[1]].rating) / 2
  );
  const p2Avg = Math.round(
    (playersById[p2Players[0]].rating + playersById[p2Players[1]].rating) / 2
  );
  const deltaPlayer = eloDelta(p1Avg, p2Avg, scoreA, c.ELO_K_PLAYER);

  const updPairs = [
    {
      id: p1.id,
      fields: {
        [c.PR_RATING]: newP1Rating,
        [c.PR_GP]: p1.gamesPlayed + 1,
        [c.PR_W]: p1.wins + (pair1Won ? 1 : 0),
        [c.PR_L]: p1.losses + (pair1Won ? 0 : 1),
      },
    },
    {
      id: p2.id,
      fields: {
        [c.PR_RATING]: newP2Rating,
        [c.PR_GP]: p2.gamesPlayed + 1,
        [c.PR_W]: p2.wins + (pair1Won ? 0 : 1),
        [c.PR_L]: p2.losses + (pair1Won ? 1 : 0),
      },
    },
  ];

  const applyDelta = (r, d) => Math.round(r + d);

  const updPlayers = [
    {
      id: p1Players[0],
      fields: {
        [c.P_INDIV_RATING]: applyDelta(
          playersById[p1Players[0]].rating,
          deltaPlayer
        ),
        [c.P_GP]: playersById[p1Players[0]].gamesPlayed + 1,
        [c.P_W]: playersById[p1Players[0]].wins + (pair1Won ? 1 : 0),
        [c.P_L]: playersById[p1Players[0]].losses + (pair1Won ? 0 : 1),
      },
    },
    {
      id: p1Players[1],
      fields: {
        [c.P_INDIV_RATING]: applyDelta(
          playersById[p1Players[1]].rating,
          deltaPlayer
        ),
        [c.P_GP]: playersById[p1Players[1]].gamesPlayed + 1,
        [c.P_W]: playersById[p1Players[1]].wins + (pair1Won ? 1 : 0),
        [c.P_L]: playersById[p1Players[1]].losses + (pair1Won ? 0 : 1),
      },
    },
    {
      id: p2Players[0],
      fields: {
        [c.P_INDIV_RATING]: applyDelta(
          playersById[p2Players[0]].rating,
          -deltaPlayer
        ),
        [c.P_GP]: playersById[p2Players[0]].gamesPlayed + 1,
        [c.P_W]: playersById[p2Players[0]].wins + (pair1Won ? 0 : 1),
        [c.P_L]: playersById[p2Players[0]].losses + (pair1Won ? 1 : 0),
      },
    },
    {
      id: p2Players[1],
      fields: {
        [c.P_INDIV_RATING]: applyDelta(
          playersById[p2Players[1]].rating,
          -deltaPlayer
        ),
        [c.P_GP]: playersById[p2Players[1]].gamesPlayed + 1,
        [c.P_W]: playersById[p2Players[1]].wins + (pair1Won ? 0 : 1),
        [c.P_L]: playersById[p2Players[1]].losses + (pair1Won ? 1 : 0),
      },
    },
  ];

  await updateRecords(c.T_PAIRS, updPairs);
  await updateRecords(c.T_PLAYERS, updPlayers);

  return {
    pair1Won,
    deltaPair: Math.round(deltaPair),
    deltaPlayer: Math.round(deltaPlayer),
  };
}

// ---------------- API ----------------

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.post('/api/me', async (req, res) => {
  try {
    if (!requireEnv(res)) return;
    const initData = getInitDataFromReq(req);
    const { user, existing } = await getOrCreatePlayerByTelegram(initData);
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
    if (!requireEnv(res)) return;
    const c = cfg();
    const initData = getInitDataFromReq(req);
    const { user, existing } = await getOrCreatePlayerByTelegram(initData);

    const name = displayNameFromTg(user);
    const username = user.username || '';

    if (existing) {
      const updated = await updateRecords(c.T_PLAYERS, [
        {
          id: existing.id,
          fields: { [c.P_NAME]: name, [c.P_TG_USERNAME]: username },
        },
      ]);
      return res.json({
        ok: true,
        player: normalizePlayer(updated?.records?.[0]),
        action: 'updated',
      });
    }

    const created = await createRecords(c.T_PLAYERS, [
      {
        fields: {
          [c.P_NAME]: name,
          [c.P_TG_ID]: Number(user.id),
          [c.P_TG_USERNAME]: username,
          [c.P_INDIV_RATING]: c.DEFAULT_RATING,
          [c.P_GP]: 0,
          [c.P_W]: 0,
          [c.P_L]: 0,
        },
      },
    ]);
    return res.json({
      ok: true,
      player: normalizePlayer(created?.records?.[0]),
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
    if (!requireEnv(res)) return;
    validateTelegramInitDataOrThrow(getInitDataFromReq(req));
    const c = cfg();
    const records = await listAll(c.T_PLAYERS, {
      sort: [{ field: c.P_INDIV_RATING, direction: 'desc' }],
    });
    res.json({ ok: true, players: records.map(normalizePlayer) });
  } catch (e) {
    console.error('players error:', e?.message, e?.details || '');
    res
      .status(e.status || 500)
      .json({ ok: false, error: e.message, details: e.details || null });
  }
});

app.post('/api/pairs', async (req, res) => {
  try {
    if (!requireEnv(res)) return;
    validateTelegramInitDataOrThrow(getInitDataFromReq(req));

    const c = cfg();
    const players = await listAll(c.T_PLAYERS, { maxRecords: 1000 });
    const playersById = Object.fromEntries(
      players.map(r => [r.id, normalizePlayer(r)])
    );

    const pairs = await listAll(c.T_PAIRS, {
      sort: [{ field: c.PR_RATING, direction: 'desc' }],
    });

    res.json({
      ok: true,
      pairs: pairs.map(r => {
        const p = normalizePair(r);
        return {
          ...p,
          player1Obj: p.player1 ? playersById[p.player1] || null : null,
          player2Obj: p.player2 ? playersById[p.player2] || null : null,
        };
      }),
    });
  } catch (e) {
    console.error('pairs error:', e?.message, e?.details || '');
    res
      .status(e.status || 500)
      .json({ ok: false, error: e.message, details: e.details || null });
  }
});

app.post('/api/pairs/create', async (req, res) => {
  try {
    if (!requireEnv(res)) return;
    validateTelegramInitDataOrThrow(getInitDataFromReq(req));

    const { player1Id, player2Id } = req.body || {};
    if (!player1Id || !player2Id)
      return res
        .status(400)
        .json({ ok: false, error: 'player1Id and player2Id are required' });

    const c = cfg();
    const players = await listAll(c.T_PLAYERS, { maxRecords: 1000 });
    const playersById = Object.fromEntries(
      players.map(r => [r.id, normalizePlayer(r)])
    );

    const { pairRec, created } = await findOrCreatePair(
      player1Id,
      player2Id,
      playersById
    );
    const p = normalizePair(pairRec);

    res.json({
      ok: true,
      created,
      pair: {
        ...p,
        player1Obj: p.player1 ? playersById[p.player1] || null : null,
        player2Obj: p.player2 ? playersById[p.player2] || null : null,
      },
    });
  } catch (e) {
    console.error('pairs/create error:', e?.message, e?.details || '');
    res
      .status(e.status || 500)
      .json({ ok: false, error: e.message, details: e.details || null });
  }
});

app.post('/api/matches', async (req, res) => {
  try {
    if (!requireEnv(res)) return;
    validateTelegramInitDataOrThrow(getInitDataFromReq(req));

    const c = cfg();

    const matches = await listAll(c.T_MATCHES, {
      maxRecords: 200,
      sort: [{ field: c.M_DATE, direction: 'desc' }],
    });
    const pairs = await listAll(c.T_PAIRS, { maxRecords: 1000 });
    const players = await listAll(c.T_PLAYERS, { maxRecords: 1000 });
    const setScores = await listAll(c.T_SETSCORES, { maxRecords: 2000 });

    const pairsById = Object.fromEntries(
      pairs.map(r => [r.id, normalizePair(r)])
    );
    const playersById = Object.fromEntries(
      players.map(r => [r.id, normalizePlayer(r)])
    );
    const setNorm = setScores.map(normalizeSetScore);

    const expandPair = pairId => {
      const p = pairId ? pairsById[pairId] || null : null;
      if (!p) return null;
      return {
        ...p,
        player1Obj: p.player1 ? playersById[p.player1] || null : null,
        player2Obj: p.player2 ? playersById[p.player2] || null : null,
      };
    };

    const out = matches.map(r => {
      const m = normalizeMatch(r);
      const pair1Obj = expandPair(m.pair1);
      const pair2Obj = expandPair(m.pair2);
      const ss = setNorm
        .filter(x => x.match === m.id)
        .sort((a, b) => a.setNo - b.setNo);

      const opponentPlayerIds = uniq([pair2Obj?.player1, pair2Obj?.player2]);
      const confirmedBy = uniq(m.confirmedBy);

      return {
        ...m,
        pair1Obj,
        pair2Obj,
        setScores: ss,
        opponentPlayerIds,
        confirmedBy,
      };
    });

    res.json({ ok: true, matches: out });
  } catch (e) {
    console.error('matches error:', e?.message, e?.details || '');
    res
      .status(e.status || 500)
      .json({ ok: false, error: e.message, details: e.details || null });
  }
});

app.post('/api/matches/report', async (req, res) => {
  try {
    if (!requireEnv(res)) return;
    const c = cfg();
    const initData = getInitDataFromReq(req);
    const { existing } = await getOrCreatePlayerByTelegram(initData);
    if (!existing)
      return res
        .status(403)
        .json({ ok: false, error: 'You must Join before reporting matches' });

    const body = req.body || {};
    const myPairId = body.myPairId;
    const oppPairId = body.oppPairId;
    const sets = Array.isArray(body.sets) ? body.sets : [];

    if (!myPairId || !oppPairId)
      return res
        .status(400)
        .json({ ok: false, error: 'myPairId and oppPairId are required' });
    if (myPairId === oppPairId)
      return res
        .status(400)
        .json({ ok: false, error: 'Opponent pair must be different' });

    if (sets.length < 2 || sets.length > 3)
      return res.status(400).json({ ok: false, error: 'Provide 2 or 3 sets' });

    const parsedSets = sets.map((s, i) => {
      const { p1, p2 } = validateSetGames(s.p1, s.p2, i + 1);
      return { setNo: i + 1, p1, p2 };
    });

    const first2 = parsedSets.slice(0, 2).reduce(
      (acc, s) => {
        if (s.p1 > s.p2) acc.p1++;
        else acc.p2++;
        return acc;
      },
      { p1: 0, p2: 0 }
    );
    if (first2.p1 === 1 && first2.p2 === 1 && parsedSets.length !== 3) {
      return res
        .status(400)
        .json({ ok: false, error: 'First two sets are 1-1. Provide 3rd set.' });
    }
    if ((first2.p1 === 2 || first2.p2 === 2) && parsedSets.length === 3) {
      return res
        .status(400)
        .json({
          ok: false,
          error: 'Match decided in 2 sets. Do not provide 3rd set.',
        });
    }

    const myPairRec = await getRecord(c.T_PAIRS, myPairId);
    const oppPairRec = await getRecord(c.T_PAIRS, oppPairId);
    const myPair = normalizePair(myPairRec);
    const oppPair = normalizePair(oppPairRec);

    const myPlayers = [myPair.player1, myPair.player2].filter(Boolean);
    const oppPlayers = [oppPair.player1, oppPair.player2].filter(Boolean);

    if (myPlayers.length !== 2 || oppPlayers.length !== 2) {
      return res
        .status(400)
        .json({ ok: false, error: 'Both pairs must have exactly 2 players' });
    }

    if (!myPlayers.includes(existing.id)) {
      return res
        .status(403)
        .json({
          ok: false,
          error: 'You can only report match for a pair you belong to',
        });
    }

    if (setIntersection(myPlayers, oppPlayers)) {
      return res
        .status(400)
        .json({ ok: false, error: 'Same player cannot appear in both pairs' });
    }

    const dateISO = body.date || new Date().toISOString().slice(0, 10);
    const scoreText = parsedSets.map(s => `${s.p1}-${s.p2}`).join(' ');

    const matchCreate = await createRecords(c.T_MATCHES, [
      {
        fields: {
          [c.M_DATE]: dateISO,
          [c.M_TIME]: body.time || '',
          [c.M_PAIR1]: [myPairId],
          [c.M_PAIR2]: [oppPairId],
          [c.M_INITIATED_BY]: [existing.id],
          [c.M_SCORE]: scoreText,
          [c.M_STATUS]: c.STATUS_PENDING,
        },
      },
    ]);

    const matchRec = matchCreate?.records?.[0];
    if (!matchRec?.id) throw new Error('Failed to create match');
    const matchId = matchRec.id;

    const setRecords = parsedSets.map(s => {
      const winnerPair = s.p1 > s.p2 ? myPairId : oppPairId;
      return {
        fields: {
          [c.S_MATCH]: [matchId],
          [c.S_SET_NO]: s.setNo,
          [c.S_P1]: s.p1,
          [c.S_P2]: s.p2,
          [c.S_WINNER_PAIR]: [winnerPair],
        },
      };
    });

    await createRecords(c.T_SETSCORES, setRecords);

    res.json({
      ok: true,
      matchId,
      status: c.STATUS_PENDING,
      message:
        'Match created. Waiting for opponent confirmation (one player is enough).',
    });
  } catch (e) {
    console.error('matches/report error:', e?.message, e?.details || '');
    res
      .status(e.status || 500)
      .json({ ok: false, error: e.message, details: e.details || null });
  }
});

// --- NEW: one opponent confirmation is enough ---
const confirmInFlight = new Set();

app.post('/api/matches/confirm', async (req, res) => {
  const c = cfg();
  const initData = getInitDataFromReq(req);
  const { matchId } = req.body || {};

  try {
    if (!requireEnv(res)) return;

    const { existing } = await getOrCreatePlayerByTelegram(initData);
    if (!existing)
      return res.status(403).json({ ok: false, error: 'You must Join' });
    if (!matchId)
      return res.status(400).json({ ok: false, error: 'matchId is required' });

    if (confirmInFlight.has(matchId)) {
      return res.json({
        ok: true,
        status: 'PROCESSING',
        message: 'Confirmation is being processed. Refresh in a moment.',
      });
    }

    const matchRec = await getRecord(c.T_MATCHES, matchId);
    const m = normalizeMatch(matchRec);

    if (m.status === c.STATUS_DISPUTED || m.status === c.STATUS_REJECTED) {
      return res
        .status(409)
        .json({ ok: false, error: `Match is ${m.status}. Cannot confirm.` });
    }
    if (m.status === c.STATUS_CONFIRMED) {
      return res.json({
        ok: true,
        status: c.STATUS_CONFIRMED,
        message: 'Already confirmed',
      });
    }
    if (!m.pair2)
      return res
        .status(500)
        .json({ ok: false, error: 'Match missing opponent pair' });

    const oppPairRec = await getRecord(c.T_PAIRS, m.pair2);
    const oppPair = normalizePair(oppPairRec);
    const opponentPlayerIds = uniq([oppPair.player1, oppPair.player2]);

    if (!opponentPlayerIds.includes(existing.id)) {
      return res
        .status(403)
        .json({
          ok: false,
          error: 'Only opponent pair can confirm this match',
        });
    }

    confirmInFlight.add(matchId);
    try {
      const nextConfirmed = uniq([...(m.confirmedBy || []), existing.id]);

      // Confirm immediately (one opponent is enough)
      await updateRecords(c.T_MATCHES, [
        {
          id: matchId,
          fields: {
            [c.M_STATUS]: c.STATUS_CONFIRMED,
            [c.M_CONFIRMED_BY]: nextConfirmed,
          },
        },
      ]);

      const allSets = await listAll(c.T_SETSCORES, { maxRecords: 2000 });
      const setsForMatch = allSets.filter(
        r => normalizeSetScore(r).match === matchId
      );

      const ratingResult = await applyRatingsForMatch(matchRec, setsForMatch);

      return res.json({
        ok: true,
        status: c.STATUS_CONFIRMED,
        confirmedBy: nextConfirmed,
        message: 'Match confirmed (one opponent). Ratings updated.',
        ratingDeltaPair: ratingResult.deltaPair,
        ratingDeltaPlayer: ratingResult.deltaPlayer,
      });
    } finally {
      confirmInFlight.delete(matchId);
    }
  } catch (e) {
    console.error('matches/confirm error:', e?.message, e?.details || '');
    res
      .status(e.status || 500)
      .json({ ok: false, error: e.message, details: e.details || null });
  }
});

app.post('/api/matches/reject', async (req, res) => {
  try {
    if (!requireEnv(res)) return;
    const c = cfg();

    const initData = getInitDataFromReq(req);
    const { existing } = await getOrCreatePlayerByTelegram(initData);
    if (!existing)
      return res.status(403).json({ ok: false, error: 'You must Join' });

    const { matchId, reason } = req.body || {};
    if (!matchId)
      return res.status(400).json({ ok: false, error: 'matchId is required' });

    const matchRec = await getRecord(c.T_MATCHES, matchId);
    const m = normalizeMatch(matchRec);

    if (m.status === c.STATUS_CONFIRMED)
      return res
        .status(409)
        .json({ ok: false, error: 'Already confirmed. Cannot reject.' });
    if (!m.pair2)
      return res
        .status(500)
        .json({ ok: false, error: 'Match missing opponent pair' });

    const oppPairRec = await getRecord(c.T_PAIRS, m.pair2);
    const oppPair = normalizePair(oppPairRec);
    const opponentPlayerIds = uniq([oppPair.player1, oppPair.player2]);

    if (!opponentPlayerIds.includes(existing.id)) {
      return res
        .status(403)
        .json({ ok: false, error: 'Only opponent pair can reject this match' });
    }

    await updateRecords(c.T_MATCHES, [
      {
        id: matchId,
        fields: {
          [c.M_STATUS]: c.STATUS_REJECTED,
          [c.M_DISPUTE_REASON]: reason || '',
        },
      },
    ]);

    res.json({
      ok: true,
      status: c.STATUS_REJECTED,
      message: 'Match rejected. No rating changes.',
    });
  } catch (e) {
    console.error('matches/reject error:', e?.message, e?.details || '');
    res
      .status(e.status || 500)
      .json({ ok: false, error: e.message, details: e.details || null });
  }
});

app.post('/api/matches/dispute', async (req, res) => {
  try {
    if (!requireEnv(res)) return;
    const c = cfg();

    const initData = getInitDataFromReq(req);
    const { existing } = await getOrCreatePlayerByTelegram(initData);
    if (!existing)
      return res.status(403).json({ ok: false, error: 'You must Join' });

    const { matchId, reason } = req.body || {};
    if (!matchId)
      return res.status(400).json({ ok: false, error: 'matchId is required' });

    const matchRec = await getRecord(c.T_MATCHES, matchId);
    const m = normalizeMatch(matchRec);

    if (m.status === c.STATUS_CONFIRMED)
      return res
        .status(409)
        .json({ ok: false, error: 'Already confirmed. Cannot dispute.' });
    if (!m.pair2)
      return res
        .status(500)
        .json({ ok: false, error: 'Match missing opponent pair' });

    const oppPairRec = await getRecord(c.T_PAIRS, m.pair2);
    const oppPair = normalizePair(oppPairRec);
    const opponentPlayerIds = uniq([oppPair.player1, oppPair.player2]);

    if (!opponentPlayerIds.includes(existing.id)) {
      return res
        .status(403)
        .json({
          ok: false,
          error: 'Only opponent pair can dispute this match',
        });
    }

    await updateRecords(c.T_MATCHES, [
      {
        id: matchId,
        fields: {
          [c.M_STATUS]: c.STATUS_DISPUTED,
          [c.M_DISPUTE_REASON]: reason || '',
        },
      },
    ]);

    res.json({
      ok: true,
      status: c.STATUS_DISPUTED,
      message: 'Match disputed. No rating changes.',
    });
  } catch (e) {
    console.error('matches/dispute error:', e?.message, e?.details || '');
    res
      .status(e.status || 500)
      .json({ ok: false, error: e.message, details: e.details || null });
  }
});

app.use('/api', (_req, res) =>
  res.status(404).json({ ok: false, error: 'Not found' })
);

// Frontend
const distPath = path.join(__dirname, 'web', 'dist');
app.use(express.static(distPath));

// Express 5 friendly catch-all
app.get('/*splat', (_req, res) =>
  res.sendFile(path.join(distPath, 'index.html'))
);

const port = process.env.PORT || 8080;
app.listen(port, '0.0.0.0', () => console.log(`Server listening on ${port}`));
