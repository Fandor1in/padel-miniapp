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
  confirmedBy: string[];
  score: string;
  disputeReason: string;

  pair1Obj?: Pair | null;
  pair2Obj?: Pair | null;
  setScores?: SetScore[];

  opponentPlayerIds?: string[];
};

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
  return w1 !== w2; // 1-1
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
  const [raw, setRaw] = useState<any>(null);

  // UI state
  const [matchFilterPlayerId, setMatchFilterPlayerId] = useState<string>("");

  // Create pair (generic tab)
  const [pairP1, setPairP1] = useState<string>("");
  const [pairP2, setPairP2] = useState<string>("");

  // Report match flow (by pairs)
  const [myPairId, setMyPairId] = useState<string>("");
  const [oppPairId, setOppPairId] = useState<string>("");

  // Create my pair
  const [myPartnerId, setMyPartnerId] = useState<string>("");

  // Create opponent pair
  const [oppCreateP1, setOppCreateP1] = useState<string>("");
  const [oppCreateP2, setOppCreateP2] = useState<string>("");

  // Sets
  const [s1a, setS1a] = useState<string>("6");
  const [s1b, setS1b] = useState<string>("4");
  const [s2a, setS2a] = useState<string>("4");
  const [s2b, setS2b] = useState<string>("6");
  const [s3a, setS3a] = useState<string>("7");
  const [s3b, setS3b] = useState<string>("5");

  // Dispute/reject reason
  const [disputeReason, setDisputeReason] = useState<string>("");

  async function apiPost(path: string, body: any = {}) {
    const initData = tg?.initData;
    return await fetchJsonWithTimeout(
      path,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, initData })
      },
      25000
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
      setMatchFilterPlayerId(json.player?.id || "");
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
      setMatchFilterPlayerId(json.player?.id || "");
      setScreen("app");
      await refreshAll();
    } finally {
      setBusy(false);
    }
  }

  async function createPairGeneric() {
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

  async function createMyPair() {
    if (!mePlayer?.id) return;
    if (!myPartnerId) {
      setStatus("Choose your partner.");
      return;
    }
    if (myPartnerId === mePlayer.id) {
      setStatus("Partner cannot be yourself.");
      return;
    }
    setBusy(true);
    setStatus("Creating your pair…");
    try {
      const json = await apiPost("/api/pairs/create", { player1Id: mePlayer.id, player2Id: myPartnerId });
      setRaw(json);
      if (!json.ok) {
        setStatus(`Create pair failed: ${json.error}`);
        setScreen("error");
        return;
      }
      await loadPairs();
      setMyPairId(json.pair?.id || "");
      setStatus("Your pair selected.");
    } finally {
      setBusy(false);
    }
  }

  async function createOpponentPair(myPair: Pair | null) {
    const myPl = pairPlayers(myPair);
    if (!oppCreateP1 || !oppCreateP2) {
      setStatus("Choose two opponent players.");
      return;
    }
    if (oppCreateP1 === oppCreateP2) {
      setStatus("Opponent pair cannot have the same player twice.");
      return;
    }
    if (myPl.includes(oppCreateP1) || myPl.includes(oppCreateP2)) {
      setStatus("Opponent pair cannot include a player from your pair.");
      return;
    }

    setBusy(true);
    setStatus("Creating opponent pair…");
    try {
      const json = await apiPost("/api/pairs/create", { player1Id: oppCreateP1, player2Id: oppCreateP2 });
      setRaw(json);
      if (!json.ok) {
        setStatus(`Create opponent pair failed: ${json.error}`);
        setScreen("error");
        return;
      }
      await loadPairs();
      setOppPairId(json.pair?.id || "");
      setStatus("Opponent pair selected.");
    } finally {
      setBusy(false);
    }
  }

  async function reportMatch() {
    const myPair = pairs.find((p) => p.id === myPairId) || null;
    const oppPair = pairs.find((p) => p.id === oppPairId) || null;

    if (!myPair || !oppPair) {
      setStatus("Select both pairs.");
      return;
    }

    const sets = [
      { p1: Number(s1a), p2: Number(s1b) },
      { p1: Number(s2a), p2: Number(s2b) }
    ];

    const needThird = setsSplitAfter2(Number(s1a), Number(s1b), Number(s2a), Number(s2b));
    if (needThird) sets.push({ p1: Number(s3a), p2: Number(s3b) });

    setBusy(true);
    setStatus("Saving match (pending confirmation)…");
    try {
      const json = await apiPost("/api/matches/report", {
        myPairId,
        oppPairId,
        sets
      });
      setRaw(json);

      if (!json.ok) {
        setStatus(`Report failed: ${json.error}`);
        setScreen("error");
        return;
      }

      setStatus("Match created. Waiting for BOTH opponents to confirm.");
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
      setRaw(json);
      if (!json.ok) {
        setStatus(`Confirm failed: ${json.error}`);
        setScreen("error");
        return;
      }
      setStatus(json.message || "OK");
      await refreshAll();
      setTab("matches");
    } finally {
      setBusy(false);
    }
  }

  async function disputeMatch(matchId: string) {
    setBusy(true);
    setStatus("Marking as disputed…");
    try {
      const json = await apiPost("/api/matches/dispute", { matchId, reason: disputeReason });
      setRaw(json);
      if (!json.ok) {
        setStatus(`Dispute failed: ${json.error}`);
        setScreen("error");
        return;
      }
      setStatus(json.message || "OK");
      setDisputeReason("");
      await refreshAll();
      setTab("matches");
    } finally {
      setBusy(false);
    }
  }

  async function rejectMatch(matchId: string) {
    setBusy(true);
    setStatus("Rejecting…");
    try {
      const json = await apiPost("/api/matches/reject", { matchId, reason: disputeReason });
      setRaw(json);
      if (!json.ok) {
        setStatus(`Reject failed: ${json.error}`);
        setScreen("error");
        return;
      }
      setStatus(json.message || "OK");
      setDisputeReason("");
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

  // ---------- Derived data ----------
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

  // sets validation
  const s1err = validateSet(s1a, s1b, 1);
  const s2err = validateSet(s2a, s2b, 2);
  const needThird = setsSplitAfter2(Number(s1a), Number(s1b), Number(s2a), Number(s2b));
  const s3err = needThird ? validateSet(s3a, s3b, 3) : null;

  const pairsErr =
    selectedMyPair && selectedOppPair && intersects(myPairPlayers, oppPairPlayers)
      ? "Same player cannot appear in both pairs."
      : null;

  const canSave =
    !busy &&
    !!selectedMyPair &&
    !!selectedOppPair &&
    !pairsErr &&
    !s1err &&
    !s2err &&
    (!needThird || !s3err);

  // Matches filter for display
  const filteredMatches = matches.filter((m) => {
    const pid = matchFilterPlayerId;
    if (!pid) return true;
    const p1a = m.pair1Obj?.player1;
    const p1b = m.pair1Obj?.player2;
    const p2a = m.pair2Obj?.player1;
    const p2b = m.pair2Obj?.player2;
    return [p1a, p1b, p2a, p2b].includes(pid);
  });

  // ---------- Styling ----------
  const colors = {
    navy: "#0B1F3B",
    green: "#18C37E",
    bg: "#F7FAFC",
    card: "#FFFFFF",
    border: "rgba(11,31,59,0.12)",
    text: "#0B1F3B",
    muted: "rgba(11,31,59,0.65)"
  };

  const Button = ({
    children,
    onClick,
    disabled,
    variant = "primary"
  }: {
    children: any;
    onClick: () => void;
    disabled?: boolean;
    variant?: "primary" | "secondary" | "danger";
  }) => {
    const base: any = {
      height: 48, // >=44px touch target 
      padding: "0 14px",
      borderRadius: 12,
      border: `1px solid ${colors.border}`,
      fontWeight: 900,
      cursor: disabled ? "not-allowed" : "pointer",
      opacity: disabled ? 0.55 : 1
    };

    const variants: any = {
      primary: { background: colors.green, color: "white", border: "1px solid rgba(0,0,0,0)" },
      secondary: { background: "white", color: colors.text },
      danger: { background: "#fff5f5", color: "#7a0000" }
    };

    return (
      <button onClick={onClick} disabled={disabled} style={{ ...base, ...variants[variant] }}>
        {children}
      </button>
    );
  };

  const Card = ({ children }: { children: any }) => (
    <div
      style={{
        background: colors.card,
        border: `1px solid ${colors.border}`,
        borderRadius: 16,
        padding: 14,
        boxShadow: "0 4px 16px rgba(11,31,59,0.06)"
      }}
    >
      {children}
    </div>
  );

  const Label = ({ title, children }: { title: string; children: any }) => (
    <label style={{ display: "grid", gap: 6 }}>
      <div style={{ fontSize: 12, fontWeight: 900, color: colors.muted }}>{title}</div>
      {children}
    </label>
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
        color: colors.text
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
        color: colors.text
      }}
    />
  );

  const TabButton = ({ id, label }: { id: "league" | "matches" | "pairs"; label: string }) => {
    const active = tab === id;
    return (
      <button
        onClick={() => setTab(id)}
        disabled={busy}
        style={{
          flex: 1,
          height: 52,
          borderRadius: 14,
          border: `1px solid ${colors.border}`,
          background: active ? colors.navy : "white",
          color: active ? "white" : colors.text,
          fontWeight: 900,
          cursor: busy ? "not-allowed" : "pointer"
        }}
      >
        {label}
      </button>
    );
  };

  const pairLabel = (p: Pair) => {
    const a = p.player1Obj?.name || "—";
    const b = p.player2Obj?.name || "—";
    return `${a} + ${b}`;
  };

  // Auto-clear opponent selection if it becomes invalid after myPair change
  useEffect(() => {
    if (!selectedMyPair) return;
    if (!oppPairId) return;
    const ok = opponentPairsFiltered.some((p) => p.id === oppPairId);
    if (!ok) setOppPairId("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myPairId]);

  // ---------- Render ----------
  return (
    <div style={{ fontFamily: "system-ui, sans-serif", background: colors.bg, minHeight: "100vh", color: colors.text }}>
      <div style={{ padding: 16, paddingBottom: 92, maxWidth: 960, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 1000, color: colors.navy }}>Padel League</div>
            <div style={{ fontSize: 12, fontWeight: 800, color: colors.muted }}>
              {user ? `You: ${meName(user)}` : " "}
              {mePlayer ? ` · Rating: ${mePlayer.rating}` : ""}
            </div>
          </div>
          <div style={{ width: 10, height: 10, borderRadius: 999, background: busy ? "#FFC107" : colors.green }} />
        </div>

        <div style={{ marginTop: 10, fontSize: 13, color: colors.muted }}>{status}</div>

        {screen === "loading" && <div style={{ marginTop: 12 }}>Loading…</div>}

        {screen === "join" && (
          <div style={{ marginTop: 16 }}>
            <Card>
              <div style={{ fontWeight: 1000, fontSize: 16, marginBottom: 10, color: colors.navy }}>First time here?</div>
              <div style={{ color: colors.muted, fontSize: 13, marginBottom: 12 }}>
                Join to appear in the leaderboard and report matches.
              </div>
              <Button onClick={joinLeague} disabled={busy}>
                Join Padel League
              </Button>
            </Card>
          </div>
        )}

        {screen === "error" && (
          <div style={{ marginTop: 16 }}>
            <Card>
              <div style={{ fontWeight: 1000, marginBottom: 10 }}>Something broke (shocking).</div>
              <Button variant="secondary" onClick={checkMe} disabled={busy}>
                Retry
              </Button>
            </Card>
          </div>
        )}

        {screen === "app" && (
          <>
            {/* top tabs (simple & obvious) */}
            <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
              <TabButton id="league" label="League" />
              <TabButton id="matches" label="Matches" />
              <TabButton id="pairs" label="Pairs" />
            </div>

            {tab === "league" && (
              <div style={{ marginTop: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                  <div style={{ fontWeight: 1000, fontSize: 16, color: colors.navy }}>Players</div>
                  <Button variant="secondary" onClick={refreshAll} disabled={busy}>
                    Refresh
                  </Button>
                </div>

                <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
                  {players.map((p, idx) => (
                    <Card key={p.id}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
                        <div style={{ fontWeight: 1000 }}>
                          #{idx + 1} {p.name} {p.telegramUsername ? <span style={{ color: colors.muted }}>@{p.telegramUsername}</span> : null}
                        </div>
                        <div style={{ fontWeight: 1000, color: colors.navy }}>{p.rating}</div>
                      </div>
                      <div style={{ marginTop: 6, fontSize: 12, color: colors.muted }}>
                        GP {p.gamesPlayed} · W {p.wins} · L {p.losses}
                      </div>
                    </Card>
                  ))}
                </div>
              </div>
            )}

            {tab === "pairs" && (
              <div style={{ marginTop: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                  <div style={{ fontWeight: 1000, fontSize: 16, color: colors.navy }}>Pairs</div>
                  <Button variant="secondary" onClick={refreshAll} disabled={busy}>
                    Refresh
                  </Button>
                </div>

                <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
                  {pairs.map((p, idx) => (
                    <Card key={p.id}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                        <div style={{ fontWeight: 1000 }}>
                          #{idx + 1} {pairLabel(p)}
                        </div>
                        <div style={{ fontWeight: 1000, color: colors.navy }}>{p.rating}</div>
                      </div>
                      <div style={{ marginTop: 6, fontSize: 12, color: colors.muted }}>
                        GP {p.gamesPlayed} · W {p.wins} · L {p.losses}
                      </div>
                    </Card>
                  ))}
                </div>

                <div style={{ marginTop: 14 }}>
                  <Card>
                    <div style={{ fontWeight: 1000, marginBottom: 10, color: colors.navy }}>Create pair</div>
                    <div style={{ display: "grid", gap: 10 }}>
                      <Label title="Player 1">
                        <Select value={pairP1} onChange={(e: any) => setPairP1(e.target.value)} disabled={busy}>
                          {playerOptions}
                        </Select>
                      </Label>
                      <Label title="Player 2">
                        <Select value={pairP2} onChange={(e: any) => setPairP2(e.target.value)} disabled={busy}>
                          {playerOptions}
                        </Select>
                      </Label>
                      <Button onClick={createPairGeneric} disabled={busy}>
                        Create
                      </Button>
                    </div>
                  </Card>
                </div>
              </div>
            )}

            {tab === "matches" && (
              <div style={{ marginTop: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                  <div style={{ fontWeight: 1000, fontSize: 16, color: colors.navy }}>Matches</div>
                  <Button variant="secondary" onClick={refreshAll} disabled={busy}>
                    Refresh
                  </Button>
                </div>

                <div style={{ marginTop: 10 }}>
                  <Card>
                    <Label title="Show matches for player">
                      <Select value={matchFilterPlayerId} onChange={(e: any) => setMatchFilterPlayerId(e.target.value)} disabled={busy}>
                        <option value="">— all —</option>
                        {players.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </Select>
                    </Label>
                  </Card>
                </div>

                {/* Matches list */}
                <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
                  {filteredMatches.map((m) => {
                    const p1a = m.pair1Obj?.player1Obj?.name || "—";
                    const p1b = m.pair1Obj?.player2Obj?.name || "—";
                    const p2a = m.pair2Obj?.player1Obj?.name || "—";
                    const p2b = m.pair2Obj?.player2Obj?.name || "—";

                    const meId = mePlayer?.id || "";
                    const isOpponent = (m.opponentPlayerIds || []).includes(meId);
                    const alreadyConfirmed = (m.confirmedBy || []).includes(meId);
                    const pending = m.status === "PENDING_CONFIRMATION";
                    const canAct = pending && isOpponent;

                    const confirmedCount = (m.confirmedBy || []).filter((x) => (m.opponentPlayerIds || []).includes(x)).length;
                    const needCount = (m.opponentPlayerIds || []).length || 2;

                    const dateStr = typeof m.date === "string" ? m.date : m.date?.toString?.() || "";

                    return (
                      <Card key={m.id}>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline" }}>
                          <div style={{ fontWeight: 1000 }}>
                            {dateStr} {m.time ? `· ${m.time}` : ""}{" "}
                            <span style={{ color: m.status === "CONFIRMED" ? colors.green : colors.muted }}>· {m.status || "—"}</span>
                          </div>
                          {pending ? (
                            <div style={{ fontSize: 12, fontWeight: 900, color: colors.muted }}>
                              {confirmedCount}/{needCount}
                            </div>
                          ) : null}
                        </div>

                        <div style={{ marginTop: 8, fontSize: 13 }}>
                          <b>{p1a}</b> + <b>{p1b}</b> vs <b>{p2a}</b> + <b>{p2b}</b>
                        </div>

                        <div style={{ marginTop: 6, fontSize: 12, color: colors.muted }}>Score: {m.score || "—"}</div>
                        {m.disputeReason ? <div style={{ marginTop: 6, color: "#7a0000", fontSize: 12 }}>Reason: {m.disputeReason}</div> : null}

                        {canAct ? (
                          <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
                            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                              <Button onClick={() => confirmMatch(m.id)} disabled={busy || alreadyConfirmed}>
                                {alreadyConfirmed ? "Confirmed" : "Confirm"}
                              </Button>
                              <Button variant="danger" onClick={() => rejectMatch(m.id)} disabled={busy}>
                                Reject
                              </Button>
                            </div>
                            <Input
                              value={disputeReason}
                              onChange={(e: any) => setDisputeReason(e.target.value)}
                              placeholder="Dispute reason (optional)"
                              disabled={busy}
                            />
                            <Button variant="secondary" onClick={() => disputeMatch(m.id)} disabled={busy}>
                              Dispute
                            </Button>
                          </div>
                        ) : null}
                      </Card>
                    );
                  })}
                </div>

                {/* Report match */}
                <div style={{ marginTop: 14 }}>
                  <Card>
                    <div style={{ fontWeight: 1000, fontSize: 16, color: colors.navy }}>Report match (pending confirmation)</div>
                    <div style={{ marginTop: 6, fontSize: 12, color: colors.muted }}>
                      Step 1: select your pair · Step 2: select opponent pair · Step 3: enter sets
                    </div>

                    <div style={{ marginTop: 14, display: "grid", gap: 12 }}>
                      {/* Step 1 */}
                      <div style={{ display: "grid", gap: 8 }}>
                        <div style={{ fontWeight: 1000, color: colors.navy }}>1) Your pair</div>

                        {myPairs.length > 0 ? (
                          <Label title="Choose your existing pair">
                            <Select value={myPairId} onChange={(e: any) => setMyPairId(e.target.value)} disabled={busy}>
                              <option value="">— select —</option>
                              {myPairs.map((p) => (
                                <option key={p.id} value={p.id}>
                                  {pairLabel(p)} (#{p.rating})
                                </option>
                              ))}
                            </Select>
                          </Label>
                        ) : (
                          <div style={{ fontSize: 12, color: colors.muted }}>
                            You have no pairs yet. Create one below.
                          </div>
                        )}

                        <div style={{ display: "grid", gap: 10, padding: 12, borderRadius: 14, border: `1px dashed ${colors.border}`, background: "#ffffffaa" }}>
                          <div style={{ fontWeight: 900, color: colors.muted }}>Create your pair</div>
                          <Label title="Partner">
                            <Select value={myPartnerId} onChange={(e: any) => setMyPartnerId(e.target.value)} disabled={busy}>
                              {playerOptions}
                            </Select>
                          </Label>
                          <Button onClick={createMyPair} disabled={busy || !mePlayer?.id || !myPartnerId}>
                            Create & select
                          </Button>
                        </div>
                      </div>

                      {/* Step 2 */}
                      <div style={{ display: "grid", gap: 8, opacity: selectedMyPair ? 1 : 0.5 }}>
                        <div style={{ fontWeight: 1000, color: colors.navy }}>2) Opponent pair</div>

                        <Label title="Choose opponent pair (filtered: no shared players)">
                          <Select
                            value={oppPairId}
                            onChange={(e: any) => setOppPairId(e.target.value)}
                            disabled={busy || !selectedMyPair}
                          >
                            <option value="">— select —</option>
                            {opponentPairsFiltered.map((p) => (
                              <option key={p.id} value={p.id}>
                                {pairLabel(p)} (#{p.rating})
                              </option>
                            ))}
                          </Select>
                        </Label>

                        <div style={{ display: "grid", gap: 10, padding: 12, borderRadius: 14, border: `1px dashed ${colors.border}`, background: "#ffffffaa" }}>
                          <div style={{ fontWeight: 900, color: colors.muted }}>Create opponent pair</div>
                          <Label title="Opponent player 1">
                            <Select
                              value={oppCreateP1}
                              onChange={(e: any) => setOppCreateP1(e.target.value)}
                              disabled={busy || !selectedMyPair}
                            >
                              {playerOptions}
                            </Select>
                          </Label>
                          <Label title="Opponent player 2">
                            <Select
                              value={oppCreateP2}
                              onChange={(e: any) => setOppCreateP2(e.target.value)}
                              disabled={busy || !selectedMyPair}
                            >
                              {playerOptions}
                            </Select>
                          </Label>
                          <Button onClick={() => createOpponentPair(selectedMyPair)} disabled={busy || !selectedMyPair || !oppCreateP1 || !oppCreateP2}>
                            Create & select
                          </Button>
                        </div>

                        {pairsErr ? <div style={{ color: "#7a0000", fontSize: 12, fontWeight: 900 }}>{pairsErr}</div> : null}
                      </div>

                      {/* Step 3 */}
                      <div style={{ display: "grid", gap: 8, opacity: selectedMyPair && selectedOppPair ? 1 : 0.5 }}>
                        <div style={{ fontWeight: 1000, color: colors.navy }}>3) Set results</div>

                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                          <Label title="Set 1 (your pair)">
                            <Input value={s1a} onChange={(e: any) => setS1a(e.target.value)} inputMode="numeric" disabled={busy || !selectedOppPair} />
                          </Label>
                          <Label title="Set 1 (opponents)">
                            <Input value={s1b} onChange={(e: any) => setS1b(e.target.value)} inputMode="numeric" disabled={busy || !selectedOppPair} />
                          </Label>

                          <Label title="Set 2 (your pair)">
                            <Input value={s2a} onChange={(e: any) => setS2a(e.target.value)} inputMode="numeric" disabled={busy || !selectedOppPair} />
                          </Label>
                          <Label title="Set 2 (opponents)">
                            <Input value={s2b} onChange={(e: any) => setS2b(e.target.value)} inputMode="numeric" disabled={busy || !selectedOppPair} />
                          </Label>
                        </div>

                        {(s1err || s2err) && (
                          <div style={{ color: "#7a0000", fontSize: 12, fontWeight: 900 }}>
                            {s1err || s2err}
                          </div>
                        )}

                        {needThird && (
                          <>
                            <div style={{ fontSize: 12, color: colors.muted, fontWeight: 900 }}>
                              First two sets are 1-1 → 3rd set required.
                            </div>
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                              <Label title="Set 3 (your pair)">
                                <Input value={s3a} onChange={(e: any) => setS3a(e.target.value)} inputMode="numeric" disabled={busy || !selectedOppPair} />
                              </Label>
                              <Label title="Set 3 (opponents)">
                                <Input value={s3b} onChange={(e: any) => setS3b(e.target.value)} inputMode="numeric" disabled={busy || !selectedOppPair} />
                              </Label>
                            </div>
                            {s3err ? (
                              <div style={{ color: "#7a0000", fontSize: 12, fontWeight: 900 }}>{s3err}</div>
                            ) : null}
                          </>
                        )}

                        <div style={{ marginTop: 6, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                          <Button onClick={reportMatch} disabled={!canSave}>
                            Save match
                          </Button>
                          <div style={{ fontSize: 12, color: colors.muted }}>
                            {canSave ? "Will be created as PENDING_CONFIRMATION." : "Fill pairs + valid sets to enable."}
                          </div>
                        </div>
                      </div>
                    </div>
                  </Card>
                </div>
              </div>
            )}

            <details style={{ marginTop: 14, opacity: 0.9 }}>
              <summary style={{ cursor: "pointer", fontWeight: 900, color: colors.muted }}>Debug</summary>
              <pre style={{ background: "#fff", padding: 12, borderRadius: 12, overflowX: "auto", border: `1px solid ${colors.border}` }}>
                {JSON.stringify(raw, null, 2)}
              </pre>
            </details>
          </>
        )}
      </div>

      {/* bottom bar (3 tabs, big targets)  */}
      {screen === "app" && (
        <div
          style={{
            position: "fixed",
            left: 0,
            right: 0,
            bottom: 0,
            padding: 12,
            background: "rgba(247,250,252,0.92)",
            backdropFilter: "blur(10px)",
            borderTop: `1px solid ${colors.border}`
          }}
        >
          <div style={{ maxWidth: 960, margin: "0 auto", display: "flex", gap: 10 }}>
            <TabButton id="league" label="League" />
            <TabButton id="matches" label="Matches" />
            <TabButton id="pairs" label="Pairs" />
          </div>
        </div>
      )}
    </div>
  );
}
