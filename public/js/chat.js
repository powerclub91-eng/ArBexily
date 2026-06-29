// ─── State ────────────────────────────────────────────────────────────────────
let me = null;
let socket = null;
let currentDifficulty = 'medium';
let currentProblemId = null;
let recognition = null;
let isRecording = false;
let speechText = '';
let typingTimer = null;
let allUsers = [];

// ─── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  const res = await fetch('/api/me');
  if (!res.ok) { window.location.href = '/'; return; }
  me = await res.json();

  // Show my profile
  const av = document.getElementById('my-avatar');
  av.textContent = me.display_name[0].toUpperCase();
  av.style.background = me.avatar_color;
  document.getElementById('my-name').textContent = me.display_name;
  updateCoinsDisplay(me.coins);

  // Admin elements
  if (me.role === 'admin') {
    document.querySelectorAll('.admin-only').forEach(el => el.classList.remove('hidden'));
  }

  connectSocket();
  loadMessages();
  loadUsers();
}

function updateCoinsDisplay(coins) {
  me.coins = coins;
  document.getElementById('my-coins').textContent = coins;
  document.getElementById('mobile-coins').textContent = coins;
  if (document.getElementById('coins-big')) document.getElementById('coins-big').textContent = coins;
}

// ─── Socket ────────────────────────────────────────────────────────────────────
function connectSocket() {
  socket = io({ auth: { token: '' } }); // token sent via cookie

  socket.on('new_message', (msg) => {
    appendMessage(msg);
    const container = document.getElementById('messages');
    container.scrollTop = container.scrollHeight;
  });

  socket.on('message_deleted', ({ id }) => {
    const el = document.getElementById(`msg-${id}`);
    if (el) el.remove();
  });

  socket.on('online_users', (ids) => {
    updateOnlineList(ids);
    document.getElementById('chat-status').textContent = `${ids.length} онлайн`;
  });

  socket.on('user_typing', ({ user_id, display_name }) => {
    if (user_id === me.id) return;
    document.getElementById('typing-indicator').textContent = `${display_name} друкує...`;
  });

  socket.on('user_stop_typing', () => {
    document.getElementById('typing-indicator').textContent = '';
  });

  socket.on('coins_update', ({ user_id, coins }) => {
    if (user_id === me.id) updateCoinsDisplay(coins);
    // update leaderboard if open
    const lb = document.getElementById('leaderboard-list');
    if (lb && document.getElementById('panel-leaderboard').classList.contains('active')) {
      loadLeaderboard();
    }
  });
}

// ─── Messages ──────────────────────────────────────────────────────────────────
async function loadMessages() {
  const container = document.getElementById('messages');
  const res = await fetch('/api/messages?limit=60');
  if (!res.ok) return;
  const msgs = await res.json();
  container.innerHTML = '';
  msgs.forEach(m => appendMessage(m, false));
  container.scrollTop = container.scrollHeight;
}

function appendMessage(msg, animate = true) {
  const container = document.getElementById('messages');
  const isOwn = msg.user_id === me.id;
  const isAdmin = me.role === 'admin';

  const div = document.createElement('div');
  div.className = `msg${isOwn ? ' own' : ''}`;
  div.id = `msg-${msg.id}`;

  const initial = (msg.display_name || '?')[0].toUpperCase();
  const time = formatTime(msg.created_at);

  div.innerHTML = `
    <div class="msg-avatar" style="background:${msg.avatar_color || '#6c63ff'}">${initial}</div>
    <div class="msg-body">
      <div class="msg-meta">
        <span class="msg-name">${esc(msg.display_name)}</span>
        ${msg.role === 'admin' ? '<span class="msg-admin-badge">Адмін</span>' : ''}
        <span class="msg-time">${time}</span>
        ${isAdmin ? `<button class="msg-delete-btn" onclick="deleteMessage(${msg.id})">🗑</button>` : ''}
      </div>
      <div class="msg-bubble${msg.type === 'speech' ? ' speech-type' : ''}">
        ${esc(msg.content)}${msg.type === 'speech' ? ' <span title="Відправлено через мікрофон">🎤</span>' : ''}
      </div>
    </div>`;

  if (!animate) div.style.animation = 'none';
  container.appendChild(div);
}

