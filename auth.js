// auth.js — Firebase-backed authentication and per-trip storage helper.
// Requires firebase-config.js (and Firebase SDK scripts) loaded before this.

(function(global) {
  'use strict';

  // ── Session cache (in-memory only, survives page JS, not page reload) ──────
  let _currentUser = null; // { uid, name, email, role, createdAt, grantedBy }

  // ── Firestore user helpers ────────────────────────────────────────────────
  function usersRef() { return db.collection('users'); }

  async function loadUserDoc(uid) {
    const snap = await usersRef().doc(uid).get();
    return snap.exists ? { uid, ...snap.data() } : null;
  }

  async function saveUserDoc(uid, data) {
    await usersRef().doc(uid).set(data, { merge: true });
  }

  async function loadAllUsers() {
    const snap = await usersRef().get();
    return snap.docs.map(d => ({ uid: d.id, ...d.data() }));
  }

  async function findByEmail(email) {
    const snap = await usersRef().where('email', '==', email.trim().toLowerCase()).limit(1).get();
    if (snap.empty) return null;
    const d = snap.docs[0];
    return { uid: d.id, ...d.data() };
  }

  // ── Password hashing (SHA-256 via SubtleCrypto) ──────────────────────────
  async function hashPassword(password) {
    const enc = new TextEncoder();
    const buf = await crypto.subtle.digest('SHA-256', enc.encode(password));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
  }

  // ── Session ───────────────────────────────────────────────────────────────
  // We use Firebase Anonymous auth just to get a stable UID, then store the
  // real user profile in Firestore.  This lets GitHub Pages (no backend) work.
  async function setSession(userDoc) {
    _currentUser = userDoc;
    sessionStorage.setItem('itin_session', JSON.stringify({ uid: userDoc.uid }));
  }

  function getCurrentUser() {
    if (_currentUser) return _currentUser;
    try {
      const s = sessionStorage.getItem('itin_session');
      if (!s) return null;
      // Return a minimal stub so pages can redirect; full doc loaded async.
      return JSON.parse(s);
    } catch { return null; }
  }

  // Reload full user doc from Firestore and refresh cache.
  async function refreshCurrentUser() {
    const s = sessionStorage.getItem('itin_session');
    if (!s) return null;
    const { uid } = JSON.parse(s);
    const doc = await loadUserDoc(uid);
    if (doc) _currentUser = doc;
    return doc;
  }

  function logout() {
    _currentUser = null;
    sessionStorage.removeItem('itin_session');
    fbAuth.signOut().catch(() => {});
    window.location.href = 'login.html';
  }

  // requireAuth — call at the top of every protected page.
  // Returns the full user doc (awaitable).
  async function requireAuth() {
    const user = await refreshCurrentUser();
    if (!user) {
      window.location.href = 'login.html';
      throw new Error('not authenticated');
    }
    return user;
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

  // ── Register ──────────────────────────────────────────────────────────────
  async function register(name, email, password) {
    const normalEmail = email.trim().toLowerCase();
    const existing = await findByEmail(normalEmail);
    if (existing) throw new Error('An account with this email already exists.');

    // Sign in anonymously to get a Firebase UID (no email/password needed server-side).
    const cred = await fbAuth.signInAnonymously();
    const uid = cred.user.uid;

    const allUsers = await loadAllUsers();
    const isFirst  = allUsers.length === 0;
    const hash     = await hashPassword(password);

    const userDoc = {
      name:         name.trim(),
      email:        normalEmail,
      passwordHash: hash,
      role:         isFirst ? 'admin' : 'viewer',
      createdAt:    new Date().toISOString(),
      grantedBy:    null,
      activeTripId: null,
      tripIds:      [],
    };

    await saveUserDoc(uid, userDoc);
    await setSession({ uid, ...userDoc });
    return { uid, ...userDoc };
  }

  // ── Login ─────────────────────────────────────────────────────────────────
  async function login(email, password) {
    const user = await findByEmail(email);
    if (!user) throw new Error('No account found for this email.');
    const hash = await hashPassword(password);
    if (hash !== user.passwordHash) throw new Error('Incorrect password.');

    // Re-authenticate with Firebase anonymously (just to have a live session).
    await fbAuth.signInAnonymously();
    await setSession(user);
    return user;
  }

  // ── Grant / revoke / update role (admin only) ─────────────────────────────
  async function grantAccess(name, email, role, tempPassword) {
    const admin = await refreshCurrentUser();
    if (!admin || admin.role !== 'admin') throw new Error('Admin only.');

    const normalEmail = email.trim().toLowerCase();
    const existing = await findByEmail(normalEmail);

    if (existing) {
      await saveUserDoc(existing.uid, { role, grantedBy: admin.uid });
      return { ...existing, role, grantedBy: admin.uid };
    }

    // Create new user doc with a fresh anonymous UID placeholder.
    // (They'll get a real UID when they first log in.)
    const hash = await hashPassword(tempPassword);
    const uid  = 'pending_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
    const userDoc = {
      name:         name.trim(),
      email:        normalEmail,
      passwordHash: hash,
      role,
      createdAt:    new Date().toISOString(),
      grantedBy:    admin.uid,
      activeTripId: admin.activeTripId || null,
      tripIds:      admin.activeTripId ? [admin.activeTripId] : [],
    };
    await saveUserDoc(uid, userDoc);

    // Send welcome email if EmailJS is configured
    try {
      if (typeof emailjs !== 'undefined' && EMAILJS_SERVICE_ID && EMAILJS_TEMPLATE_ID) {
        await emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, {
          to_name:       name.trim(),
          to_email:      normalEmail,
          temp_password: tempPassword,
          admin_name:    admin.name,
          role:          role.charAt(0).toUpperCase() + role.slice(1),
          login_url:     window.location.origin + window.location.pathname.replace(/\/[^/]*$/, '/login.html'),
        });
      }
    } catch(emailErr) {
      console.warn('Welcome email failed (non-fatal):', emailErr);
    }

    return { uid, ...userDoc };
  }

  async function revokeAccess(uid) {
    const admin = await refreshCurrentUser();
    if (!admin || admin.role !== 'admin') throw new Error('Admin only.');
    await usersRef().doc(uid).delete();
  }

  async function updateRole(uid, newRole) {
    const admin = await refreshCurrentUser();
    if (!admin || admin.role !== 'admin') throw new Error('Admin only.');
    await saveUserDoc(uid, { role: newRole });
    if (_currentUser && _currentUser.uid === uid) _currentUser.role = newRole;
  }

  // ── Update profile (name + phone) ────────────────────────────────────────
  async function updateProfile(name, phone) {
    const user = await refreshCurrentUser();
    if (!user) throw new Error('Not logged in.');
    await saveUserDoc(user.uid, { name: name.trim(), phone: (phone || '').trim() });
    _currentUser = { ..._currentUser, name: name.trim(), phone: (phone || '').trim() };
  }

  // ── Change password ───────────────────────────────────────────────────────
  async function changePassword(currentPwd, newPwd) {
    const user = await refreshCurrentUser();
    if (!user) throw new Error('Not logged in.');
    const currentHash = await hashPassword(currentPwd);
    if (currentHash !== user.passwordHash) throw new Error('Current password is incorrect.');
    const newHash = await hashPassword(newPwd);
    await saveUserDoc(user.uid, { passwordHash: newHash });
    _currentUser = { ..._currentUser, passwordHash: newHash };
  }


  // ── Trip helpers ──────────────────────────────────────────────────────────
  function getActiveTrip() {
    return _currentUser ? (_currentUser.activeTripId || null) : null;
  }

  async function setActiveTrip(tripId) {
    const user = await refreshCurrentUser();
    if (!user) throw new Error('Not logged in.');
    const tripIds = user.tripIds || [];
    if (tripId && !tripIds.includes(tripId)) tripIds.push(tripId);
    await saveUserDoc(user.uid, { activeTripId: tripId, tripIds });
    _currentUser = { ..._currentUser, activeTripId: tripId, tripIds };
  }

  async function createTrip(name, countries, startDate, endDate, travellers) {
    const user = await refreshCurrentUser();
    if (!user) throw new Error('Not logged in.');
    const tripId = await FireDB.createTrip({ name, countries, startDate, endDate, travellers, createdBy: user.uid });
    const tripIds = [...(user.tripIds || []), tripId];
    await saveUserDoc(user.uid, { activeTripId: tripId, tripIds });
    _currentUser = { ..._currentUser, activeTripId: tripId, tripIds };
    return tripId;
  }

  // ── Data wrappers — pass active trip through to FireDB ────────────────────
  async function getData(key, fallback) {
    return FireDB.load(getActiveTrip(), key, fallback);
  }
  async function saveData(key, val) {
    return FireDB.save(getActiveTrip(), key, val);
  }

  // Legacy no-op stubs kept so old call sites don't break.
  function storageKey(key) { return key; }

  // ── loadUsers (used by renderAccess in itinerary.html) ───────────────────
  async function loadUsersAsync() {
    return loadAllUsers();
  }
  // Synchronous stub for backward-compat — returns cached value if available.
  function loadUsers() {
    console.warn('Auth.loadUsers() is now async — use Auth.loadUsersAsync() instead.');
    return [];
  }

  // ── User chip HTML ────────────────────────────────────────────────────────
  function renderUserChip(containerSelector) {
    const u = getCurrentUser();
    if (!u) return;
    const el = document.querySelector(containerSelector);
    if (!el) return;

    const chip = document.createElement('div');
    chip.className = 'auth-chip';
    chip.innerHTML = `
      <div class="auth-chip-btn" id="auth-chip-btn">
        <div class="auth-avatar">${(u.name||'?').charAt(0).toUpperCase()}</div>
        <span class="auth-name">${(u.name||'').split(' ')[0]}</span>
        <span class="auth-role-badge role-${u.role}">${u.role||''}</span>
        <span class="auth-arrow">▼</span>
      </div>
      <div class="auth-menu" id="auth-menu">
        <div class="auth-menu-header">
          <div style="font-weight:700;font-size:13px">${u.name||''}</div>
          <div style="font-size:11px;color:var(--muted,#8b949e);margin-top:1px">${u.email||''}</div>
        </div>
        ${u.role === 'admin' ? '<a class="auth-menu-item" href="itinerary.html#access">👥 Manage Access</a>' : ''}
        <a class="auth-menu-item" href="trips.html">🗺️ My Trips</a>
        <a class="auth-menu-item" href="profile.html">👤 My Profile</a>
        <div class="auth-menu-item auth-signout" onclick="Auth.logout()">🚪 Sign out</div>
      </div>`;
    el.appendChild(chip);

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

  // ── Chip styles ───────────────────────────────────────────────────────────
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
        backdrop-filter:blur(10px); -webkit-backdrop-filter:blur(10px);
      }
      .auth-chip-btn:hover, .auth-chip-btn.open { background:rgba(255,255,255,0.14); }
      .auth-avatar {
        width:26px; height:26px; border-radius:50%;
        background:#58a6ff; color:#fff;
        font-size:12px; font-weight:700;
        display:flex; align-items:center; justify-content:center; flex-shrink:0;
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
    getCurrentUser, refreshCurrentUser, requireAuth,
    canEdit, isAdmin,
    storageKey, getData, saveData,
    getActiveTrip, setActiveTrip, createTrip,
    grantAccess, revokeAccess, updateRole,
    updateProfile, changePassword,
    loadUsers, loadUsersAsync,
    renderUserChip, injectChipStyles,
  };

  global.Auth = Auth;

})(window);
