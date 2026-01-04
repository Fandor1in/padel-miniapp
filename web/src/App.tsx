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

type ApiOkMe = { ok: true; user: TgUser; joined: boolean; player: Player | null };
type ApiOkJoin = { ok: true; player: Player | null; action?: string };
type ApiOkPlayers = { ok: true; players: Player[] };
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

    // Not JSON: return raw body for debugging
    return { ok: false, error: "Non-JSON response from server", status: res.status, raw: text };
  } finally {
    clearTimeout(t);
  }
}

export default function App() {
  const tg = useMemo(() => getTg(), []);
  const [screen, setScreen] = useState<"loading" | "join" | "league" | "error">("loading");
  const [status, setStatus] = useState("Loading…");
  const [user, setUser] = useState<TgUser | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [raw, setRaw] = useState<any>(null);
  const [busy, setBusy] = useState(false);

  async function apiPost<T>(path: string): Promise<T | ApiFail> {
    const initData = tg?.initData;
    return (await fetchJsonWithTimeout(
      path,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ initData })
      },
      15000
    )) as any;
  }

  async function loadPlayers() {
    setBusy(true);
    setStatus("Loading players…");
    try {
      const json = await apiPost<ApiOkPlayers>("/api/players");
      setRaw(json);

      if ((json as any).ok) {
        setPlayers((json as any).players || []);
        setStatus("OK");
        setScreen("league");
      } else {
        setStatus(`Error: ${(json as any).error}`);
        setScreen("error");
      }
    } finally {
      setBusy(false);
    }
  }

  async function checkMe() {
    if (!tg) {
      setStatus("Open this inside Telegram (Mini App).");
      setScreen("error");
      return;
    }

    tg.ready();
    tg.expand?.();

    if (!tg.initData) {
      setStatus("initData is empty. Open via the bot's Web App (menu button).");
      setScreen("error");
      return;
    }

    setBusy(true);
    setStatus("Checking membership…");
    try {
      const json = await apiPost<ApiOkMe>("/api/me");
      setRaw(json);

      if (!(json as any).ok) {
        setStatus(`Error: ${(json as any).error}`);
        setScreen("error");
        return;
      }

      const me = json as ApiOkMe;
      setUser(me.user);

      if (me.joined) {
        await loadPlayers();
      } else {
        setStatus("Not joined yet");
        setScreen("join");
      }
    } finally {
      setBusy(false);
    }
  }

  async function joinLeague() {
    setBusy(true);
    setStatus("Joining league…");
    try {
      const json = await apiPost<ApiOkJoin>("/api/join");
      setRaw(json);

      if (!(json as any).ok) {
        const j = json as any;
        const extra = j.raw ? `\n\nRAW:\n${String(j.raw).slice(0, 800)}` : "";
        setStatus(`Join failed: ${j.error}${extra}`);
        setScreen("error");
        return;
      }

      setStatus(`Joined (${(json as any).action || "ok"}). Loading players…`);
      await loadPlayers();
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    checkMe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div style={{ fontFamily: "system-ui, sans-serif", padding: 16, lineHeight: 1.4, maxWidth: 820 }}>
      <h2 style={{ margin: "0 0 8px" }}>Padel League</h2>
      <div style={{ marginBottom: 12, opacity: 0.85 }}>{user ? `You: ${meName(user)}` : " "}</div>

      <p style={{ marginTop: 0 }}>{status}</p>

      {screen === "join" && (
        <button
          disabled={busy}
          onClick={joinLeague}
          style={{
            padding: "12px 14px",
            borderRadius: 10,
            border: "1px solid #ccc",
            background: "white",
            fontWeight: 700,
            cursor: busy ? "not-allowed" : "pointer"
          }}
        >
          Join Padel League
        </button>
      )}

      {screen === "league" && (
        <div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <h3 style={{ margin: "8px 0 10px" }}>Players (Individual Rating)</h3>
            <button
              disabled={busy}
              onClick={loadPlayers}
              style={{
                padding: "8px 10px",
                borderRadius: 10,
                border: "1px solid #ccc",
                background: "white",
                cursor: busy ? "not-allowed" : "pointer"
              }}
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
                  <div style={{ fontWeight: 800 }}>
                    {p.name || "Unnamed"}
                    {p.telegramUsername ? (
                      <span style={{ fontWeight: 600, opacity: 0.75 }}> @{p.telegramUsername}</span>
                    ) : null}
                  </div>
                  <div style={{ fontSize: 12, opacity: 0.7 }}>
                    GP {p.gamesPlayed} | W {p.wins} | L {p.losses}
                  </div>
                </div>
                <div style={{ fontWeight: 900, fontVariantNumeric: "tabular-nums", textAlign: "right" }}>
                  {p.rating}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {screen === "error" && (
        <button
          disabled={busy}
          onClick={checkMe}
          style={{
            padding: "8px 10px",
            borderRadius: 10,
            border: "1px solid #ccc",
            background: "white",
            cursor: busy ? "not-allowed" : "pointer"
          }}
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
