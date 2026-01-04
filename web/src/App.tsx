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
type ApiOkJoin = { ok: true; player: Player | null };
type ApiOkPlayers = { ok: true; players: Player[] };
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

export default function App() {
  const tg = useMemo(() => getTg(), []);
  const [screen, setScreen] = useState<"loading" | "join" | "league" | "error">("loading");
  const [status, setStatus] = useState("Loading…");
  const [user, setUser] = useState<TgUser | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [raw, setRaw] = useState<any>(null);

  async function apiPost<T>(path: string): Promise<T | ApiFail> {
    const initData = tg?.initData;
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ initData })
    });
    return (await res.json()) as any;
  }

  async function loadPlayers() {
    setStatus("Loading players…");
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
      setStatus("initData пустая. Открывай Mini App через кнопку меню бота (Web App).");
      setScreen("error");
      return;
    }

    setStatus("Checking membership…");
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
  }

  async function joinLeague() {
    setStatus("Joining league…");
    const json = await apiPost<ApiOkJoin>("/api/join");
    setRaw(json);

    if (!(json as any).ok) {
      setStatus(`Error: ${(json as any).error}`);
      setScreen("error");
      return;
    }

    await loadPlayers();
  }

  useEffect(() => {
    checkMe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div style={{ fontFamily: "system-ui, sans-serif", padding: 16, lineHeight: 1.4, maxWidth: 820 }}>
      <h2 style={{ margin: "0 0 8px" }}>Padel League</h2>
      <div style={{ marginBottom: 12, opacity: 0.85 }}>{user ? `You: ${meName(user)}` : " "}</div>

      {screen === "loading" && <p style={{ margin: 0 }}>{status}</p>}

      {screen === "join" && (
        <div>
          <p style={{ marginTop: 0 }}>Ты ещё не в лиге. Нажми кнопку, чтобы добавить себя в Airtable.</p>
          <button
            onClick={joinLeague}
            style={{
              padding: "12px 14px",
              borderRadius: 10,
              border: "1px solid #ccc",
              background: "white",
              fontWeight: 700,
              cursor: "pointer"
            }}
          >
            Join Padel League
          </button>
          <p style={{ margin: "12px 0 0", opacity: 0.8 }}>{status}</p>
        </div>
      )}

      {screen === "league" && (
        <div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <h3 style={{ margin: "0 0 10px" }}>Players (Individual Rating)</h3>
            <button
              onClick={loadPlayers}
              style={{
                padding: "8px 10px",
                borderRadius: 10,
                border: "1px solid #ccc",
                background: "white",
                cursor: "pointer"
              }}
            >
              Refresh
            </button>
          </div>

          {players.length === 0 ? (
            <p style={{ marginTop: 0 }}>Пока нет игроков.</p>
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

          <p style={{ margin: "12px 0 0", opacity: 0.8 }}>{status}</p>
        </div>
      )}

      {screen === "error" && (
        <div>
          <p style={{ marginTop: 0, color: "#b00020", fontWeight: 800 }}>Ошибка</p>
          <pre style={{ background: "#f6f6f6", padding: 12, borderRadius: 8, overflowX: "auto" }}>
            {status}
          </pre>
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
