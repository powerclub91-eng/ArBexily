const express = require('express');
const http = require('http');
const https = require('https');
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const cookieParser = require('cookie-parser');
const path = require('path');
const db = require('./database');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const JWT_SECRET = 'arbexily-super-secret-2024';
const ADMIN_USERNAME = 'admin';
const PORT = process.env.PORT || 3000;

// geo cache so we don't spam the free API
const geoCache = new Map();

app.use(express.json());
app.use(cookieParser());
// trust proxy so req.ip works behind nginx/etc
app.set('trust proxy', true);
app.use(express.static(path.join(__dirname, 'public')));

// ─── Geo & Session Tracking ───────────────────────────────────────────────────
function getClientIp(req) {
  return (
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.headers['x-real-ip'] ||
    req.socket?.remoteAddress ||
    req.ip ||
    'unknown'
  );
}

function parseDevice(ua = '') {
  if (!ua) return 'Невідомий';
  if (/Mobile|Android|iPhone|iPad/.test(ua)) {
    if (/iPhone/.test(ua)) return 'iPhone';
    if (/iPad/.test(ua)) return 'iPad';
    if (/Android/.test(ua)) return 'Android';
    return 'Мобільний';
  }
  if (/Windows/.test(ua)) return 'Windows';
  if (/Macintosh|Mac OS/.test(ua)) return 'Mac';
  if (/Linux/.test(ua)) return 'Linux';
  return 'ПК';
}