function sendMessage() {
  const input = document.getElementById('message-input');
  const content = input.value.trim();
  if (!content || !socket) return;
  socket.emit('send_message', { content, type: 'text' });
  input.value = '';
  socket.emit('stop_typing');
  clearTimeout(typingTimer);
}

function handleMessageKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
}

function handleTyping() {
  if (!socket) return;
  socket.emit('typing');
  clearTimeout(typingTimer);
  typingTimer = setTimeout(() => socket.emit('stop_typing'), 1500);
}

async function deleteMessage(id) {
  if (!confirm('Видалити повідомлення?')) return;
  await fetch(`/api/admin/message/${id}`, { method: 'DELETE' });
}

// ─── Users & Online ────────────────────────────────────────────────────────────
async function loadUsers() {
  const res = await fetch('/api/users');
  allUsers = await res.json();

  // Populate give-coins select
  const sel = document.getElementById('give-coins-user');
  if (sel) {
    sel.innerHTML = allUsers.map(u => `<option value="${u.id}">${u.display_name} (${u.username})</option>`).join('');
  }
}

function updateOnlineList(ids) {
  const list = document.getElementById('online-list');
  const names = ids.map(id => {
    const u = allUsers.find(u => u.id === id);
    return u ? `<div class="online-user"><div class="online-dot"></div><span>${esc(u.display_name)}</span></div>` : '';
  }).filter(Boolean);
  list.innerHTML = names.join('') || '<span style="color:var(--text-dim);font-size:12px">Нікого</span>';
}

// ─── Panels ────────────────────────────────────────────────────────────────────
function showPanel(name) {
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  const panel = document.getElementById(`panel-${name}`);
  const nav = document.getElementById(`nav-${name}`);
  if (panel) panel.classList.add('active');
  if (nav) nav.classList.add('active');

  const titles = { chat: 'Чат класу', coins: 'Монети', math: 'Задачі', speech: 'Мікрофон', leaderboard: 'Рейтинг', admin: 'Адмін' };
  document.getElementById('mobile-title').textContent = titles[name] || 'ArBexily';

  if (name === 'coins') loadCoinsHistory();
  if (name === 'leaderboard') loadLeaderboard();
  if (name === 'admin') loadAdminPanel();

  // Close sidebar on mobile
  if (window.innerWidth <= 768) closeSidebar();
}

// ─── Coins ─────────────────────────────────────────────────────────────────────
async function loadCoinsHistory() {
  document.getElementById('coins-big').textContent = me.coins;
  const res = await fetch('/api/coins/history');
  const history = await res.json();
  const list = document.getElementById('coins-history');
  if (!history.length) { list.innerHTML = '<p style="color:var(--text-muted);padding:12px">Поки немає транзакцій</p>'; return; }
  list.innerHTML = history.map(h => `
    <div class="history-item">
      <span class="history-amount">+${h.amount}🪙</span>
      <span class="history-reason">${esc(h.reason)}</span>
      <span class="history-date">${formatDate(h.created_at)}</span>
    </div>`).join('');
}

// ─── Math ──────────────────────────────────────────────────────────────────────
function selectDiff(diff, btn) {
  currentDifficulty = diff;
  document.querySelectorAll('.diff-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  currentProblemId = null;
  document.getElementById('math-problem').textContent = 'Натисни "Нова задача"';
  document.getElementById('math-answer').value = '';
  document.getElementById('math-result').textContent = '';
  document.getElementById('check-btn').disabled = true;
}

async function generateMath() {
  const res = await fetch('/api/math/generate', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ difficulty: currentDifficulty })
  });
  const data = await res.json();
  currentProblemId = data.id;
  document.getElementById('math-problem').textContent = data.problem;
  document.getElementById('math-answer').value = '';
  document.getElementById('math-result').textContent = `Нагорода: ${data.coins_reward}🪙`;
  document.getElementById('math-result').className = 'math-result';
  document.getElementById('check-btn').disabled = false;
  document.getElementById('math-answer').focus();
}

