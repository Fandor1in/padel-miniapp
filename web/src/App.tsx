import { useEffect, useMemo, useState } from "react";

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

type SetScore = {
  id: string;
  match: string | null;
  setNo: number;
  p1: number;
  p2: number;
  winnerPair: string | null;
};

type Match = {
  id: string;
  date: any;
  time: string;
  status: string;
  pair1: string | null;
  pair2: string | null;
  initiatedBy: string | null;
  confirmedBy: string[];
  score: string;
  disputeReason: string;

  pair1Obj?: Pair | null;
  pair2Obj?: Pair | null;
  setScores?: SetScore[];

  opponentPlayerIds?: string[];
};

type CreatePairFlow =
  | null
  | {
      target: "my" | "opp" | "any";
      returnTab: "matches" | "pairs";
      lockPlayerAId?: string; // e.g. mePlayer.id for "my"
      excludePlayerIds?: string[]; // e.g. my pair players when creating opp pair
    };

function getTg() {
  return (window as any).Telegram?.WebApp;
}

async function fetchJsonWithTimeout(url: string, options: RequestInit, timeoutMs = 20000) {
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

// Padel set validation: 6-0..6-4, 7-5, 7-6
function validateSet(p1raw: string, p2raw: string, idx: number): string | null {
  const p1 = Number(p1raw);
  const p2 = Number(p2raw);
  if (!Number.isFinite(p1) || !Number.isFinite(p2)) return `Set ${idx}: enter numbers`;
  if (p1 < 0 || p2 < 0) return `Set ${idx}: negative not allowed`;
  if (p1 === p2) return `Set ${idx}: cannot be draw`;

  const w = Math.max(p1, p2);
  const l = Math.min(p1, p2);

  const ok = (w === 6 && l <= 4) || (w === 7 && (l === 5 || l === 6));
  if (!ok) return `Set ${idx}: allowed 6-0..6-4, 7-5, 7-6`;
  return null;
}

function pairPlayers(p: Pair | null | undefined) {
  return [p?.player1 || null, p?.player2 || null].filter(Boolean) as string[];
}
function intersects(a: string[], b: string[]) {
  const s = new Set(a);
  return b.some((x) => s.has(x));
}
function setsSplitAfter2(s1a: number, s1b: number, s2a: number, s2b: number) {
  const w1 = s1a > s1b ? 1 : 2;
  const w2 = s2a > s2b ? 1 : 2;
  return w1 !== w2;
}

export default function App() {
  const tg = useMemo(() => getTg(), []);
  const [screen, setScreen] = useState<"loading" | "join" | "app" | "error">("loading");
  const [tab, setTab] = useState<"league" | "matches" | "pairs">("league");

  const [status, setStatus] = useState("Loading…");
  const [busy, setBusy] = useState(false);

  const [mePlayer, setMePlayer] = useState<Player | null>(null);

  const [players, setPlayers] = useState<Player[]>([]);
  const [pairs, setPairs] = useState<Pair[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);

  // Report match (now: ONLY selection + sets)
  const [myPairId, setMyPairId] = useState<string>("");
  const [oppPairId, setOppPairId] = useState<string>("");

  // Sets
  const [s1a, setS1a] = useState<string>("6");
  const [s1b, setS1b] = useState<string>("4");
  const [s2a, setS2a] = useState<string>("4");
  const [s2b, setS2b] = useState<string>("6");
  const [s3a, setS3a] = useState<string>("7");
  const [s3b, setS3b] = useState<string>("5");

  // dispute reason (kept minimal)
  const [reason, setReason] = useState<string>("");

  // Create pair flow (button from Matches redirects here)
  const [createFlow, setCreateFlow] = useState<CreatePairFlow>(null);
  const [createA, setCreateA] = useState<string>("");
  const [createB, setCreateB] = useState<string>("");

  async function apiPost(path: string, body: any = {}) {
    const initData = tg?.initData;
    return await fetchJsonWithTimeout(
      path,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, initData }),
      },
      25000
    );
  }

  async function loadPlayers() {
    const json = await apiPost("/api/players");
    if (!json.ok) throw new Error(json.error);
    setPlayers(json.players || []);
  }
  async function loadPairs() {
    const json = await apiPost("/api/pairs");
    if (!json.ok) throw new Error(json.error);
    setPairs(json.pairs || []);
  }
  async function loadMatches() {
    const json = await apiPost("/api/matches");
    if (!json.ok) throw new Error(json.error);
    setMatches(json.matches || []);
  }

  async function refreshAll() {
    if (busy) return;
    setBusy(true);
    setStatus("Refreshing…");
    try {
      await loadPlayers();
      await loadPairs();
      await loadMatches();
      setStatus("OK");
    } catch (e: any) {
      setStatus(`Error: ${e?.message || "failed"}`);
      setScreen("error");
    } finally {
      setBusy(false);
    }
  }

  async function checkMe() {
    if (!tg) {
      setStatus("Open inside Telegram Mini App.");
      setScreen("error");
      return;
    }

    tg.ready();
    tg.expand?.();

    if (!tg.initData) {
      setStatus("initData is empty. Open via bot Web App button.");
      setScreen("error");
      return;
    }

    setBusy(true);
    setStatus("Checking…");
    try {
      const json = await apiPost("/api/me");
      if (!json.ok) {
        setStatus(`Error: ${json.error}`);
        setScreen("error");
        return;
      }

      if (!json.joined) {
        setScreen("join");
        setStatus("Not joined");
        return;
      }

      setMePlayer(json.player || null);
      setScreen("app");
      setTab("league");
      setStatus("OK");
      await refreshAll();
    } finally {
      setBusy(false);
    }
  }

  async function joinLeague() {
    setBusy(true);
    setStatus("Joining…");
    try {
      const json = await apiPost("/api/join");
      if (!json.ok) {
        setStatus(`Join failed: ${json.error}`);
        setScreen("error");
        return;
      }
      setMePlayer(json.player || null);
      setScreen("app");
      setTab("league");
      await refreshAll();
    } finally {
      setBusy(false);
    }
  }

  function startCreateMyPair() {
    if (!mePlayer?.id) return;
    setCreateFlow({ target: "my", returnTab: "matches", lockPlayerAId: mePlayer.id, excludePlayerIds: [] });
    setCreateA(mePlayer.id);
    setCreateB("");
    setTab("pairs");
    setStatus("Create your pair, then you’ll return to Matches.");
  }

  function startCreateOpponentPair() {
    if (!selectedMyPair) {
      setStatus("Select your pair first.");
      return;
    }
    const excluded = pairPlayers(selectedMyPair);
    setCreateFlow({ target: "opp", returnTab: "matches", excludePlayerIds: excluded });
    setCreateA("");
    setCreateB("");
    setTab("pairs");
    setStatus("Create opponent pair, then you’ll return to Matches.");
  }

  function startCreateAnyPair() {
    setCreateFlow({ target: "any", returnTab: "pairs", excludePlayerIds: [] });
    setCreateA("");
    setCreateB("");
    setTab("pairs");
    setStatus("Create pair.");
  }

  async function createPairSubmit() {
    const flow = createFlow;
    if (!flow) return;

    const a = flow.lockPlayerAId ? flow.lockPlayerAId : createA;
    const b = createB;

    if (!a || !b) {
      setStatus("Choose two different players.");
      return;
    }
    if (a === b) {
      setStatus("Pair must contain two different players.");
      return;
    }

    // Exclude list check (opponent creation)
    const excluded = flow.excludePlayerIds || [];
    if (excluded.includes(a) || excluded.includes(b)) {
      setStatus("This pair contains excluded player(s).");
      return;
    }

    setBusy(true);
    setStatus("Creating pair…");
    try {
      const json = await apiPost("/api/pairs/create", { player1Id: a, player2Id: b });
      if (!json.ok) {
        setStatus(`Create pair failed: ${json.error}`);
        setScreen("error");
        return;
      }

      const createdPairId = json.pair?.id || "";
      await loadPairs();

      // Route back depending on flow
      if (flow.target === "my") {
        setMyPairId(createdPairId);
        setOppPairId("");
        setTab("matches");
      } else if (flow.target === "opp") {
        setOppPairId(createdPairId);
        setTab("matches");
      } else {
        setTab("pairs");
      }

      setCreateFlow(null);
      setCreateA("");
      setCreateB("");
      setStatus("OK");
    } finally {
      setBusy(false);
    }
  }

  async function reportMatch() {
    const myPair = pairs.find((p) => p.id === myPairId) || null;
    const oppPair = pairs.find((p) => p.id === oppPairId) || null;

    if (!myPair) {
      setStatus("Select your pair first.");
      return;
    }
    if (!oppPair) {
      setStatus("Select opponent pair first.");
      return;
    }

    const sets = [
      { p1: Number(s1a), p2: Number(s1b) },
      { p1: Number(s2a), p2: Number(s2b) },
    ];

    const needThirdLocal = !s1err && !s2err && setsSplitAfter2(Number(s1a), Number(s1b), Number(s2a), Number(s2b));
    if (needThirdLocal) sets.push({ p1: Number(s3a), p2: Number(s3b) });

    setBusy(true);
    setStatus("Saving…");
    try {
      const json = await apiPost("/api/matches/report", { myPairId, oppPairId, sets });
      if (!json.ok) {
        setStatus(`Report failed: ${json.error}`);
        setScreen("error");
        return;
      }
      setStatus("Saved (pending confirmation).");
      await loadMatches();
      setTab("matches");
    } finally {
      setBusy(false);
    }
  }

  async function confirmMatch(matchId: string) {
    setBusy(true);
    setStatus("Confirming…");
    try {
      const json = await apiPost("/api/matches/confirm", { matchId });
      if (!json.ok) {
        setStatus(`Confirm failed: ${json.error}`);
        setScreen("error");
        return;
      }
      setStatus(json.message || "OK");
      await refreshAll();
    } finally {
      setBusy(false);
    }
  }

  async function disputeMatch(matchId: string) {
    setBusy(true);
    setStatus("Disputing…");
    try {
      const json = await apiPost("/api/matches/dispute", { matchId, reason });
      if (!json.ok) {
        setStatus(`Dispute failed: ${json.error}`);
        setScreen("error");
        return;
      }
      setReason("");
      setStatus(json.message || "OK");
      await refreshAll();
    } finally {
      setBusy(false);
    }
  }

  async function rejectMatch(matchId: string) {
    setBusy(true);
    setStatus("Rejecting…");
    try {
      const json = await apiPost("/api/matches/reject", { matchId, reason });
      if (!json.ok) {
        setStatus(`Reject failed: ${json.error}`);
        setScreen("error");
        return;
      }
      setReason("");
      setStatus(json.message || "OK");
      await refreshAll();
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    checkMe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------- Derived ----------
  const myPairs = useMemo(() => {
    if (!mePlayer?.id) return [];
    return pairs.filter((p) => p.player1 === mePlayer.id || p.player2 === mePlayer.id);
  }, [pairs, mePlayer?.id]);

  const selectedMyPair = useMemo(() => pairs.find((p) => p.id === myPairId) || null, [pairs, myPairId]);
  const selectedOppPair = useMemo(() => pairs.find((p) => p.id === oppPairId) || null, [pairs, oppPairId]);

  const myPairPlayers = pairPlayers(selectedMyPair);
  const oppPairPlayers = pairPlayers(selectedOppPair);

  const opponentPairsFiltered = useMemo(() => {
    if (!selectedMyPair) return [];
    return pairs
      .filter((p) => p.id !== selectedMyPair.id)
      .filter((p) => !intersects(pairPlayers(p), myPairPlayers));
  }, [pairs, selectedMyPair, myPairPlayers]);

  const s1err = validateSet(s1a, s1b, 1);
  const s2err = validateSet(s2a, s2b, 2);
  const needThird = !s1err && !s2err && setsSplitAfter2(Number(s1a), Number(s1b), Number(s2a), Number(s2b));
  const s3err = needThird ? validateSet(s3a, s3b, 3) : null;

  const pairsErr =
    selectedMyPair && selectedOppPair && intersects(myPairPlayers, oppPairPlayers)
      ? "Same player cannot be in both pairs."
      : null;

  const canSave =
    !busy &&
    !!selectedMyPair &&
    !!selectedOppPair &&
    !pairsErr &&
    !s1err &&
    !s2err &&
    (!needThird || !s3err);

  // Pairs create options based on flow
  const createExcluded = createFlow?.excludePlayerIds || [];
  const createAEffective = createFlow?.lockPlayerAId ? createFlow.lockPlayerAId : createA;

  const playerOptionsFor = (excludeIds: string[], alsoExcludeId?: string) => {
    const exclude = new Set([...(excludeIds || []), ...(alsoExcludeId ? [alsoExcludeId] : [])].filter(Boolean));
    const list = players.filter((p) => !exclude.has(p.id));
    return [
      <option key="-" value="">
        — select —
      </option>,
      ...list.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      )),
    ];
  };

  // ---------- UI (padel colors) ----------
  const colors = {
    navy: "#0B1F3B",
    green: "#18C37E",
    bg: "#F6F9FC",
    card: "#FFFFFF",
    border: "rgba(11,31,59,0.12)",
    text: "#0B1F3B",
    muted: "rgba(11,31,59,0.62)",
    danger: "#7a0000",
  };

  const Card = ({ children }: { children: any }) => (
    <div
      style={{
        background: colors.card,
        border: `1px solid ${colors.border}`,
        borderRadius: 16,
        padding: 14,
        boxShadow: "0 4px 16px rgba(11,31,59,0.06)",
      }}
    >
      {children}
    </div>
  );

  const Select = (props: any) => (
    <select
      {...props}
      style={{
        height: 48,
        borderRadius: 12,
        border: `1px solid ${colors.border}`,
        padding: "0 12px",
        background: "white",
        color: colors.text,
      }}
    />
  );

  const Input = (props: any) => (
    <input
      {...props}
      style={{
        height: 48,
        borderRadius: 12,
        border: `1px solid ${colors.border}`,
        padding: "0 12px",
        background: "white",
        color: colors.text,
      }}
    />
  );

  const Button = ({
    children,
    onClick,
    disabled,
    variant = "primary",
  }: {
    children: any;
    onClick: () => void;
    disabled?: boolean;
    variant?: "primary" | "secondary" | "danger";
  }) => {
    const base: any = {
      height: 48,
      padding: "0 14px",
      borderRadius: 12,
      border: `1px solid ${colors.border}`,
      fontWeight: 900,
      cursor: disabled ? "not-allowed" : "pointer",
      opacity: disabled ? 0.55 : 1,
      width: "100%",
    };
    const variants: any = {
      primary: { background: colors.green, color: "white", border: "1px solid rgba(0,0,0,0)" },
      secondary: { background: "white", color: colors.text },
      danger: { background: "#fff5f5", color: colors.danger },
    };
    return (
      <button onClick={onClick} disabled={disabled} style={{ ...base, ...variants[variant] }}>
        {children}
      </button>
    );
  };

  const IconButton = ({ onClick, disabled, title, children }: any) => (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        width: 48,
        height: 48,
        borderRadius: 14,
        border: `1px solid ${colors.border}`,
        background: "white",
        color: colors.text,
        display: "grid",
        placeItems: "center",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.55 : 1,
      }}
    >
      {children}
    </button>
  );

  const RefreshIcon = ({ spinning }: { spinning: boolean }) => (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      style={{
        transform: spinning ? "rotate(360deg)" : "none",
        transition: spinning ? "transform 0.8s linear" : "none",
      }}
    >
      <path d="M20 12a8 8 0 1 1-2.34-5.66" stroke={colors.green} strokeWidth="2.2" strokeLinecap="round" />
      <path
        d="M20 4v6h-6"
        stroke={colors.green}
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );

  const pairLabel = (p: Pair) => {
    const a = p.player1Obj?.name || "—";
    const b = p.player2Obj?.name || "—";
    return `${a} + ${b}`;
  };

  // ---------- Screens ----------
  return (
    <div style={{ fontFamily: "system-ui, sans-serif", background: colors.bg, minHeight: "100vh", color: colors.text }}>
      <div style={{ padding: 16, paddingBottom: 96, maxWidth: 960, margin: "0 auto" }}>
        {/* Minimal header */}
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
          <div style={{ fontSize: 18, fontWeight: 1000, color: colors.navy }}>Padel League</div>
          <div style={{ fontSize: 12, color: colors.muted, textAlign: "right" }}>{status}</div>
        </div>

        {screen === "loading" && <div style={{ marginTop: 12, color: colors.muted }}>Loading…</div>}

        {screen === "join" && (
          <div style={{ marginTop: 14, display: "grid", gap: 12 }}>
            <Card>
              <div style={{ fontWeight: 1000, fontSize: 16, color: colors.navy }}>Welcome</div>
              <div style={{ marginTop: 8, fontSize: 13, color: colors.muted, lineHeight: 1.45 }}>
                <div>• Join league and appear in leaderboard</div>
                <div>• Create pairs, track pair rating</div>
                <div>• Report match results and confirm them</div>
              </div>
              <div style={{ marginTop: 10 }}>
                <Button onClick={joinLeague} disabled={busy}>
                  Join
                </Button>
              </div>
            </Card>
          </div>
        )}

        {screen === "error" && (
          <div style={{ marginTop: 14 }}>
            <Card>
              <div style={{ fontWeight: 1000, color: colors.navy }}>Something failed.</div>
              <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
                <Button variant="secondary" onClick={checkMe} disabled={busy}>
                  Retry
                </Button>
              </div>
            </Card>
          </div>
        )}

        {screen === "app" && (
          <>
            {/* League (now includes the "home" info block) */}
            {tab === "league" && (
              <div style={{ marginTop: 14, display: "grid", gap: 12 }}>
                <Card>
                  <div style={{ fontWeight: 1000, color: colors.navy }}>How it works</div>
                  <div style={{ marginTop: 8, fontSize: 13, color: colors.muted, lineHeight: 1.45 }}>
                    <div>1) Create a pair in “Pairs”</div>
                    <div>2) Report match in “Matches”</div>
                    <div>3) Opponent confirms, then ratings update</div>
                    <div style={{ marginTop: 8 }}>Set rules: 6-0..6-4, 7-5, 7-6</div>
                  </div>

                  <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
                    <Button onClick={() => setTab("matches")} disabled={busy}>
                      Report match
                    </Button>
                    <Button onClick={() => { startCreateAnyPair(); }} disabled={busy} variant="secondary">
                      Create pair
                    </Button>
                  </div>
                </Card>

                {players.map((p, idx) => (
                  <Card key={p.id}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline" }}>
                      <div style={{ fontWeight: 1000 }}>
                        #{idx + 1} {p.name}
                      </div>
                      <div style={{ fontWeight: 1000, color: colors.navy }}>{p.rating}</div>
                    </div>
                  </Card>
                ))}
              </div>
            )}

            {/* Matches */}
            {tab === "matches" && (
              <div style={{ marginTop: 14, display: "grid", gap: 12 }}>
                <Card>
                  <div style={{ fontWeight: 1000, color: colors.navy }}>Report match</div>

                  <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
                    {/* Step 1: My pair */}
                    <div style={{ display: "grid", gap: 8 }}>
                      <div style={{ fontSize: 12, fontWeight: 900, color: colors.muted }}>Your pair</div>
                      {myPairs.length > 0 ? (
                        <Select value={myPairId} onChange={(e: any) => { setMyPairId(e.target.value); setOppPairId(""); }} disabled={busy}>
                          <option value="">Select your pair…</option>
                          {myPairs.map((p) => (
                            <option key={p.id} value={p.id}>
                              {pairLabel(p)}
                            </option>
                          ))}
                        </Select>
                      ) : (
                        <div style={{ display: "grid", gap: 10 }}>
                          <div style={{ fontSize: 12, color: colors.muted }}>You don’t have a pair yet.</div>
                          <Button onClick={startCreateMyPair} disabled={busy}>
                            Create my pair
                          </Button>
                        </div>
                      )}

                      {myPairs.length > 0 && (
                        <Button onClick={startCreateMyPair} disabled={busy} variant="secondary">
                          Create another pair
                        </Button>
                      )}
                    </div>

                    {/* Step 2: Opponent pair */}
                    <div style={{ display: "grid", gap: 8, opacity: selectedMyPair ? 1 : 0.6 }}>
                      <div style={{ fontSize: 12, fontWeight: 900, color: colors.muted }}>Opponent pair</div>

                      <Select
                        value={oppPairId}
                        onChange={(e: any) => setOppPairId(e.target.value)}
                        disabled={busy || !selectedMyPair}
                      >
                        <option value="">{selectedMyPair ? "Select opponent pair…" : "Select your pair first…"}</option>
                        {opponentPairsFiltered.map((p) => (
                          <option key={p.id} value={p.id}>
                            {pairLabel(p)}
                          </option>
                        ))}
                      </Select>

                      <Button onClick={startCreateOpponentPair} disabled={busy || !selectedMyPair} variant="secondary">
                        Create opponent pair
                      </Button>
                    </div>

                    {pairsErr ? <div style={{ fontSize: 12, fontWeight: 900, color: colors.danger }}>{pairsErr}</div> : null}

                    {/* Step 3: Sets */}
                    <div style={{ display: "grid", gap: 10, opacity: selectedMyPair && selectedOppPair ? 1 : 0.55 }}>
                      <div style={{ fontSize: 12, fontWeight: 900, color: colors.muted }}>Sets</div>

                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                        <Input value={s1a} onChange={(e: any) => setS1a(e.target.value)} inputMode="numeric" disabled={busy || !selectedOppPair} placeholder="Set1 you" />
                        <Input value={s1b} onChange={(e: any) => setS1b(e.target.value)} inputMode="numeric" disabled={busy || !selectedOppPair} placeholder="Set1 opp" />
                        <Input value={s2a} onChange={(e: any) => setS2a(e.target.value)} inputMode="numeric" disabled={busy || !selectedOppPair} placeholder="Set2 you" />
                        <Input value={s2b} onChange={(e: any) => setS2b(e.target.value)} inputMode="numeric" disabled={busy || !selectedOppPair} placeholder="Set2 opp" />
                      </div>

                      {(s1err || s2err) ? (
                        <div style={{ fontSize: 12, fontWeight: 900, color: colors.danger }}>{s1err || s2err}</div>
                      ) : null}

                      {needThird && (
                        <>
                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                            <Input value={s3a} onChange={(e: any) => setS3a(e.target.value)} inputMode="numeric" disabled={busy || !selectedOppPair} placeholder="Set3 you" />
                            <Input value={s3b} onChange={(e: any) => setS3b(e.target.value)} inputMode="numeric" disabled={busy || !selectedOppPair} placeholder="Set3 opp" />
                          </div>
                          {s3err ? <div style={{ fontSize: 12, fontWeight: 900, color: colors.danger }}>{s3err}</div> : null}
                        </>
                      )}

                      <Button onClick={reportMatch} disabled={!canSave}>
                        Save result
                      </Button>
                    </div>
                  </div>
                </Card>

                {/* Matches list */}
                {matches.map((m) => {
                  const p1a = m.pair1Obj?.player1Obj?.name || "—";
                  const p1b = m.pair1Obj?.player2Obj?.name || "—";
                  const p2a = m.pair2Obj?.player1Obj?.name || "—";
                  const p2b = m.pair2Obj?.player2Obj?.name || "—";

                  const meId = mePlayer?.id || "";
                  const isOpponent = (m.opponentPlayerIds || []).includes(meId);
                  const pending = m.status === "PENDING_CONFIRMATION";
                  const canAct = pending && isOpponent;

                  const dateStr = typeof m.date === "string" ? m.date : m.date?.toString?.() || "";

                  return (
                    <Card key={m.id}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline" }}>
                        <div style={{ fontWeight: 1000 }}>
                          {dateStr} {m.time ? `· ${m.time}` : ""}
                        </div>
                        <div
                          style={{
                            fontSize: 12,
                            fontWeight: 900,
                            color: m.status === "CONFIRMED" ? colors.green : colors.muted,
                          }}
                        >
                          {m.status}
                        </div>
                      </div>

                      <div style={{ marginTop: 8, fontSize: 13 }}>
                        <b>{p1a}</b> + <b>{p1b}</b> vs <b>{p2a}</b> + <b>{p2b}</b>
                      </div>
                      <div style={{ marginTop: 6, fontSize: 12, color: colors.muted }}>{m.score || "—"}</div>

                      {canAct ? (
                        <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
                          <Button onClick={() => confirmMatch(m.id)} disabled={busy}>
                            Confirm
                          </Button>

                          <details style={{ borderRadius: 14, border: `1px dashed ${colors.border}`, padding: 12 }}>
                            <summary style={{ cursor: "pointer", fontWeight: 900, color: colors.muted }}>Problem?</summary>
                            <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
                              <Input value={reason} onChange={(e: any) => setReason(e.target.value)} placeholder="Reason (optional)" disabled={busy} />
                              <Button variant="secondary" onClick={() => disputeMatch(m.id)} disabled={busy}>
                                Dispute
                              </Button>
                              <Button variant="danger" onClick={() => rejectMatch(m.id)} disabled={busy}>
                                Reject
                              </Button>
                            </div>
                          </details>
                        </div>
                      ) : null}

                      {m.disputeReason ? (
                        <div style={{ marginTop: 8, fontSize: 12, fontWeight: 900, color: colors.danger }}>
                          {m.disputeReason}
                        </div>
                      ) : null}
                    </Card>
                  );
                })}
              </div>
            )}

            {/* Pairs */}
            {tab === "pairs" && (
              <div style={{ marginTop: 14, display: "grid", gap: 12 }}>
                <Card>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
                    <div style={{ fontWeight: 1000, color: colors.navy }}>Create pair</div>
                    {!createFlow ? (
                      <button
                        onClick={startCreateAnyPair}
                        disabled={busy}
                        style={{
                          border: "none",
                          background: "transparent",
                          fontWeight: 1000,
                          color: colors.green,
                          cursor: busy ? "not-allowed" : "pointer",
                        }}
                      >
                        Open
                      </button>
                    ) : (
                      <button
                        onClick={() => { setCreateFlow(null); setCreateA(""); setCreateB(""); setStatus("OK"); }}
                        disabled={busy}
                        style={{
                          border: "none",
                          background: "transparent",
                          fontWeight: 1000,
                          color: colors.muted,
                          cursor: busy ? "not-allowed" : "pointer",
                        }}
                      >
                        Close
                      </button>
                    )}
                  </div>

                  {createFlow ? (
                    <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
                      {createFlow.lockPlayerAId ? (
                        <Select value={createAEffective} disabled>
                          <option value={createAEffective}>
                            {players.find((p) => p.id === createAEffective)?.name || "You"}
                          </option>
                        </Select>
                      ) : (
                        <Select
                          value={createA}
                          onChange={(e: any) => { setCreateA(e.target.value); if (createB === e.target.value) setCreateB(""); }}
                          disabled={busy}
                        >
                          {playerOptionsFor(createExcluded)}
                        </Select>
                      )}

                      <Select value={createB} onChange={(e: any) => setCreateB(e.target.value)} disabled={busy}>
                        {playerOptionsFor(createExcluded, createAEffective || undefined)}
                      </Select>

                      <Button onClick={createPairSubmit} disabled={busy || !createAEffective || !createB || createAEffective === createB}>
                        Create
                      </Button>

                      {createFlow.target !== "any" ? (
                        <div style={{ fontSize: 12, color: colors.muted }}>
                          After creation you will return to <b>{createFlow.returnTab}</b>.
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <div style={{ marginTop: 8, fontSize: 12, color: colors.muted }}>
                      Create pairs here. Reporting matches uses pairs only.
                    </div>
                  )}
                </Card>

                {pairs.map((p, idx) => (
                  <Card key={p.id}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline" }}>
                      <div style={{ fontWeight: 1000 }}>
                        #{idx + 1} {pairLabel(p)}
                      </div>
                      <div style={{ fontWeight: 1000, color: colors.navy }}>{p.rating}</div>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* Bottom menu + refresh icon */}
      {screen === "app" && (
        <div
          style={{
            position: "fixed",
            left: 0,
            right: 0,
            bottom: 0,
            padding: 12,
            background: "rgba(246,249,252,0.92)",
            backdropFilter: "blur(10px)",
            borderTop: `1px solid ${colors.border}`,
          }}
        >
          <div style={{ maxWidth: 960, margin: "0 auto", display: "flex", gap: 10 }}>
            <button
              onClick={() => setTab("league")}
              disabled={busy}
              style={{
                flex: 1,
                height: 52,
                borderRadius: 14,
                border: `1px solid ${colors.border}`,
                background: tab === "league" ? colors.navy : "white",
                color: tab === "league" ? "white" : colors.text,
                fontWeight: 900,
                cursor: busy ? "not-allowed" : "pointer",
              }}
            >
              League
            </button>

            <button
              onClick={() => setTab("matches")}
              disabled={busy}
              style={{
                flex: 1,
                height: 52,
                borderRadius: 14,
                border: `1px solid ${colors.border}`,
                background: tab === "matches" ? colors.navy : "white",
                color: tab === "matches" ? "white" : colors.text,
                fontWeight: 900,
                cursor: busy ? "not-allowed" : "pointer",
              }}
            >
              Matches
            </button>

            <button
              onClick={() => setTab("pairs")}
              disabled={busy}
              style={{
                flex: 1,
                height: 52,
                borderRadius: 14,
                border: `1px solid ${colors.border}`,
                background: tab === "pairs" ? colors.navy : "white",
                color: tab === "pairs" ? "white" : colors.text,
                fontWeight: 900,
                cursor: busy ? "not-allowed" : "pointer",
              }}
            >
              Pairs
            </button>

            <IconButton onClick={refreshAll} disabled={busy} title="Refresh">
              <RefreshIcon spinning={busy} />
            </IconButton>
          </div>
        </div>
      )}
    </div>
  );
}