function parseBrowser(ua = '') {
  if (/Edg\//.test(ua)) return 'Edge';
  if (/OPR\/|Opera/.test(ua)) return 'Opera';
  if (/Firefox\//.test(ua)) return 'Firefox';
  if (/Chrome\//.test(ua)) return 'Chrome';
  if (/Safari\//.test(ua)) return 'Safari';
  return 'Браузер';
}

async function fetchGeo(ip) {
  if (geoCache.has(ip)) return geoCache.get(ip);
  // skip private/loopback IPs
  if (/^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1|localhost)/.test(ip)) {
    const local = { city: 'Localhost', region: '', country: 'LOCAL', org: '', latitude: null, longitude: null };
    geoCache.set(ip, local);
    return local;
  }
  return new Promise((resolve) => {
    const req = https.get(`https://ipapi.co/${ip}/json/`, { timeout: 4000 }, (res) => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try {
          const j = JSON.parse(data);
          const geo = {
            city: j.city || '',
            region: j.region || '',
            country: j.country_name || j.country || '',
            org: j.org || '',
            latitude: j.latitude || null,
            longitude: j.longitude || null,
          };
          geoCache.set(ip, geo);
          resolve(geo);
        } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

async function trackSession(userId, ip, userAgent) {
  const geo = await fetchGeo(ip);
  const existing = await db.getAsync(
    'SELECT id FROM user_sessions WHERE user_id = ? AND ip = ?',
    [userId, ip]
  );
  if (existing) {
    await db.runAsync(
      'UPDATE user_sessions SET last_seen = CURRENT_TIMESTAMP, user_agent = ? WHERE user_id = ? AND ip = ?',
      [userAgent, userId, ip]
    );
  } else {
    await db.runAsync(
      `INSERT INTO user_sessions (user_id, ip, user_agent, city, region, country, org, latitude, longitude)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [userId, ip, userAgent,
        geo?.city || '', geo?.region || '', geo?.country || '',
        geo?.org || '', geo?.latitude || null, geo?.longitude || null]
    );
  }
}

// ─── Auth Middleware ──────────────────────────────────────────────────────────
function authMiddleware(req, res, next) {
  const token = req.cookies.token || req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

// ─── Auth Routes ─────────────────────────────────────────────────────────────
app.post('/api/register', async (req, res) => {
  const { username, password, real_name, display_name } = req.body;
  if (!username || !password || !real_name || !display_name)
    return res.status(400).json({ error: "Всі поля обов'язкові" });

  const colors = ['#6c63ff','#ff6584','#43b89c','#f7b731','#fc5c65','#45aaf2','#26de81'];
  const avatar_color = colors[Math.floor(Math.random() * colors.length)];
  const hash = bcrypt.hashSync(password, 10);
  const role = username === ADMIN_USERNAME ? 'admin' : 'student';

  try {
    const result = await db.runAsync(
      'INSERT INTO users (username, password, real_name, display_name, role, avatar_color) VALUES (?, ?, ?, ?, ?, ?)',
      [username, hash, real_name.trim(), display_name.trim(), role, avatar_color]
    );
    const user = await db.getAsync('SELECT * FROM users WHERE id = ?', [result.lastID]);
    const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
    res.cookie('token', token, { httpOnly: true, maxAge: 7 * 24 * 60 * 60 * 1000 });
    trackSession(result.lastID, getClientIp(req), req.headers['user-agent'] || '').catch(() => {});
    res.json({ success: true, user: safeUser(user) });
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'Логін вже зайнятий' });
    console.error(e);
    res.status(500).json({ error: 'Помилка сервера' });
  }
});

// Admin: get all users with real names + session IPs
app.get('/api/admin/users-full', authMiddleware, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Доступ заборонено' });
  const users = await db.allAsync(
    'SELECT id, username, real_name, display_name, role, coins, avatar_color, created_at, last_seen FROM users ORDER BY created_at DESC'
  );
  const sessions = await db.allAsync(
    'SELECT * FROM user_sessions ORDER BY last_seen DESC'
  );
  const result = users.map(u => ({
    ...u,
    sessions: sessions.filter(s => s.user_id === u.id)
  }));
  res.json(result);
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  const user = await db.getAsync('SELECT * FROM users WHERE username = ?', [username]);
  if (!user || !bcrypt.compareSync(password, user.password))
    return res.status(401).json({ error: 'Невірний логін або пароль' });

  await db.runAsync('UPDATE users SET last_seen = CURRENT_TIMESTAMP WHERE id = ?', [user.id]);
  const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
  res.cookie('token', token, { httpOnly: true, maxAge: 7 * 24 * 60 * 60 * 1000 });
  trackSession(user.id, getClientIp(req), req.headers['user-agent'] || '').catch(() => {});
  res.json({ success: true, user: safeUser(user) });
});

app.post('/api/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ success: true });
});

app.get('/api/me', authMiddleware, async (req, res) => {
  const user = await db.getAsync('SELECT * FROM users WHERE id = ?', [req.user.id]);
  res.json(safeUser(user));
});

// ─── Users ────────────────────────────────────────────────────────────────────
app.get('/api/users', authMiddleware, async (req, res) => {
  const users = await db.allAsync(
    'SELECT id, display_name, username, role, coins, avatar_color, last_seen FROM users ORDER BY coins DESC'
  );
  res.json(users);
});

// ─── Messages ─────────────────────────────────────────────────────────────────
app.get('/api/messages', authMiddleware, async (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  const offset = parseInt(req.query.offset) || 0;
  const msgs = await db.allAsync(`
    SELECT m.id, m.content, m.type, m.created_at,
           u.id as user_id, u.display_name, u.username, u.avatar_color, u.role
    FROM messages m JOIN users u ON m.user_id = u.id
    ORDER BY m.created_at DESC LIMIT ? OFFSET ?
  `, [limit, offset]);
  res.json(msgs.reverse());
});

// ─── Coins & Math ─────────────────────────────────────────────────────────────
app.get('/api/coins/leaderboard', authMiddleware, async (req, res) => {
  const users = await db.allAsync(
    'SELECT id, display_name, username, coins, avatar_color FROM users ORDER BY coins DESC LIMIT 20'
  );
  res.json(users);
});

app.get('/api/coins/history', authMiddleware, async (req, res) => {
  const userId = req.user.role === 'admin' && req.query.user_id ? req.query.user_id : req.user.id;
  const history = await db.allAsync(
    'SELECT * FROM coin_transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT 50',
    [userId]
  );
  res.json(history);
});

app.post('/api/math/generate', authMiddleware, async (req, res) => {
  const difficulty = req.body.difficulty || 'medium';
  const { problem, answer, coins } = generateMathProblem(difficulty);
  const result = await db.runAsync(
    'INSERT INTO math_problems (user_id, problem, answer, earned_coins) VALUES (?, ?, ?, ?)',
    [req.user.id, problem, answer, coins]
  );
  res.json({ id: result.lastID, problem, difficulty, coins_reward: coins });
});

app.post('/api/math/solve', authMiddleware, async (req, res) => {
  const { problem_id, answer } = req.body;
  const problem = await db.getAsync(
    'SELECT * FROM math_problems WHERE id = ? AND user_id = ?',
    [problem_id, req.user.id]
  );
  if (!problem) return res.status(404).json({ error: 'Задача не знайдена' });
  if (problem.solved) return res.status(400).json({ error: 'Вже вирішено' });

  const correct = Math.abs(parseFloat(answer) - problem.answer) < 0.01;
  if (correct) {
    const coins = problem.earned_coins;
    await db.runAsync('UPDATE math_problems SET solved = 1 WHERE id = ?', [problem_id]);
    await db.runAsync('UPDATE users SET coins = coins + ? WHERE id = ?', [coins, req.user.id]);
    await db.runAsync(
      'INSERT INTO coin_transactions (user_id, amount, reason) VALUES (?, ?, ?)',
      [req.user.id, coins, `Вирішив задачу: ${problem.problem}`]
    );
    const user = await db.getAsync('SELECT coins FROM users WHERE id = ?', [req.user.id]);
    io.emit('coins_update', { user_id: req.user.id, coins: user.coins });
    res.json({ correct: true, coins_earned: coins, total_coins: user.coins });
  } else {
    res.json({ correct: false });
  }
});

app.post('/api/speech/reward', authMiddleware, async (req, res) => {
  const { text, word_count } = req.body;
  if (!text || word_count < 3) return res.status(400).json({ error: 'Текст занадто короткий' });

  const coins = Math.min(Math.floor(word_count / 3) * 2, 20);
  await db.runAsync('UPDATE users SET coins = coins + ? WHERE id = ?', [coins, req.user.id]);
  await db.runAsync(
    'INSERT INTO coin_transactions (user_id, amount, reason) VALUES (?, ?, ?)',
    [req.user.id, coins, `Мовлення: "${text.substring(0, 50)}"`]
  );
  const user = await db.getAsync('SELECT coins FROM users WHERE id = ?', [req.user.id]);
  io.emit('coins_update', { user_id: req.user.id, coins: user.coins });
  res.json({ coins_earned: coins, total_coins: user.coins });
});

// ─── Admin Routes ─────────────────────────────────────────────────────────────
app.get('/api/admin/stats', authMiddleware, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Доступ заборонено' });
  const [users, messages, transactions, coinsRow] = await Promise.all([
    db.getAsync('SELECT COUNT(*) as count FROM users'),
    db.getAsync('SELECT COUNT(*) as count FROM messages'),
    db.getAsync('SELECT COUNT(*) as count FROM coin_transactions'),
    db.getAsync('SELECT SUM(coins) as sum FROM users'),
  ]);
  res.json({
    users: users.count, messages: messages.count,
    transactions: transactions.count, total_coins: coinsRow.sum || 0
  });
});

app.get('/api/admin/all-messages', authMiddleware, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Доступ заборонено' });
  const msgs = await db.allAsync(`
    SELECT m.*, u.display_name, u.username, u.avatar_color
    FROM messages m JOIN users u ON m.user_id = u.id
    ORDER BY m.created_at DESC LIMIT 200
  `);
  res.json(msgs.reverse());
});

app.delete('/api/admin/message/:id', authMiddleware, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Доступ заборонено' });
  await db.runAsync('DELETE FROM messages WHERE id = ?', [req.params.id]);
  io.emit('message_deleted', { id: parseInt(req.params.id) });
  res.json({ success: true });
});

app.post('/api/admin/give-coins', authMiddleware, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Доступ заборонено' });
  const { user_id, amount, reason } = req.body;
  await db.runAsync('UPDATE users SET coins = coins + ? WHERE id = ?', [amount, user_id]);
  await db.runAsync(
    'INSERT INTO coin_transactions (user_id, amount, reason) VALUES (?, ?, ?)',
    [user_id, amount, reason || 'Монети від адміна']
  );
  const user = await db.getAsync('SELECT coins FROM users WHERE id = ?', [user_id]);
  io.emit('coins_update', { user_id, coins: user.coins });
  res.json({ success: true, total_coins: user.coins });
});

// Returns all sessions (IPs + geo) for every user, grouped by user
app.get('/api/admin/sessions', authMiddleware, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Доступ заборонено' });
  const sessions = await db.allAsync(`
    SELECT s.*, u.display_name, u.username, u.avatar_color
    FROM user_sessions s JOIN users u ON s.user_id = u.id
    ORDER BY s.last_seen DESC
  `);
  res.json(sessions);
});

// Refresh geo for a specific IP (admin can re-fetch if needed)
app.post('/api/admin/refresh-geo', authMiddleware, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Доступ заборонено' });
  const { session_id, ip } = req.body;
  geoCache.delete(ip);
  const geo = await fetchGeo(ip);
  if (geo) {
    await db.runAsync(
      'UPDATE user_sessions SET city=?, region=?, country=?, org=?, latitude=?, longitude=? WHERE id=?',
      [geo.city, geo.region, geo.country, geo.org, geo.latitude, geo.longitude, session_id]
    );
  }
  res.json({ success: true, geo });
});

// ─── Socket.io ────────────────────────────────────────────────────────────────
const onlineUsers = new Map();

io.use((socket, next) => {
  const cookieHeader = socket.handshake.headers.cookie || '';
  const match = cookieHeader.match(/token=([^;]+)/);
  const token = match ? match[1] : socket.handshake.auth.token;
  if (!token) return next(new Error('Unauthorized'));
  try {
    socket.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    next(new Error('Invalid token'));
  }
});

io.on('connection', (socket) => {
  const userId = socket.user.id;
  onlineUsers.set(userId, socket.id);
  io.emit('online_users', Array.from(onlineUsers.keys()));

  // track IP from socket connection
  const socketIp =
    socket.handshake.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    socket.handshake.address ||
    'unknown';
  const ua = socket.handshake.headers['user-agent'] || '';
  trackSession(userId, socketIp, ua).catch(() => {});

  socket.on('send_message', async ({ content, type = 'text' }) => {
    if (!content?.trim()) return;
    const safeContent = content.trim().substring(0, 1000);
    const result = await db.runAsync(
      'INSERT INTO messages (user_id, content, type) VALUES (?, ?, ?)',
      [userId, safeContent, type]
    );
    const user = await db.getAsync('SELECT * FROM users WHERE id = ?', [userId]);
    io.emit('new_message', {
      id: result.lastID, content: safeContent, type,
      created_at: new Date().toISOString(),
      user_id: userId, display_name: user.display_name,
      username: user.username, avatar_color: user.avatar_color, role: user.role,
    });
  });

  socket.on('typing', async () => {
    const user = await db.getAsync('SELECT display_name FROM users WHERE id = ?', [userId]);
    socket.broadcast.emit('user_typing', { user_id: userId, display_name: user.display_name });
  });

  socket.on('stop_typing', () => {
    socket.broadcast.emit('user_stop_typing', { user_id: userId });
  });

  socket.on('disconnect', async () => {
    onlineUsers.delete(userId);
    await db.runAsync('UPDATE users SET last_seen = CURRENT_TIMESTAMP WHERE id = ?', [userId]);
    io.emit('online_users', Array.from(onlineUsers.keys()));
  });
});

// ─── Helpers ──────────────────────────────────────────────────────────────────
function safeUser(user) {
  const { password, ...safe } = user;
  return safe;
}

function generateMathProblem(difficulty) {
  const r = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

  if (difficulty === 'easy') {
    const a = r(1, 20), b = r(1, 20);
    const op = ['+', '-'][r(0, 1)];
    const answer = op === '+' ? a + b : a - b;
    return { problem: `${a} ${op} ${b} = ?`, answer, coins: 5 };
  }
  if (difficulty === 'hard') {
    const a = r(10, 50), b = r(2, 9), c = r(1, 30);
    const ops = ['+', '-', '*'];
    const op1 = ops[r(0, 2)], op2 = ['+', '-'][r(0, 1)];
    let mid = op1 === '+' ? a + b : op1 === '-' ? a - b : a * b;
    const answer = op2 === '+' ? mid + c : mid - c;
    return { problem: `(${a} ${op1} ${b}) ${op2} ${c} = ?`, answer, coins: 20 };
  }
  // medium
  const ops = ['+', '-', '*'];
  const a = r(2, 30), b = r(2, 15), op = ops[r(0, 2)];
  const answer = op === '+' ? a + b : op === '-' ? a - b : a * b;
  return { problem: `${a} ${op} ${b} = ?`, answer, coins: 10 };
}

server.listen(PORT, () => {
  console.log(`ArBexily running on http://localhost:${PORT}`);
});