async function checkMathAnswer() {
  if (!currentProblemId) return;
  const answer = document.getElementById('math-answer').value;
  if (!answer) return;

  const res = await fetch('/api/math/solve', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ problem_id: currentProblemId, answer })
  });
  const data = await res.json();
  const resultEl = document.getElementById('math-result');

  if (data.correct) {
    resultEl.textContent = `Вірно! +${data.coins_earned}🪙 (всього: ${data.total_coins}🪙)`;
    resultEl.className = 'math-result correct';
    updateCoinsDisplay(data.total_coins);
    currentProblemId = null;
    document.getElementById('check-btn').disabled = true;
    setTimeout(generateMath, 2000);
  } else {
    resultEl.textContent = 'Неправильно, спробуй ще!';
    resultEl.className = 'math-result wrong';
    document.getElementById('math-answer').value = '';
    document.getElementById('math-answer').focus();
  }
}

// ─── Speech ────────────────────────────────────────────────────────────────────
function toggleSpeech() {
  if (isRecording) stopSpeech();
  else startSpeech();
}

function startSpeech() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    alert('Твій браузер не підтримує розпізнавання мовлення. Спробуй Chrome.');
    return;
  }

  recognition = new SpeechRecognition();
  recognition.lang = 'uk-UA';
  recognition.continuous = true;
  recognition.interimResults = true;

  recognition.onresult = (e) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const t = e.results[i][0].transcript;
      if (e.results[i].isFinal) speechText += t + ' ';
      else interim = t;
    }
    document.getElementById('speech-text').textContent = (speechText + interim).trim() || 'Слухаю...';
    if (speechText.trim()) document.getElementById('speech-actions').classList.remove('hidden');
  };

  recognition.onerror = (e) => {
    if (e.error !== 'no-speech') {
      document.getElementById('mic-status').textContent = 'Помилка: ' + e.error;
    }
  };

  recognition.onend = () => {
    if (isRecording) recognition.start(); // keep going
  };

  recognition.start();
  isRecording = true;
  document.getElementById('mic-btn').classList.add('recording');
  document.getElementById('mic-status').textContent = 'Говори! Запис...';
}

function stopSpeech() {
  if (recognition) recognition.stop();
  isRecording = false;
  document.getElementById('mic-btn').classList.remove('recording');
  document.getElementById('mic-status').textContent = 'Зупинено';
}

async function claimSpeechCoins() {
  const text = speechText.trim();
  if (!text) return;
  const wordCount = text.split(/\s+/).length;

  const res = await fetch('/api/speech/reward', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, word_count: wordCount })
  });
  const data = await res.json();
  if (data.error) { document.getElementById('speech-result').textContent = data.error; return; }
  document.getElementById('speech-result').textContent = `+${data.coins_earned}🪙 отримано! Всього: ${data.total_coins}🪙`;
  updateCoinsDisplay(data.total_coins);
  clearSpeech();
}

function sendSpeechMessage() {
  const text = speechText.trim();
  if (!text || !socket) return;
  socket.emit('send_message', { content: text, type: 'speech' });
  clearSpeech();
  showPanel('chat');
}

function clearSpeech() {
  speechText = '';
  document.getElementById('speech-text').textContent = '';
  document.getElementById('speech-actions').classList.add('hidden');
  document.getElementById('speech-result').textContent = '';
  document.getElementById('mic-status').textContent = 'Натисни мікрофон';
  if (isRecording) stopSpeech();
}

