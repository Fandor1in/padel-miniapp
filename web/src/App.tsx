import { useEffect, useState } from "react";

type AuthOk = {
  ok: true;
  user: {
    id: number;
    first_name?: string;
    last_name?: string;
    username?: string;
    language_code?: string;
  } | null;
  auth_date: number | null;
};

type AuthFail = { ok: false; error: string };

export default function App() {
  const [status, setStatus] = useState<string>("Loading…");
  const [data, setData] = useState<AuthOk | AuthFail | null>(null);

  useEffect(() => {
    const tg = (window as any).Telegram?.WebApp;

    if (!tg) {
      setStatus("Это нужно открывать внутри Telegram как Mini App, а не в обычном браузере.");
      return;
    }

    // Telegram Mini Apps: prepare the app
    tg.ready();
    tg.expand?.();

    if (!tg.initData) {
      setStatus(
        "initData пустая. Обычно это значит, что открыто не как WebApp-кнопкой или ты нажал refresh сверху."
      );
      return;
    }

    (async () => {
      try {
        setStatus("Authorizing…");
        const res = await fetch("/api/auth/telegram", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ initData: tg.initData })
        });
        const json = (await res.json()) as AuthOk | AuthFail;
        setData(json);

        if (json.ok) {
          const u = json.user;
          const name =
            [u?.first_name, u?.last_name].filter(Boolean).join(" ") ||
            (u?.username ? `@${u.username}` : "Unknown user");
          setStatus(`OK. Hello, ${name}`);
        } else {
          setStatus(`Error: ${json.error}`);
        }
      } catch (e: any) {
        setStatus(`Network error: ${String(e?.message || e)}`);
      }
    })();
  }, []);

  return (
    <div style={{ fontFamily: "system-ui, sans-serif", padding: 16, lineHeight: 1.4 }}>
      <h2 style={{ margin: "0 0 12px" }}>Padel League Mini App</h2>
      <p style={{ margin: "0 0 12px" }}>{status}</p>
      <pre style={{ background: "#f6f6f6", padding: 12, borderRadius: 8, overflowX: "auto" }}>
        {JSON.stringify(data, null, 2)}
      </pre>
    </div>
  );
}
