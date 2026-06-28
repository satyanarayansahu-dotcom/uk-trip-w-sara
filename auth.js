// auth.js — shared authentication, session, and per-user storage helper
// Included inline or via <script src="auth.js"> on every page.

(function(global) {
  'use strict';

  const AUTH_KEY    = 'itin_auth_users';   // localStorage: array of users
  const SESSION_KEY = 'itin_session';      // sessionStorage: { userId }

  // ── Password hashing (SubtleCrypto SHA-256) ──────────────────────────────
  async function hashPassword(password) {
    const enc = new TextEncoder();
    const buf = await crypto.subtle.digest('SHA-256', enc.encode(password));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
  }

  // ── User store helpers ────────────────────────────────────────────────────
  function loadUsers() {
    try { return JSON.parse(localStorage.getItem(AUTH_KEY) || '[]'); } catch { return []; }
  }
  function saveUsers(users) {
    localStorage.setItem(AUTH_KEY, JSON.stringify(users));
  }
  function findByEmail(email) {
    return loadUsers().find(u => u.email.toLowerCase() === email.trim().toLowerCase());
  }

  // ── Session ───────────────────────────────────────────────────────────────
  function setSession(user) {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ userId: user.id }));
  }
  function getCurrentUser() {
    try {
      const s = sessionStorage.getItem(SESSION_KEY);
      if (!s) return null;
      const { userId } = JSON.parse(s);
      return loadUsers().find(u => u.id === userId) || null;
    } catch { return null; }
  }
  function logout() {
    sessionStorage.removeItem(SESSION_KEY);
    window.location.href = 'login.html';
  }
  function requireAuth() {
    if (!getCurrentUser()) {
      window.location.href = 'login.html';
      throw new Error('not authenticated'); // stop page script
    }
  }

  // ── Role helpers ──────────────────────────────────────────────────────────
  function canEdit() {
    const u = getCurrentUser();
    return u && (u.role === 'admin' || u.role === 'editor');
  }
  function isAdmin() {
    const u = getCurrentUser();
    return u && u.role === 'admin';
  }

  // ── Per-user namespaced storage key ───────────────────────────────────────
  // e.g. storageKey('flights') → 'itin_u_abc123_flights'
  function storageKey(key) {
    const u = getCurrentUser();
    if (!u) return 'itin_anon_' + key;
    return 'itin_u_' + u.id + '_' + key;
  }
  function getData(key, fallback) {
    try {
      const d = localStorage.getItem(storageKey(key));
      return d ? JSON.parse(d) : (fallback || null);
    } catch { return fallback || null; }
  }
  function saveData(key, val) {
    localStorage.setItem(storageKey(key), JSON.stringify(val));
  }

  // ── Register ──────────────────────────────────────────────────────────────
  async function register(name, email, password) {
    const users = loadUsers();
    const normalEmail = email.trim().toLowerCase();
    if (users.find(u => u.email.toLowerCase() === normalEmail)) {
      throw new Error('An account with this email already exists.');
    }
    const hash = await hashPassword(password);
    const isFirst = users.length === 0;
    const user = {
      id:           Math.random().toString(36).slice(2) + Date.now().toString(36),
      name:         name.trim(),
      email:        normalEmail,
      passwordHash: hash,
      role:         isFirst ? 'admin' : 'viewer',
      createdAt:    new Date().toISOString(),
      grantedBy:    isFirst ? null : null,
    };
    users.push(user);
    saveUsers(users);
    setSession(user);
    return user;
  }

  // ── Login ─────────────────────────────────────────────────────────────────
  async function login(email, password) {
    const user = findByEmail(email);
    if (!user) throw new Error('No account found for this email.');
    const hash = await hashPassword(password);
    if (hash !== user.passwordHash) throw new Error('Incorrect password.');
    setSession(user);
    return user;
  }

  // ── Grant / revoke access (admin only) ────────────────────────────────────
  async function grantAccess(name, email, role, tempPassword) {
    const admin = getCurrentUser();
    if (!admin || admin.role !== 'admin') throw new Error('Admin only.');
    const users = loadUsers();
    const normalEmail = email.trim().toLowerCase();
    const existing = users.find(u => u.email.toLowerCase() === normalEmail);
    if (existing) {
      // update role only
      existing.role = role;
      existing.grantedBy = admin.id;
      saveUsers(users);
      return existing;
    }
    const hash = await hashPassword(tempPassword);
    const user = {
      id:           Math.random().toString(36).slice(2) + Date.now().toString(36),
      name:         name.trim(),
      email:        normalEmail,
      passwordHash: hash,
      role:         role,
      createdAt:    new Date().toISOString(),
      grantedBy:    admin.id,
    };
    users.push(user);
    saveUsers(users);
    return user;
  }

  function revokeAccess(userId) {
    const admin = getCurrentUser();
    if (!admin || admin.role !== 'admin') throw new Error('Admin only.');
    const users = loadUsers().filter(u => u.id !== userId);
    saveUsers(users);
  }

  function updateRole(userId, newRole) {
    const admin = getCurrentUser();
    if (!admin || admin.role !== 'admin') throw new Error('Admin only.');
    const users = loadUsers();
    const u = users.find(x => x.id === userId);
    if (u) { u.role = newRole; saveUsers(users); }
  }

  // ── Copy trip data from admin to another user ─────────────────────────────
  function shareAdminDataWith(targetUserId) {
    const admin = getCurrentUser();
    if (!admin || admin.role !== 'admin') throw new Error('Admin only.');
    const KEYS = ['flights','passports','accom','car','itinerary','checklist','contacts'];
    const adminPrefix = 'itin_u_' + admin.id + '_';
    const targetPrefix = 'itin_u_' + targetUserId + '_';
    KEYS.forEach(k => {
      const val = localStorage.getItem(adminPrefix + k);
      if (val) localStorage.setItem(targetPrefix + k, val);
    });
  }

  // ── User chip HTML (call after DOM ready, pass container selector) ─────────
  function renderUserChip(containerSelector) {
    const u = getCurrentUser();
    if (!u) return;
    const el = document.querySelector(containerSelector);
    if (!el) return;

    const chip = document.createElement('div');
    chip.className = 'auth-chip';
    chip.innerHTML = `
      <div class="auth-chip-btn" id="auth-chip-btn">
        <div class="auth-avatar">${u.name.charAt(0).toUpperCase()}</div>
        <span class="auth-name">${u.name.split(' ')[0]}</span>
        <span class="auth-role-badge role-${u.role}">${u.role}</span>
        <span class="auth-arrow">▼</span>
      </div>
      <div class="auth-menu" id="auth-menu">
        <div class="auth-menu-header">
          <div style="font-weight:700;font-size:13px">${u.name}</div>
          <div style="font-size:11px;color:var(--muted,#8b949e);margin-top:1px">${u.email}</div>
        </div>
        ${u.role === 'admin' ? '<a class="auth-menu-item" href="itinerary.html#access">👥 Manage Access</a>' : ''}
        <div class="auth-menu-item auth-signout" onclick="Auth.logout()">🚪 Sign out</div>
      </div>`;
    el.appendChild(chip);

    // toggle
    document.getElementById('auth-chip-btn').addEventListener('click', e => {
      e.stopPropagation();
      document.getElementById('auth-menu').classList.toggle('open');
      document.getElementById('auth-chip-btn').classList.toggle('open');
    });
    document.addEventListener('click', () => {
      const m = document.getElementById('auth-menu');
      const b = document.getElementById('auth-chip-btn');
      if (m) m.classList.remove('open');
      if (b) b.classList.remove('open');
    });
  }

  // ── Shared chip CSS (injected once) ──────────────────────────────────────
  function injectChipStyles() {
    if (document.getElementById('auth-chip-styles')) return;
    const s = document.createElement('style');
    s.id = 'auth-chip-styles';
    s.textContent = `
      .auth-chip { position:relative; flex-shrink:0; }
      .auth-chip-btn {
        display:flex; align-items:center; gap:7px;
        background:rgba(255,255,255,0.08);
        border:1px solid rgba(255,255,255,0.18);
        border-radius:20px; padding:5px 12px 5px 6px;
        cursor:pointer; transition:background .15s;
        color:#e6edf3; font-size:13px;
        backdrop-filter:blur(10px);
        -webkit-backdrop-filter:blur(10px);
      }
      .auth-chip-btn:hover, .auth-chip-btn.open { background:rgba(255,255,255,0.14); }
      .auth-avatar {
        width:26px; height:26px; border-radius:50%;
        background:#58a6ff; color:#fff;
        font-size:12px; font-weight:700;
        display:flex; align-items:center; justify-content:center;
        flex-shrink:0;
      }
      .auth-name { font-weight:600; font-size:13px; }
      .auth-role-badge {
        font-size:9px; font-weight:700; padding:1px 6px;
        border-radius:10px; text-transform:uppercase; letter-spacing:.05em;
      }
      .role-admin  { background:rgba(88,166,255,.18); color:#58a6ff; }
      .role-editor { background:rgba(63,185,80,.18);  color:#3fb950; }
      .role-viewer { background:rgba(139,148,158,.18);color:#8b949e; }
      .auth-arrow { font-size:9px; color:rgba(255,255,255,0.4); transition:transform .15s; }
      .auth-chip-btn.open .auth-arrow { transform:rotate(180deg); }
      .auth-menu {
        display:none; position:absolute; top:calc(100% + 8px); right:0;
        min-width:200px; background:#161b22; border:1px solid #30363d;
        border-radius:10px; overflow:hidden; box-shadow:0 8px 32px rgba(0,0,0,.5);
        z-index:500;
      }
      .auth-menu.open { display:block; }
      .auth-menu-header { padding:12px 14px; border-bottom:1px solid #30363d; }
      .auth-menu-item {
        display:block; padding:10px 14px; font-size:13px; cursor:pointer;
        color:#e6edf3; text-decoration:none; transition:background .1s;
      }
      .auth-menu-item:hover { background:#21262d; }
      .auth-signout { color:#f85149 !important; }
    `;
    document.head.appendChild(s);
  }

  // ── Public API ────────────────────────────────────────────────────────────
  const Auth = {
    hashPassword, register, login, logout,
    getCurrentUser, requireAuth, canEdit, isAdmin,
    storageKey, getData, saveData,
    grantAccess, revokeAccess, updateRole,
    shareAdminDataWith,
    renderUserChip, injectChipStyles,
    loadUsers,
  };

  global.Auth = Auth;

})(window);
