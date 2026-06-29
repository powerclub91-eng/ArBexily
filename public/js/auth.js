function showTab(tab) {
  document.getElementById('login-form').classList.toggle('hidden', tab !== 'login');
  document.getElementById('register-form').classList.toggle('hidden', tab !== 'register');
  document.querySelectorAll('.tab-btn').forEach((b, i) => {
    b.classList.toggle('active', (i === 0 && tab === 'login') || (i === 1 && tab === 'register'));
  });
}

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
    errEl.textContent = 'Помилка з\'єднання';
  }
}

async function register(e) {
  e.preventDefault();
  const display_name = document.getElementById('reg-display').value.trim();
  const username = document.getElementById('reg-username').value.trim();
  const password = document.getElementById('reg-password').value;
  const errEl = document.getElementById('reg-error');
  errEl.textContent = '';

  if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
    errEl.textContent = 'Логін: 3-20 символів, лише a-z, 0-9, _';
    return;
  }

  try {
    const res = await fetch('/api/register', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ display_name, username, password })
    });
    const data = await res.json();
    if (!res.ok) { errEl.textContent = data.error; return; }
    window.location.href = '/chat.html';
  } catch {
    errEl.textContent = 'Помилка з\'єднання';
  }
}

// Redirect if already logged in
fetch('/api/me').then(r => { if (r.ok) window.location.href = '/chat.html'; }).catch(() => {});
