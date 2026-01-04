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

    // Table names (edit via env if you named them differently)
    T_PLAYERS: process.env.AIRTABLE_PLAYERS_TABLE || 'Players',
    T_PAIRS: process.env.AIRTABLE_PAIRS_TABLE || 'Pairs',
    T_MATCHES: process.env.AIRTABLE_MATCHES_TABLE || 'Matches',
    T_SETSCORES: process.env.AIRTABLE_SETSCORES_TABLE || 'SetScores',

    // Players fields (from your screenshot)
    P_NAME: 'Name',
    P_TG_ID: 'Telegram ID',
    P_TG_USERNAME: 'Telegram Username',
    P_INDIV_RATING: 'Individual Rating',
    P_GP: 'Games Played',
    P_W: 'Wins',
    P_L: 'Losses',

    // Pairs fields (from your screenshot)
    PR_ID: 'Id',
    PR_PLAYER1: 'Player 1',
    PR_PLAYER2: 'Player 2',
    PR_RATING: 'Pair Rating',
    PR_GP: 'Games Played',
    PR_W: 'Wins',
    PR_L: 'Losses',

    // Matches fields (from your screenshot)
    M_ID: 'Id',
    M_DATE: 'Date',
    M_TIME: 'Time',
    M_STATUS: 'Status', // single select: we will NOT set unless provided
    M_PAIR1: 'Pair 1',
    M_PAIR2: 'Pair 2',
    M_INITIATED_BY: 'Initiated By',
    M_CONFIRMED_BY: 'Confirmed By',
    M_SCORE: 'Score',
    M_SETSCORES: 'SetScores',

    // SetScores fields (from your screenshot)
    S_ID: 'Id',
    S_MATCH: 'Match',
    S_SET_NO: 'Set N°',
    S_P1: 'Pair 1 Score',
    S_P2: 'Pair 2 Score',
    S_WINNER_PAIR: 'Winner Pair',

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