// ─── Leaderboard ───────────────────────────────────────────────────────────────
async function loadLeaderboard() {
  const res = await fetch('/api/coins/leaderboard');
  const users = await res.json();
  const list = document.getElementById('leaderboard-list');
  const medals = ['🥇', '🥈', '🥉'];
  list.innerHTML = users.map((u, i) => `
    <div class="lb-item${i < 3 ? ` top${i+1}` : ''}">
      <div class="lb-rank">${medals[i] || i + 1}</div>
      <div class="lb-avatar" style="background:${u.avatar_color}">${u.display_name[0].toUpperCase()}</div>
      <div class="lb-info">
        <div class="lb-name">${esc(u.display_name)} ${u.id === me.id ? '<span class="lb-you">Це ти!</span>' : ''}</div>
        <div class="lb-coins">🪙 ${u.coins} монет</div>
      </div>
    </div>`).join('') || '<p style="color:var(--text-muted);padding:20px">Поки нікого немає</p>';
}

// ─── Admin ─────────────────────────────────────────────────────────────────────
let adminDataLoaded = false;

function switchAdminTab(tab) {
  document.querySelectorAll('.admin-tab').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.admin-tab-panel').forEach(p => p.classList.remove('active'));
  document.querySelector(`.admin-tab[onclick*="${tab}"]`).classList.add('active');
  document.getElementById(`atab-${tab}`).classList.add('active');
}

async function loadAdminPanel() {
  const [statsRes, msgsRes, usersRes] = await Promise.all([
    fetch('/api/admin/stats'),
    fetch('/api/admin/all-messages'),
    fetch('/api/admin/users-full'),
  ]);
  const stats = await statsRes.json();
  const msgs = await msgsRes.json();
  const users = await usersRes.json();

  document.getElementById('admin-stats').innerHTML = `
    <div class="stat-card"><div class="stat-value">${stats.users}</div><div class="stat-label">Учнів</div></div>
    <div class="stat-card"><div class="stat-value">${stats.messages}</div><div class="stat-label">Повідомлень</div></div>
    <div class="stat-card"><div class="stat-value">${stats.total_coins}</div><div class="stat-label">Монет всього</div></div>
    <div class="stat-card"><div class="stat-value">${stats.transactions}</div><div class="stat-label">Транзакцій</div></div>
  `;

  // ── Users tab ──────────────────────────────────────────────
  document.getElementById('admin-users-list').innerHTML = users.map(u => {
    const sessionHtml = u.sessions.length ? u.sessions.map(s => {
      const device = parseDeviceClient(s.user_agent);
      const browser = parseBrowserClient(s.user_agent);
      const geoStr = [s.city, s.region, s.country].filter(Boolean).join(', ') || 'Геолокація не визначена';
      return `
        <div class="session-item">
          <div>
            <div class="session-ip">📡 ${esc(s.ip)}</div>
            <div class="session-geo">
              <span class="geo-city">${esc(geoStr)}</span>
              ${s.org ? `<br><span class="geo-org">🌐 ${esc(s.org)}</span>` : ''}
            </div>
            <div class="session-device">💻 ${device} · ${browser}</div>
          </div>
          <div class="session-time">
            Перший: ${formatDate(s.first_seen)}<br>
            Останній: ${formatDate(s.last_seen)}
          </div>
        </div>`;
    }).join('') : '<div style="color:var(--text-dim);font-size:13px;padding:8px">Немає даних про підключення</div>';

    return `
      <div class="admin-user-card" id="auc-${u.id}">
        <div class="admin-user-header" onclick="toggleUserCard(${u.id})">
          <div class="msg-avatar" style="background:${u.avatar_color};width:42px;height:42px;border-radius:12px;font-size:17px;flex-shrink:0">
            ${u.display_name[0].toUpperCase()}
          </div>
          <div class="admin-user-info">
            <div class="admin-user-nick">
              ${esc(u.display_name)}
              ${u.role === 'admin' ? '<span class="admin-tag admin">Адмін</span>' : '<span class="admin-tag">Учень</span>'}
            </div>
            <div class="admin-user-real">
              👤 ${esc(u.real_name || '—')} &nbsp;·&nbsp;
              🔑 ${esc(u.username)} &nbsp;·&nbsp;
              🪙 ${u.coins} &nbsp;·&nbsp;
              📡 ${u.sessions.length} IP
            </div>
          </div>
          <span class="chevron">▶</span>
        </div>
        <div class="admin-user-sessions">
          <div style="font-size:12px;color:var(--text-dim);margin-bottom:8px;text-transform:uppercase;letter-spacing:.6px">IP / Геолокація</div>
          ${sessionHtml}
        </div>
      </div>`;
  }).join('') || '<p style="color:var(--text-muted);padding:16px">Немає учнів</p>';

  // ── Messages tab ───────────────────────────────────────────
  document.getElementById('admin-messages').innerHTML = msgs.slice().reverse().map(m => `
    <div class="admin-msg" id="admin-msg-${m.id}">
      <div class="msg-avatar" style="background:${m.avatar_color};width:32px;height:32px;border-radius:8px;font-size:13px;flex-shrink:0">${m.display_name[0]}</div>
      <div class="admin-msg-info">
        <div class="admin-msg-name">${esc(m.display_name)} <span style="color:var(--text-dim)">(${esc(m.username)})</span></div>
        <div class="admin-msg-text">${esc(m.content)}</div>
        <div class="admin-msg-time">${formatDate(m.created_at)}</div>
      </div>
      <button class="btn-delete" onclick="deleteMessage(${m.id})">🗑</button>
    </div>`).join('') || '<p style="color:var(--text-muted);padding:16px">Немає повідомлень</p>';
}

