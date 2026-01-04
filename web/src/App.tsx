import { useEffect, useMemo, useState } from "react";

type TgUser = { id: number; first_name?: string; last_name?: string; username?: string };

type Player = {
  id: string;
  name: string;
  telegramId: number | null;
  telegramUsername: string;
  rating: number;
  gamesPlayed: number;
  wins: number;
  losses: number;
};

type Pair = {
  id: string;
  player1: string | null;
  player2: string | null;
  rating: number;
  gamesPlayed: number;
  wins: number;
  losses: number;
  player1Obj?: Player | null;
  player2Obj?: Player | null;
};

type SetScore = { id: string; match: string | null; setNo: number; p1: number; p2: number; winnerPair: string | null };

type Match = {
  id: string;
  date: any;
  time: string;
  status: string;
  pair1: string | null;
  pair2: string | null;
  initiatedBy: string | null;
  confirmedBy: string | null;
  score: string;
  pair1Obj?: Pair | null;
  pair2Obj?: Pair | null;
  setScores?: SetScore[];
};

type ApiFail = { ok: false; error: string; details?: any; status?: number; raw?: string };

function getTg() {
  return (window as any).Telegram?.WebApp;
}

function meName(u: TgUser | null) {
  if (!u) return "";
  const full = [u.first_name, u.last_name].filter(Boolean).join(" ").trim();
  if (full) return full;
  if (u.username) return `@${u.username}`;
  return `User ${u.id}`;
}

async function fetchJsonWithTimeout(url: string, options: RequestInit, timeoutMs = 15000) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    const contentType = res.headers.get("content-type") || "";
    const text = await res.text();

    if (contentType.includes("application/json")) {
      try {
        return JSON.parse(text || "{}");
      } catch {
        return { ok: false, error: "Invalid JSON from server", status: res.status, raw: text };
      }
    }
    return { ok: false, error: "Non-JSON response from server", status: res.status, raw: text };
  } finally {
    clearTimeout(t);
  }
}