function tableUrl(tableName) {
  const c = cfg();
  return `${AIRTABLE_API}/${encodeURIComponent(
    c.AIRTABLE_BASE_ID
  )}/${encodeURIComponent(tableName)}`;
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

async function listAll(tableName, paramsObj = {}) {
  // Airtable list endpoint supports filterByFormula, sort, offset pagination
  const records = [];
  let offset = null;

  do {
    const params = new URLSearchParams();
    params.set('pageSize', String(paramsObj.pageSize || 100));
    if (paramsObj.maxRecords)
      params.set('maxRecords', String(paramsObj.maxRecords));
    if (paramsObj.filterByFormula)
      params.set('filterByFormula', paramsObj.filterByFormula);

    if (Array.isArray(paramsObj.sort) && paramsObj.sort.length) {
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

async function createRecords(tableName, records) {
  // Create records expects { records: [{ fields: {...}}] }
  return airtableRequest('POST', tableUrl(tableName), { records });
}

async function updateRecords(tableName, records) {
  return airtableRequest('PATCH', tableUrl(tableName), { records });
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
  // Telegram: trust initData only after server-side validation
  if (!isValid(initData, c.BOT_TOKEN)) {
    const err = new Error('Invalid initData');
    err.status = 401;
    throw err;
  }
  return parse(initData);
}

function eloDelta(rA, rB, scoreA, k) {
  const expectedA = 1 / (1 + Math.pow(10, (rB - rA) / 400));
  return k * (scoreA - expectedA);
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

  const existing = found[0] || null;

  return { data, user, existing };
}

function normalizePlayer(rec) {
  const c = cfg();
  const f = rec.fields || {};
  return {
    id: rec.id,
    name: f[c.P_NAME] || '',
    telegramId: f[c.P_TG_ID] ?? null,
    telegramUsername: f[c.P_TG_USERNAME] || '',
    rating:
      typeof f[c.P_INDIV_RATING] === 'number'
        ? f[c.P_INDIV_RATING]
        : Number(f[c.P_INDIV_RATING] || 0),
    gamesPlayed:
      typeof f[c.P_GP] === 'number' ? f[c.P_GP] : Number(f[c.P_GP] || 0),
    wins: typeof f[c.P_W] === 'number' ? f[c.P_W] : Number(f[c.P_W] || 0),
    losses: typeof f[c.P_L] === 'number' ? f[c.P_L] : Number(f[c.P_L] || 0),
  };
}

function normalizePair(rec) {
  const c = cfg();
  const f = rec.fields || {};
  return {
    id: rec.id,
    player1: Array.isArray(f[c.PR_PLAYER1]) ? f[c.PR_PLAYER1][0] : null,
    player2: Array.isArray(f[c.PR_PLAYER2]) ? f[c.PR_PLAYER2][0] : null,
    rating:
      typeof f[c.PR_RATING] === 'number'
        ? f[c.PR_RATING]
        : Number(f[c.PR_RATING] || 0),
    gamesPlayed:
      typeof f[c.PR_GP] === 'number' ? f[c.PR_GP] : Number(f[c.PR_GP] || 0),
    wins: typeof f[c.PR_W] === 'number' ? f[c.PR_W] : Number(f[c.PR_W] || 0),
    losses: typeof f[c.PR_L] === 'number' ? f[c.PR_L] : Number(f[c.PR_L] || 0),
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
    confirmedBy: Array.isArray(f[c.M_CONFIRMED_BY])
      ? f[c.M_CONFIRMED_BY][0]
      : null,
    score: f[c.M_SCORE] || '',
    setScores: Array.isArray(f[c.M_SETSCORES]) ? f[c.M_SETSCORES] : [],
  };
}

function normalizeSetScore(rec) {
  const c = cfg();
  const f = rec.fields || {};
  return {
    id: rec.id,
    match: Array.isArray(f[c.S_MATCH]) ? f[c.S_MATCH][0] : null,
    setNo:
      typeof f[c.S_SET_NO] === 'number'
        ? f[c.S_SET_NO]
        : Number(f[c.S_SET_NO] || 0),
    p1: typeof f[c.S_P1] === 'number' ? f[c.S_P1] : Number(f[c.S_P1] || 0),
    p2: typeof f[c.S_P2] === 'number' ? f[c.S_P2] : Number(f[c.S_P2] || 0),
    winnerPair: Array.isArray(f[c.S_WINNER_PAIR])
      ? f[c.S_WINNER_PAIR][0]
      : null,
  };
}

async function findOrCreatePair(playerAId, playerBId, playersById) {
  const c = cfg();
  if (!playerAId || !playerBId)
    throw new Error('Both players are required for a pair');
  if (playerAId === playerBId)
    throw new Error('Pair cannot have the same player twice');

  const pairs = await listAll(c.T_PAIRS, { maxRecords: 1000 });
  // linked fields return arrays of record IDs
  for (const rec of pairs) {
    const p = normalizePair(rec);
    const a = p.player1;
    const b = p.player2;
    if (!a || !b) continue;
    const same =
      (a === playerAId && b === playerBId) ||
      (a === playerBId && b === playerAId);
    if (same) return { pairRec: rec, created: false };
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

    const name =
      [user.first_name, user.last_name].filter(Boolean).join(' ').trim() ||
      (user.username ? `@${user.username}` : `User ${user.id}`);
    const username = user.username || '';

    if (existing) {
      const updated = await updateRecords(c.T_PLAYERS, [
        {
          id: existing.id,
          fields: {
            [c.P_NAME]: name,
            [c.P_TG_USERNAME]: username,
          },
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
    const initData = getInitDataFromReq(req);
    validateTelegramInitDataOrThrow(initData);

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
    const initData = getInitDataFromReq(req);
    validateTelegramInitDataOrThrow(initData);

    const c = cfg();
    const players = await listAll(c.T_PLAYERS, { maxRecords: 1000 });
    const playersById = Object.fromEntries(
      players.map(r => [r.id, normalizePlayer(r)])
    );

    const pairs = await listAll(c.T_PAIRS, {
      sort: [{ field: c.PR_RATING, direction: 'desc' }],
    });

    const out = pairs.map(r => {
      const p = normalizePair(r);
      return {
        ...p,
        player1Obj: p.player1 ? playersById[p.player1] || null : null,
        player2Obj: p.player2 ? playersById[p.player2] || null : null,
      };
    });

    res.json({ ok: true, pairs: out });
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
    const initData = getInitDataFromReq(req);
    validateTelegramInitDataOrThrow(initData);

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
    const initData = getInitDataFromReq(req);
    validateTelegramInitDataOrThrow(initData);

    const c = cfg();
    const matches = await listAll(c.T_MATCHES, {
      maxRecords: 200,
      sort: [{ field: c.M_DATE, direction: 'desc' }],
    });

    const setScores = await listAll(c.T_SETSCORES, { maxRecords: 1000 });
    const setScoresNorm = setScores.map(normalizeSetScore);

    const players = await listAll(c.T_PLAYERS, { maxRecords: 1000 });
    const playersById = Object.fromEntries(
      players.map(r => [r.id, normalizePlayer(r)])
    );

    const pairs = await listAll(c.T_PAIRS, { maxRecords: 1000 });
    const pairsById = Object.fromEntries(
      pairs.map(r => [r.id, normalizePair(r)])
    );

    const out = matches.map(r => {
      const m = normalizeMatch(r);
      const ss = setScoresNorm
        .filter(x => x.match === m.id)
        .sort((a, b) => a.setNo - b.setNo);

      const pair1Obj = m.pair1 ? pairsById[m.pair1] || null : null;
      const pair2Obj = m.pair2 ? pairsById[m.pair2] || null : null;

      const expandPair = pairObj => {
        if (!pairObj) return null;
        return {
          ...pairObj,
          player1Obj: pairObj.player1
            ? playersById[pairObj.player1] || null
            : null,
          player2Obj: pairObj.player2
            ? playersById[pairObj.player2] || null
            : null,
        };
      };

      return {
        ...m,
        pair1Obj: expandPair(pair1Obj),
        pair2Obj: expandPair(pair2Obj),
        setScores: ss,
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
    const { user, existing } = await getOrCreatePlayerByTelegram(initData);
    if (!existing)
      return res
        .status(403)
        .json({ ok: false, error: 'You must Join before reporting matches' });

    const body = req.body || {};
    const partnerId = body.partnerId;
    const opp1Id = body.opp1Id;
    const opp2Id = body.opp2Id;
    const sets = Array.isArray(body.sets) ? body.sets : [];

    if (!partnerId || !opp1Id || !opp2Id) {
      return res
        .status(400)
        .json({ ok: false, error: 'partnerId, opp1Id, opp2Id are required' });
    }
    if (!Array.isArray(sets) || sets.length < 2) {
      return res
        .status(400)
        .json({ ok: false, error: 'Provide at least 2 sets' });
    }
    if (sets.length > 3) {
      return res.status(400).json({ ok: false, error: 'Max 3 sets' });
    }

    // validate scores
    const parsedSets = sets.map((s, i) => {
      const p1 = Number(s.p1);
      const p2 = Number(s.p2);
      if (!Number.isFinite(p1) || !Number.isFinite(p2) || p1 < 0 || p2 < 0) {
        throw new Error(`Invalid set score at index ${i}`);
      }
      if (p1 === p2) throw new Error(`Set ${i + 1} cannot be a draw`);
      return { setNo: i + 1, p1, p2 };
    });

    // If first two sets split 1-1, require third set
    const winsFirst2 = parsedSets.slice(0, 2).reduce(
      (acc, s) => {
        if (s.p1 > s.p2) acc.p1++;
        else acc.p2++;
        return acc;
      },
      { p1: 0, p2: 0 }
    );
    if (winsFirst2.p1 === 1 && winsFirst2.p2 === 1 && parsedSets.length < 3) {
      return res
        .status(400)
        .json({ ok: false, error: 'Sets are 1-1. Provide 3rd set.' });
    }

    // Load players for ratings + find/create pairs
    const players = await listAll(c.T_PLAYERS, { maxRecords: 1000 });
    const playersById = Object.fromEntries(
      players.map(r => [r.id, normalizePlayer(r)])
    );

    const myPlayerId = existing.id;
    const { pairRec: myPairRec } = await findOrCreatePair(
      myPlayerId,
      partnerId,
      playersById
    );
    const { pairRec: oppPairRec } = await findOrCreatePair(
      opp1Id,
      opp2Id,
      playersById
    );

    const myPairId = myPairRec.id;
    const oppPairId = oppPairRec.id;

    // Create match
    const today = new Date();
    const dateISO = body.date || today.toISOString().slice(0, 10); // YYYY-MM-DD

    const scoreText = parsedSets.map(s => `${s.p1}-${s.p2}`).join(' ');

    const matchCreate = await createRecords(c.T_MATCHES, [
      {
        fields: {
          [c.M_DATE]: dateISO,
          [c.M_TIME]: body.time || '',
          [c.M_PAIR1]: [myPairId],
          [c.M_PAIR2]: [oppPairId],
          [c.M_INITIATED_BY]: [myPlayerId],
          [c.M_SCORE]: scoreText,
          // IMPORTANT: do not set Status unless you guarantee the exact option name
        },
      },
    ]);

    const matchRec = matchCreate?.records?.[0];
    if (!matchRec?.id) throw new Error('Failed to create match');

    const matchId = matchRec.id;

    // Create set scores linked to the match (linked record fields are arrays of record IDs)
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

    // Decide match winner by set count
    const setWins = parsedSets.reduce(
      (acc, s) => {
        if (s.p1 > s.p2) acc.my++;
        else acc.opp++;
        return acc;
      },
      { my: 0, opp: 0 }
    );
    const myWon = setWins.my > setWins.opp;

    // Update ratings (ELO default)
    // Pair rating
    const myPair = normalizePair(myPairRec);
    const oppPair = normalizePair(oppPairRec);

    const deltaPair = eloDelta(
      myPair.rating,
      oppPair.rating,
      myWon ? 1 : 0,
      c.ELO_K_PAIR
    );
    const newMyPairRating = Math.round(myPair.rating + deltaPair);
    const newOppPairRating = Math.round(oppPair.rating - deltaPair);

    // Player rating: same delta to both players in a team (simple MVP)
    const mePlayer = playersById[myPlayerId];
    const partnerPlayer = playersById[partnerId];
    const opp1Player = playersById[opp1Id];
    const opp2Player = playersById[opp2Id];

    const avgMy = Math.round(
      ((mePlayer?.rating ?? c.DEFAULT_RATING) +
        (partnerPlayer?.rating ?? c.DEFAULT_RATING)) /
        2
    );
    const avgOpp = Math.round(
      ((opp1Player?.rating ?? c.DEFAULT_RATING) +
        (opp2Player?.rating ?? c.DEFAULT_RATING)) /
        2
    );

    const deltaPlayer = eloDelta(avgMy, avgOpp, myWon ? 1 : 0, c.ELO_K_PLAYER);
    const applyPlayerDelta = (r, d) =>
      Math.round((Number(r) || c.DEFAULT_RATING) + d);

    const updatesPairs = [
      {
        id: myPairId,
        fields: {
          [c.PR_RATING]: newMyPairRating,
          [c.PR_GP]: (myPair.gamesPlayed || 0) + 1,
          [c.PR_W]: (myPair.wins || 0) + (myWon ? 1 : 0),
          [c.PR_L]: (myPair.losses || 0) + (myWon ? 0 : 1),
        },
      },
      {
        id: oppPairId,
        fields: {
          [c.PR_RATING]: newOppPairRating,
          [c.PR_GP]: (oppPair.gamesPlayed || 0) + 1,
          [c.PR_W]: (oppPair.wins || 0) + (myWon ? 0 : 1),
          [c.PR_L]: (oppPair.losses || 0) + (myWon ? 1 : 0),
        },
      },
    ];

    const updatesPlayers = [
      {
        id: myPlayerId,
        fields: {
          [c.P_INDIV_RATING]: applyPlayerDelta(mePlayer?.rating, deltaPlayer),
          [c.P_GP]: (mePlayer?.gamesPlayed || 0) + 1,
          [c.P_W]: (mePlayer?.wins || 0) + (myWon ? 1 : 0),
          [c.P_L]: (mePlayer?.losses || 0) + (myWon ? 0 : 1),
        },
      },
      {
        id: partnerId,
        fields: {
          [c.P_INDIV_RATING]: applyPlayerDelta(
            partnerPlayer?.rating,
            deltaPlayer
          ),
          [c.P_GP]: (partnerPlayer?.gamesPlayed || 0) + 1,
          [c.P_W]: (partnerPlayer?.wins || 0) + (myWon ? 1 : 0),
          [c.P_L]: (partnerPlayer?.losses || 0) + (myWon ? 0 : 1),
        },
      },
      {
        id: opp1Id,
        fields: {
          [c.P_INDIV_RATING]: applyPlayerDelta(
            opp1Player?.rating,
            -deltaPlayer
          ),
          [c.P_GP]: (opp1Player?.gamesPlayed || 0) + 1,
          [c.P_W]: (opp1Player?.wins || 0) + (myWon ? 0 : 1),
          [c.P_L]: (opp1Player?.losses || 0) + (myWon ? 1 : 0),
        },
      },
      {
        id: opp2Id,
        fields: {
          [c.P_INDIV_RATING]: applyPlayerDelta(
            opp2Player?.rating,
            -deltaPlayer
          ),
          [c.P_GP]: (opp2Player?.gamesPlayed || 0) + 1,
          [c.P_W]: (opp2Player?.wins || 0) + (myWon ? 0 : 1),
          [c.P_L]: (opp2Player?.losses || 0) + (myWon ? 1 : 0),
        },
      },
    ];

    await updateRecords(c.T_PAIRS, updatesPairs);
    await updateRecords(c.T_PLAYERS, updatesPlayers);

    res.json({
      ok: true,
      matchId,
      score: scoreText,
      winner: myWon ? 'myPair' : 'opponentPair',
      ratingDeltaPair: Math.round(deltaPair),
      ratingDeltaPlayer: Math.round(deltaPlayer),
    });
  } catch (e) {
    console.error('matches/report error:', e?.message, e?.details || '');
    res
      .status(e.status || 500)
      .json({ ok: false, error: e.message, details: e.details || null });
  }
});

// API 404
app.use('/api', (_req, res) =>
  res.status(404).json({ ok: false, error: 'Not found' })
);

// Frontend serving
const distPath = path.join(__dirname, 'web', 'dist');
app.use(express.static(distPath));

app.get('/*splat', (_req, res) => {
  return res.sendFile(path.join(distPath, 'index.html'));
});

const port = process.env.PORT || 8080;
app.listen(port, '0.0.0.0', () => console.log(`Server listening on ${port}`));
