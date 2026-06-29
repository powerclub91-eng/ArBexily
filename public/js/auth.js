// ─── Nickname Generator ───────────────────────────────────────────────────────
const NICK_ADJ = [
  'Вогняний','Крижаний','Швидкий','Лінивий','Веселий','Дикий','Сонний','Злий',
  'Хитрий','Голодний','Сердитий','Смішний','Мокрий','Рудий','Зелений','Синій',
  'Гучний','Тихий','Великий','Малий','Гострий','М\'який','Твердий','Солодкий',
  'Кислий','Гіркий','Пухнастий','Колючий','Блискучий','Темний','Яскравий',
  'Важкий','Легкий','Старий','Новий','Справжній','Загадковий','Невидимий',
];
const NICK_NOUN = [
  'Вареник','Борщ','Картопля','Котик','Пончик','Качка','Їжак','Лиса','Ведмідь',
  'Кіт','Собака','Кролик','Черепаха','Папуга','Хом\'як','Миша','Вовк','Лев',
  'Тигр','Слон','Жираф','Зебра','Пінгвін','Фламінго','Краб','Восьминіг',
  'Дракон','Єдиноріг','Феникс','Гоблін','Ельф','Гном','Тролль','Лицар',
  'Піrat','Ніндзя','Самурай','Ковбой','Астронавт','Детектив','Маг',
];

function generateNick() {
  const adj = NICK_ADJ[Math.floor(Math.random() * NICK_ADJ.length)];
  const noun = NICK_NOUN[Math.floor(Math.random() * NICK_NOUN.length)];
  const num = Math.floor(Math.random() * 90) + 10;
  document.getElementById('reg-display').value = `${adj}${noun}${num}`;
}

// ─── Tab Switching ────────────────────────────────────────────────────────────
function showTab(tab) {
  document.getElementById('login-form').classList.toggle('hidden', tab !== 'login');
  document.getElementById('register-form').classList.toggle('hidden', tab !== 'register');
  document.querySelectorAll('.tab-btn').forEach((b, i) => {
    b.classList.toggle('active', (i === 0 && tab === 'login') || (i === 1 && tab === 'register'));
  });
}

// ─── Login ────────────────────────────────────────────────────────────────────
async function login(e) {
  e.preventDefault();
  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;
  const errEl = document.getElementById('login-error');
  errEl.textContent = '';

  try {
    const res = await fetch('/api/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (!res.ok) { errEl.textContent = data.error; return; }
    window.location.href = '/chat.html';
  } catch {
    errEl.textContent = "Помилка з'єднання";
  }
}

// ─── Register ─────────────────────────────────────────────────────────────────
async function register(e) {
  e.preventDefault();
  const real_name = document.getElementById('reg-real-name').value.trim();
  const display_name = document.getElementById('reg-display').value.trim();
  const username = document.getElementById('reg-username').value.trim();
  const password = document.getElementById('reg-password').value;
  const errEl = document.getElementById('reg-error');
  errEl.textContent = '';

  if (!real_name) { errEl.textContent = "Введи справжнє ім'я"; return; }
  if (!display_name) { errEl.textContent = 'Введи або згенеруй нікнейм'; return; }
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
    errEl.textContent = 'Логін: 3-20 символів, лише a-z, 0-9, _';
    return;
  }

  try {
    const res = await fetch('/api/register', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ real_name, display_name, username, password })
    });
    const data = await res.json();
    if (!res.ok) { errEl.textContent = data.error; return; }
    window.location.href = '/chat.html';
  } catch {
    errEl.textContent = "Помилка з'єднання";
  }
}

// Redirect if already logged in
fetch('/api/me').then(r => { if (r.ok) window.location.href = '/chat.html'; }).catch(() => {});
