(function () {
  'use strict';
  const form = document.getElementById('login-form');
  const errorBox = document.getElementById('login-error');
  const btn = document.getElementById('login-btn');
  const pw = document.getElementById('password');
  const toggle = document.getElementById('toggle-pw');

  toggle.addEventListener('click', function () {
    const show = pw.type === 'password';
    pw.type = show ? 'text' : 'password';
    toggle.textContent = show ? 'Nascondi' : 'Mostra';
  });

  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    errorBox.hidden = true;
    const username = form.username.value.trim();
    const password = form.password.value;
    if (!username || !password) {
      errorBox.textContent = 'Inserisci username e password.';
      errorBox.hidden = false;
      return;
    }
    btn.disabled = true;
    btn.textContent = 'Accesso in corso...';
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Accesso non riuscito');
      window.location.replace('/');
    } catch (err) {
      errorBox.textContent = err.message;
      errorBox.hidden = false;
      pw.select();
    } finally {
      btn.disabled = false;
      btn.textContent = 'Entra';
    }
  });
})();
