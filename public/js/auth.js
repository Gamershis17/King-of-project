// ============================================================
// auth.js — login / register / guest view wiring.
// ============================================================
import { api } from './api.js';
import { sanitizeGuestName, loadGuest, clearGuest } from './guest.js';

export const Auth = {
  onAuthed: null,
  onGuest: null,

  init({ onAuthed, onGuest }) {
    this.onAuthed = onAuthed;
    this.onGuest = onGuest;

    const tabLogin = document.getElementById('auth-tab-login');
    const tabRegister = document.getElementById('auth-tab-register');
    const loginForm = document.getElementById('login-form');
    const registerForm = document.getElementById('register-form');
    const errBox = document.getElementById('auth-error');

    const showError = (msg) => {
      errBox.textContent = msg || '';
      errBox.classList.toggle('hidden', !msg);
    };
    const setBusy = (busy) => {
      for (const b of document.querySelectorAll('.auth-form button[type="submit"]')) {
        b.disabled = busy;
        b.classList.toggle('busy', busy);
      }
    };

    const switchTab = (which) => {
      const isLogin = which === 'login';
      tabLogin.classList.toggle('active', isLogin);
      tabRegister.classList.toggle('active', !isLogin);
      loginForm.classList.toggle('hidden', !isLogin);
      registerForm.classList.toggle('hidden', isLogin);
      showError('');
    };
    tabLogin.addEventListener('click', () => switchTab('login'));
    tabRegister.addEventListener('click', () => switchTab('register'));

    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      showError('');
      const username = document.getElementById('login-username').value.trim();
      const password = document.getElementById('login-password').value;
      if (!username || !password) return showError('Enter your username and password.');
      setBusy(true);
      try {
        const { user } = await api.login(username, password);
        this.onAuthed && this.onAuthed(user);
      } catch (err) {
        showError(err.message || 'Login failed.');
      } finally {
        setBusy(false);
      }
    });

    registerForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      showError('');
      const username = document.getElementById('reg-username').value.trim();
      const password = document.getElementById('reg-password').value;
      const confirm = document.getElementById('reg-password2').value;
      if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) {
        return showError('Username: 3–20 chars, letters/numbers/underscore.');
      }
      if (password.length < 8) return showError('Password must be at least 8 characters.');
      if (password !== confirm) return showError('Passwords do not match.');
      setBusy(true);
      try {
        const { user } = await api.register(username, password);
        this.onAuthed && this.onAuthed(user);
      } catch (err) {
        showError(err.message || 'Registration failed.');
      } finally {
        setBusy(false);
      }
    });

    // ---------------- guest mode ----------------
    // Guests play locally with no account: zero server calls.
    const guestNameInput = document.getElementById('guest-name');
    const guestStart = document.getElementById('guest-start');
    const guestContinue = document.getElementById('guest-continue');
    const startGuest = (name) => {
      this.onGuest && this.onGuest(sanitizeGuestName(name));
    };
    const existing = loadGuest();
    if (existing) {
      document.getElementById('guest-continue-name').textContent = existing.name;
      guestContinue.classList.remove('hidden');
      guestStart.classList.add('hidden');
      document.getElementById('guest-continue-btn').addEventListener('click', () => {
        startGuest(existing.name);
      });
      document.getElementById('guest-fresh-btn').addEventListener('click', () => {
        clearGuest();
        guestContinue.classList.add('hidden');
        guestStart.classList.remove('hidden');
      });
    }
    document.getElementById('guest-play-btn').addEventListener('click', () => {
      startGuest(guestNameInput.value);
    });
    guestNameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') startGuest(guestNameInput.value);
    });
  },
};
