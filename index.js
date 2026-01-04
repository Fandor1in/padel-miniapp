import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { isValid, parse } from '@tma.js/init-data-node';

const app = express();
app.use(express.json());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 1) раздаём статическую страницу
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 2) endpoint проверки Telegram initData
app.post('/api/auth/telegram', (req, res) => {
  const { initData } = req.body || {};
  const botToken = process.env.BOT_TOKEN;

  if (!botToken)
    return res.status(500).json({ ok: false, error: 'BOT_TOKEN is not set' });
  if (!initData)
    return res.status(400).json({ ok: false, error: 'initData is required' });

  const valid = isValid(initData, botToken); // проверка подписи :contentReference[oaicite:3]{index=3}
  if (!valid)
    return res.status(401).json({ ok: false, error: 'Invalid initData' });

  const data = parse(initData);
  return res.json({ ok: true, user: data.user || null });
});

const port = process.env.PORT || 8080;
app.listen(port, () => console.log('Server listening on', port));