function toggleUserCard(id) {
  document.getElementById(`auc-${id}`).classList.toggle('open');
}

// client-side device/browser parsers (mirrors server logic)
function parseDeviceClient(ua = '') {
  if (!ua) return 'Невідомий';
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  if (/Android/.test(ua)) return 'Android';
  if (/Mobile/.test(ua)) return 'Мобільний';
  if (/Windows/.test(ua)) return 'Windows';
  if (/Macintosh|Mac OS/.test(ua)) return 'Mac';
  if (/Linux/.test(ua)) return 'Linux';
  return 'ПК';
}
function parseBrowserClient(ua = '') {
  if (/Edg\//.test(ua)) return 'Edge';
  if (/OPR\/|Opera/.test(ua)) return 'Opera';
  if (/Firefox\//.test(ua)) return 'Firefox';
  if (/Chrome\//.test(ua)) return 'Chrome';
  if (/Safari\//.test(ua)) return 'Safari';
  return 'Браузер';
}

async function giveCoins() {
  const user_id = parseInt(document.getElementById('give-coins-user').value);
  const amount = parseInt(document.getElementById('give-coins-amount').value);
  const reason = document.getElementById('give-coins-reason').value || 'Монети від адміна';
  if (!user_id || !amount || amount < 1) return;

  const res = await fetch('/api/admin/give-coins', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id, amount, reason })
  });
  const data = await res.json();
  const resultEl = document.getElementById('give-coins-result');
  if (data.success) {
    resultEl.textContent = `Видано ${amount}🪙! Всього у учня: ${data.total_coins}🪙`;
    resultEl.style.color = 'var(--green)';
    document.getElementById('give-coins-amount').value = '';
    document.getElementById('give-coins-reason').value = '';
  } else {
    resultEl.textContent = data.error;
    resultEl.style.color = 'var(--red)';
  }
}

// ─── Sidebar ───────────────────────────────────────────────────────────────────
function toggleSidebar() {
  const sb = document.getElementById('sidebar');
  const ov = document.getElementById('sidebar-overlay');
  sb.classList.toggle('open');
  ov.classList.toggle('open');
}

function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebar-overlay').classList.remove('open');
}

// ─── Auth ──────────────────────────────────────────────────────────────────────
async function logout() {
  await fetch('/api/logout', { method: 'POST' });
  window.location.href = '/';
}

// ─── Utils ─────────────────────────────────────────────────────────────────────
function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatTime(iso) {
  const d = new Date(iso);
  return d.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });
}

function formatDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString('uk-UA', { day: '2-digit', month: 'short' }) + ' ' +
    d.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });
}

// ─── Start ─────────────────────────────────────────────────────────────────────
init();
