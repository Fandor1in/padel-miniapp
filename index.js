import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { isValid, parse } from '@tma.js/init-data-node';

const app = express();
app.use(express.json());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function getBotToken() {
  return process.env.BOT_TOKEN;
}

// ---- API ----

app.get('/api/health', (req, res) => {
  res.json({ ok: true });
});

app.post('/api/auth/telegram', (req, res) => {
  const { initData } = req.body || {};
  const botToken = getBotToken();

  if (!botToken)
    return res.status(500).json({ ok: false, error: 'BOT_TOKEN is not set' });
  if (!initData)
    return res.status(400).json({ ok: false, error: 'initData is required' });

  // Telegram initData must be validated server-side (auth factor) :contentReference[oaicite:3]{index=3}
  const valid = isValid(initData, botToken); // returns boolean :contentReference[oaicite:4]{index=4}
  if (!valid)
    return res.status(401).json({ ok: false, error: 'Invalid initData' });

  const data = parse(initData);
  return res.json({
    ok: true,
    user: data.user ?? null,
    auth_date: data.auth_date ?? null,
  });
});

// ---- Frontend serving ----
// In production (DigitalOcean) we serve built React app from /web/dist
const distPath = path.join(__dirname, 'web', 'dist');
app.use(express.static(distPath));

app.get('*', (req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});

const port = process.env.PORT || 8080;
app.listen(port, '0.0.0.0', () => console.log(`Server listening on ${port}`));
