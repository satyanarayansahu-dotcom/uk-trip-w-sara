// ─────────────────────────────────────────────────────────────────────────────
//  STEP 1 ── Paste your Firebase project config here.
//  Go to: Firebase Console → Project Settings → Your apps → Web app → Config
// ─────────────────────────────────────────────────────────────────────────────
const firebaseConfig = {
  apiKey: "AIzaSyDrrLe0l7Q9x_1RCCkxILUmnZKGfxmbNos",
  authDomain: "uk-road-trip-df64c.firebaseapp.com",
  projectId: "uk-road-trip-df64c",
  storageBucket: "uk-road-trip-df64c.firebasestorage.app",
  messagingSenderId: "897246611100",
  appId: "1:897246611100:web:135adde9301a9062080f59"
};
// ─────────────────────────────────────────────────────────────────────────────
//  Firebase SDK (loaded from CDN in each HTML page — see instructions below)
//  This file assumes the following scripts are loaded BEFORE it:
//    <script src="https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js"></script>
//    <script src="https://www.gstatic.com/firebasejs/10.12.0/firebase-auth-compat.js"></script>
//    <script src="https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore-compat.js"></script>
//    <script src="firebase-config.js"></script>
//    <script src="auth.js"></script>
// ─────────────────────────────────────────────────────────────────────────────

firebase.initializeApp(firebaseConfig);

const db   = firebase.firestore();
const fbAuth = firebase.auth();

// ─────────────────────────────────────────────────────────────────────────────
//  FireDB — drop-in replacement for Auth.getData / Auth.saveData
//  All itinerary data lives under:  trips/{TRIP_ID}/data/{section}
//  Users live under:  users/{uid}
// ─────────────────────────────────────────────────────────────────────────────
const TRIP_ID = 'uk-road-trip-2026'; // shared trip document — same for all users

const FireDB = {
  // ── Write a section (flights, accom, etc.) ────────────────────────────────
  async save(section, value) {
    await db.collection('trips').doc(TRIP_ID)
      .collection('data').doc(section)
      .set({ value: JSON.stringify(value), updatedAt: new Date().toISOString() });
  },

  // ── Read a section ────────────────────────────────────────────────────────
  async load(section, fallback) {
    const snap = await db.collection('trips').doc(TRIP_ID)
      .collection('data').doc(section).get();
    if (!snap.exists) return fallback ?? null;
    try { return JSON.parse(snap.data().value); } catch { return fallback ?? null; }
  },

  // ── Real-time listener for a section ─────────────────────────────────────
  // Returns an unsubscribe function.  callback(data) fires on every change.
  listen(section, fallback, callback) {
    return db.collection('trips').doc(TRIP_ID)
      .collection('data').doc(section)
      .onSnapshot(snap => {
        if (!snap.exists) { callback(fallback ?? null); return; }
        try { callback(JSON.parse(snap.data().value)); } catch { callback(fallback ?? null); }
      });
  },
};
