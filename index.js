import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { isValid, parse } from '@tma.js/init-data-node';

const app = express();
app.use(express.json());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.get('/api/health', (req, res) => {
  res.json({ ok: true });
});

app.post('/api/auth/telegram', (req, res) => {
  const { initData } = req.body || {};
  const botToken = process.env.BOT_TOKEN;

  if (!botToken)
    return res.status(500).json({ ok: false, error: 'BOT_TOKEN is not set' });
  if (!initData)
    return res.status(400).json({ ok: false, error: 'initData is required' });

  const valid = isValid(initData, botToken);
  if (!valid)
    return res.status(401).json({ ok: false, error: 'Invalid initData' });

  const data = parse(initData);
  return res.json({
    ok: true,
    user: data.user ?? null,
    auth_date: data.auth_date ?? null,
  });
});

// ---- Frontend (React build) ----
const distPath = path.join(__dirname, 'web', 'dist');
app.use(express.static(distPath));

// Express v5: нельзя app.get("*") / app.get("/*") без имени.
// Делаем именованный "catch-all": "/*splat". :contentReference[oaicite:1]{index=1}
app.get('/*splat', (req, res) => {
  // Если кто-то лезет в несуществующий /api, не отдаём index.html
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ ok: false, error: 'Not found' });
  }
  return res.sendFile(path.join(distPath, 'index.html'));
});

const port = process.env.PORT || 8080;
// App Platform ожидает слушать на всех интерфейсах и на нужном порту. :contentReference[oaicite:2]{index=2}
app.listen(port, '0.0.0.0', () => console.log(`Server listening on ${port}`));