export default function App() {
  const tg = useMemo(() => getTg(), []);
  const [screen, setScreen] = useState<"loading" | "join" | "app" | "error">("loading");
  const [tab, setTab] = useState<"league" | "matches" | "pairs">("league");

  const [status, setStatus] = useState("Loading…");
  const [busy, setBusy] = useState(false);

  const [user, setUser] = useState<TgUser | null>(null);
  const [mePlayer, setMePlayer] = useState<Player | null>(null);

  const [players, setPlayers] = useState<Player[]>([]);
  const [pairs, setPairs] = useState<Pair[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);

  // Forms
  const [pairP1, setPairP1] = useState<string>("");
  const [pairP2, setPairP2] = useState<string>("");

  const [partnerId, setPartnerId] = useState<string>("");
  const [opp1Id, setOpp1Id] = useState<string>("");
  const [opp2Id, setOpp2Id] = useState<string>("");
  const [s1a, setS1a] = useState<string>("6");
  const [s1b, setS1b] = useState<string>("4");
  const [s2a, setS2a] = useState<string>("4");
  const [s2b, setS2b] = useState<string>("6");
  const [useS3, setUseS3] = useState<boolean>(false);
  const [s3a, setS3a] = useState<string>("10");
  const [s3b, setS3b] = useState<string>("8");

  const [raw, setRaw] = useState<any>(null);

  async function apiPost(path: string, body: any = {}) {
    const initData = tg?.initData;
    return await fetchJsonWithTimeout(
      path,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, initData })
      },
      20000
    );
  }

  async function loadPlayers() {
    const json = await apiPost("/api/players");
    setRaw(json);
    if (!json.ok) throw new Error(json.error);
    setPlayers(json.players || []);
  }

  async function loadPairs() {
    const json = await apiPost("/api/pairs");
    setRaw(json);
    if (!json.ok) throw new Error(json.error);
    setPairs(json.pairs || []);
  }

  async function loadMatches() {
    const json = await apiPost("/api/matches");
    setRaw(json);
    if (!json.ok) throw new Error(json.error);
    setMatches(json.matches || []);
  }

  async function refreshAll() {
    setBusy(true);
    setStatus("Refreshing…");
    try {
      await loadPlayers();
      await loadPairs();
      await loadMatches();
      setStatus("OK");
    } finally {
      setBusy(false);
    }
  }

  async function checkMe() {
    if (!tg) {
      setStatus("Открой это внутри Telegram как Mini App.");
      setScreen("error");
      return;
    }

    tg.ready();
    tg.expand?.();

    if (!tg.initData) {
      setStatus("initData пустая. Открывай Mini App через кнопку Web App у бота.");
      setScreen("error");
      return;
    }

    setBusy(true);
    setStatus("Checking membership…");
    try {
      const json = await apiPost("/api/me");
      setRaw(json);

      if (!json.ok) {
        setStatus(`Error: ${json.error}`);
        setScreen("error");
        return;
      }

      setUser(json.user);
      if (!json.joined) {
        setScreen("join");
        setStatus("Not joined yet");
        return;
      }

      setMePlayer(json.player || null);
      setScreen("app");
      setStatus("OK");
      await refreshAll();
    } finally {
      setBusy(false);
    }
  }

  async function joinLeague() {
    setBusy(true);
    setStatus("Joining league…");
    try {
      const json = await apiPost("/api/join");
      setRaw(json);

      if (!json.ok) {
        setStatus(`Join failed: ${json.error}`);
        setScreen("error");
        return;
      }

      setMePlayer(json.player || null);
      setScreen("app");
      await refreshAll();
    } finally {
      setBusy(false);
    }
  }

  async function createPair() {
    if (!pairP1 || !pairP2) {
      setStatus("Select two players for the pair.");
      return;
    }
    if (pairP1 === pairP2) {
      setStatus("Pair cannot have the same player twice.");
      return;
    }

    setBusy(true);
    setStatus("Creating pair…");
    try {
      const json = await apiPost("/api/pairs/create", { player1Id: pairP1, player2Id: pairP2 });
      setRaw(json);

      if (!json.ok) {
        setStatus(`Create pair failed: ${json.error}`);
        setScreen("error");
        return;
      }

      setStatus(json.created ? "Pair created" : "Pair already existed");
      await loadPairs();
      setTab("pairs");
    } finally {
      setBusy(false);
    }
  }

  async function reportMatch() {
    if (!mePlayer?.id) {
      setStatus("You are not joined.");
      return;
    }
    if (!partnerId || !opp1Id || !opp2Id) {
      setStatus("Select partner and both opponent players.");
      return;
    }
    if (partnerId === mePlayer.id) {
      setStatus("Partner cannot be yourself.");
      return;
    }
    if (opp1Id === opp2Id) {
      setStatus("Opponent pair cannot have the same player twice.");
      return;
    }

    const sets: any[] = [
      { p1: Number(s1a), p2: Number(s1b) },
      { p1: Number(s2a), p2: Number(s2b) }
    ];
    if (useS3) sets.push({ p1: Number(s3a), p2: Number(s3b) });

    setBusy(true);
    setStatus("Reporting match…");
    try {
      const json = await apiPost("/api/matches/report", {
        partnerId,
        opp1Id,
        opp2Id,
        sets
      });
      setRaw(json);

      if (!json.ok) {
        setStatus(`Report failed: ${json.error}`);
        setScreen("error");
        return;
      }

      setStatus(`Match saved. Winner: ${json.winner}. ΔPair=${json.ratingDeltaPair}, ΔPlayer=${json.ratingDeltaPlayer}`);
      await refreshAll();
      setTab("matches");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    checkMe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const playerOptions = [
    <option key="-" value="">
      — select —
    </option>,
    ...players.map((p) => (
      <option key={p.id} value={p.id}>
        {p.name} (#{p.rating})
      </option>
    ))
  ];

  const TabButton = ({ id, label }: { id: "league" | "matches" | "pairs"; label: string }) => (
    <button
      onClick={() => setTab(id)}
      disabled={busy}
      style={{
        flex: 1,
        padding: "10px 8px",
        border: "1px solid #ddd",
        background: tab === id ? "#f2f2f2" : "white",
        borderRadius: 10,
        fontWeight: 800,
        cursor: busy ? "not-allowed" : "pointer"
      }}
    >
      {label}
    </button>
  );

  return (
    <div style={{ fontFamily: "system-ui, sans-serif", padding: 16, lineHeight: 1.4, maxWidth: 900 }}>
      <h2 style={{ margin: "0 0 6px" }}>Padel League</h2>
      <div style={{ opacity: 0.85, marginBottom: 12 }}>
        {user ? `You: ${meName(user)}` : " "}
        {mePlayer ? ` | Rating: ${mePlayer.rating}` : ""}
      </div>

      <p style={{ marginTop: 0 }}>{status}</p>

      {screen === "loading" && <p>Loading…</p>}

      {screen === "join" && (
        <button
          onClick={joinLeague}
          disabled={busy}
          style={{
            padding: "12px 14px",
            borderRadius: 10,
            border: "1px solid #ccc",
            background: "white",
            fontWeight: 800,
            cursor: busy ? "not-allowed" : "pointer"
          }}
        >
          Join Padel League
        </button>
      )}

      {screen === "app" && (
        <>
          <div style={{ display: "flex", gap: 10, margin: "10px 0 14px" }}>
            <TabButton id="league" label="League" />
            <TabButton id="matches" label="Matches" />
            <TabButton id="pairs" label="Pairs" />
          </div>

          {tab === "league" && (
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                <h3 style={{ margin: "0 0 10px" }}>Players</h3>
                <button
                  onClick={refreshAll}
                  disabled={busy}
                  style={{ padding: "8px 10px", borderRadius: 10, border: "1px solid #ccc", background: "white" }}
                >
                  Refresh
                </button>
              </div>

              <div style={{ border: "1px solid #e5e5e5", borderRadius: 12, overflow: "hidden" }}>
                {players.map((p, idx) => (
                  <div
                    key={p.id}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "42px 1fr 90px",
                      gap: 12,
                      padding: "10px 12px",
                      borderTop: idx === 0 ? "none" : "1px solid #eee",
                      background: "white",
                      alignItems: "center"
                    }}
                  >
                    <div style={{ fontWeight: 900, textAlign: "center" }}>{idx + 1}</div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 900 }}>
                        {p.name} {p.telegramUsername ? <span style={{ opacity: 0.7 }}>@{p.telegramUsername}</span> : null}
                      </div>
                      <div style={{ fontSize: 12, opacity: 0.7 }}>
                        GP {p.gamesPlayed} | W {p.wins} | L {p.losses}
                      </div>
                    </div>
                    <div style={{ fontWeight: 900, textAlign: "right" }}>{p.rating}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {tab === "pairs" && (
            <div>
              <h3 style={{ margin: "0 0 10px" }}>Pairs</h3>

              <div style={{ border: "1px solid #e5e5e5", borderRadius: 12, overflow: "hidden", marginBottom: 14 }}>
                {pairs.map((p, idx) => {
                  const a = p.player1Obj?.name || p.player1 || "—";
                  const b = p.player2Obj?.name || p.player2 || "—";
                  return (
                    <div
                      key={p.id}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "42px 1fr 90px",
                        gap: 12,
                        padding: "10px 12px",
                        borderTop: idx === 0 ? "none" : "1px solid #eee",
                        background: "white",
                        alignItems: "center"
                      }}
                    >
                      <div style={{ fontWeight: 900, textAlign: "center" }}>{idx + 1}</div>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 900 }}>
                          {a} + {b}
                        </div>
                        <div style={{ fontSize: 12, opacity: 0.7 }}>
                          GP {p.gamesPlayed} | W {p.wins} | L {p.losses}
                        </div>
                      </div>
                      <div style={{ fontWeight: 900, textAlign: "right" }}>{p.rating}</div>
                    </div>
                  );
                })}
              </div>

              <h4 style={{ margin: "0 0 8px" }}>Create pair</h4>
              <div style={{ display: "grid", gap: 8, maxWidth: 520 }}>
                <label>
                  Player 1
                  <select value={pairP1} onChange={(e) => setPairP1(e.target.value)} style={{ width: "100%", padding: 8, marginTop: 4 }}>
                    {playerOptions}
                  </select>
                </label>
                <label>
                  Player 2
                  <select value={pairP2} onChange={(e) => setPairP2(e.target.value)} style={{ width: "100%", padding: 8, marginTop: 4 }}>
                    {playerOptions}
                  </select>
                </label>
                <button
                  onClick={createPair}
                  disabled={busy}
                  style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid #ccc", background: "white", fontWeight: 800 }}
                >
                  Create
                </button>
              </div>
            </div>
          )}

          {tab === "matches" && (
            <div>
              <h3 style={{ margin: "0 0 10px" }}>Matches</h3>

              <div style={{ border: "1px solid #e5e5e5", borderRadius: 12, overflow: "hidden", marginBottom: 14 }}>
                {matches.map((m, idx) => {
                  const p1a = m.pair1Obj?.player1Obj?.name || "—";
                  const p1b = m.pair1Obj?.player2Obj?.name || "—";
                  const p2a = m.pair2Obj?.player1Obj?.name || "—";
                  const p2b = m.pair2Obj?.player2Obj?.name || "—";
                  const dateStr = typeof m.date === "string" ? m.date : m.date?.toString?.() || "";
                  return (
                    <div
                      key={m.id}
                      style={{
                        padding: "10px 12px",
                        borderTop: idx === 0 ? "none" : "1px solid #eee",
                        background: "white"
                      }}
                    >
                      <div style={{ fontWeight: 900 }}>
                        {dateStr} {m.time ? `| ${m.time}` : ""} {m.status ? `| ${m.status}` : ""}
                      </div>
                      <div style={{ marginTop: 4 }}>
                        <b>{p1a}</b> + <b>{p1b}</b> vs <b>{p2a}</b> + <b>{p2b}</b>
                      </div>
                      <div style={{ opacity: 0.75, marginTop: 2 }}>Score: {m.score || "—"}</div>
                    </div>
                  );
                })}
              </div>

              <h4 style={{ margin: "0 0 8px" }}>Report match result</h4>
              <div style={{ display: "grid", gap: 8, maxWidth: 560 }}>
                <label>
                  Your partner (you are fixed)
                  <select value={partnerId} onChange={(e) => setPartnerId(e.target.value)} style={{ width: "100%", padding: 8, marginTop: 4 }}>
                    {playerOptions}
                  </select>
                </label>

                <label>
                  Opponent player 1
                  <select value={opp1Id} onChange={(e) => setOpp1Id(e.target.value)} style={{ width: "100%", padding: 8, marginTop: 4 }}>
                    {playerOptions}
                  </select>
                </label>

                <label>
                  Opponent player 2
                  <select value={opp2Id} onChange={(e) => setOpp2Id(e.target.value)} style={{ width: "100%", padding: 8, marginTop: 4 }}>
                    {playerOptions}
                  </select>
                </label>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  <label>
                    Set 1 (your pair)
                    <input value={s1a} onChange={(e) => setS1a(e.target.value)} inputMode="numeric" style={{ width: "100%", padding: 8, marginTop: 4 }} />
                  </label>
                  <label>
                    Set 1 (opponents)
                    <input value={s1b} onChange={(e) => setS1b(e.target.value)} inputMode="numeric" style={{ width: "100%", padding: 8, marginTop: 4 }} />
                  </label>

                  <label>
                    Set 2 (your pair)
                    <input value={s2a} onChange={(e) => setS2a(e.target.value)} inputMode="numeric" style={{ width: "100%", padding: 8, marginTop: 4 }} />
                  </label>
                  <label>
                    Set 2 (opponents)
                    <input value={s2b} onChange={(e) => setS2b(e.target.value)} inputMode="numeric" style={{ width: "100%", padding: 8, marginTop: 4 }} />
                  </label>
                </div>

                <label style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <input type="checkbox" checked={useS3} onChange={(e) => setUseS3(e.target.checked)} />
                  Add 3rd set
                </label>

                {useS3 && (
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                    <label>
                      Set 3 (your pair)
                      <input value={s3a} onChange={(e) => setS3a(e.target.value)} inputMode="numeric" style={{ width: "100%", padding: 8, marginTop: 4 }} />
                    </label>
                    <label>
                      Set 3 (opponents)
                      <input value={s3b} onChange={(e) => setS3b(e.target.value)} inputMode="numeric" style={{ width: "100%", padding: 8, marginTop: 4 }} />
                    </label>
                  </div>
                )}

                <button
                  onClick={reportMatch}
                  disabled={busy}
                  style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid #ccc", background: "white", fontWeight: 800 }}
                >
                  Save match + update ratings
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {screen === "error" && (
        <button
          disabled={busy}
          onClick={checkMe}
          style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid #ccc", background: "white", fontWeight: 800 }}
        >
          Retry
        </button>
      )}

      <details style={{ marginTop: 14, opacity: 0.9 }}>
        <summary style={{ cursor: "pointer" }}>Debug</summary>
        <pre style={{ background: "#f6f6f6", padding: 12, borderRadius: 8, overflowX: "auto" }}>
          {JSON.stringify(raw, null, 2)}
        </pre>
      </details>
    </div>
  );
}
