import { useEffect, useMemo, useState } from "react";

type TgUser = {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
};

type Player = {
  id: string;
  name: string;
  telegramId: number | null;
  telegramUsername: string;
  rating: number;
  gamesPlayed: number;
  wins: number;
  losses: number;
  lastUpdated: string | null;
};

type ApiOkMe = { ok: true; user: TgUser; joined: boolean; player: Player | null };
type ApiOkJoin = { ok: true; player: Player | null; action?: string };
type ApiOkPlayers = { ok: true; players: Player[] };
type ApiOkDebug = { ok: true; message: string; sampleCount: number };
type ApiFail = { ok: false; error: string; details?: any };

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
    const text = await res.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      json = { ok: false, error: "Non-JSON response from server", raw: text };
    }
    return json;
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

  async function debugAirtable() {
    setBusy(true);
    setStatus("Debug: checking Airtable…");
    try {
      const json = await apiPost<ApiOkDebug>("/api/debug/airtable");
      setRaw(json);
      if ((json as any).ok) {
        setStatus(`Airtable OK (sampleCount=${(json as any).sampleCount})`);
      } else {
        setStatus(`Airtable error: ${(json as any).error}`);
        setScreen("error");
      }
    } catch (e: any) {
      setStatus(`Debug failed: ${String(e?.message || e)}`);
      setScreen("error");
    } finally {
      setBusy(false);
    }
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
      setStatus("Open this inside Telegram (Mini App). Normal browsers won’t have Telegram initData.");
      setScreen("error");
      return;
    }

    tg.ready();
    tg.expand?.();

    if (!tg.initData) {
      setStatus("initData is empty. Open via the bot’s Web App button (menu button), not as a normal link.");
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
        setStatus(`Join failed: ${(json as any).error}`);
        setScreen("error");
        return;
      }

      setStatus(`Joined (${(json as any).action || "ok"}). Loading players…`);
      await loadPlayers();
    } catch (e: any) {
      // AbortError from timeout ends up here sometimes depending on browser/WebView
      setStatus(`Join request failed (timeout/network): ${String(e?.message || e)}`);
      setScreen("error");
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
        <div>
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

          <div style={{ marginTop: 10 }}>
            <button
              disabled={busy}
              onClick={debugAirtable}
              style={{
                padding: "8px 10px",
                borderRadius: 10,
                border: "1px solid #ccc",
                background: "white",
                cursor: busy ? "not-allowed" : "pointer"
              }}
            >
              Debug Airtable
            </button>
          </div>
        </div>
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

          {players.length === 0 ? (
            <p style={{ marginTop: 0 }}>No players yet.</p>
          ) : (
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
          )}
        </div>
      )}

      {screen === "error" && (
        <div>
          <p style={{ color: "#b00020", fontWeight: 800 }}>Error</p>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
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
            <button
              disabled={busy}
              onClick={debugAirtable}
              style={{
                padding: "8px 10px",
                borderRadius: 10,
                border: "1px solid #ccc",
                background: "white",
                cursor: busy ? "not-allowed" : "pointer"
              }}
            >
              Debug Airtable
            </button>
          </div>
        </div>
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
