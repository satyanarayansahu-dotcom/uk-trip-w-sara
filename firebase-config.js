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

const db     = firebase.firestore();
const fbAuth = firebase.auth();

// ─────────────────────────────────────────────────────────────────────────────
//  EmailJS — for welcome emails when admin invites a user.
//  Sign up free at https://www.emailjs.com (200 emails/month)
//  Then paste your values below.
// ─────────────────────────────────────────────────────────────────────────────
const EMAILJS_PUBLIC_KEY  = 'yelB0Kh2mKM8h75OI';
const EMAILJS_SERVICE_ID  = 'service_607fd7k';
const EMAILJS_TEMPLATE_ID = 'template_2zj8iud';

// ─────────────────────────────────────────────────────────────────────────────
//  OCR.space — free OCR for flight ticket extraction.
//  Free API key (25k req/month): https://ocr.space/ocrapi/freekey
//  Replace 'helloworld' with your own key for higher limits.
// ─────────────────────────────────────────────────────────────────────────────
const OCR_SPACE_API_KEY = 'helloworld';

// ─────────────────────────────────────────────────────────────────────────────
//  Super User — email used to identify the superuser account.



//  Trip data:  trips/{tripId}/data/{section}
//  Trip meta:  trips/{tripId}/meta
//  Users:      users/{uid}
// ─────────────────────────────────────────────────────────────────────────────

const FireDB = {
  // ── Write a section (flights, accom, etc.) ────────────────────────────────
  async save(tripId, section, value) {
    if (!tripId) throw new Error('No active trip.');
    await db.collection('trips').doc(tripId)
      .collection('data').doc(section)
      .set({ value: JSON.stringify(value), updatedAt: new Date().toISOString() });
  },

  // ── Read a section ────────────────────────────────────────────────────────
  async load(tripId, section, fallback) {
    if (!tripId) return fallback ?? null;
    const snap = await db.collection('trips').doc(tripId)
      .collection('data').doc(section).get();
    if (!snap.exists) return fallback ?? null;
    try { return JSON.parse(snap.data().value); } catch { return fallback ?? null; }
  },

  // ── Real-time listener for a section ─────────────────────────────────────
  listen(tripId, section, fallback, callback) {
    if (!tripId) { callback(fallback ?? null); return () => {}; }
    return db.collection('trips').doc(tripId)
      .collection('data').doc(section)
      .onSnapshot(snap => {
        if (!snap.exists) { callback(fallback ?? null); return; }
        try { callback(JSON.parse(snap.data().value)); } catch { callback(fallback ?? null); }
      });
  },

  // ── Create a new trip ─────────────────────────────────────────────────────
  async createTrip(meta) {
    const ref = db.collection('trips').doc();
    await ref.set({ meta: { ...meta, createdAt: new Date().toISOString() } });
    return ref.id;
  },

  // ── Load trip metadata ────────────────────────────────────────────────────
  async loadTripMeta(tripId) {
    const snap = await db.collection('trips').doc(tripId).get();
    if (!snap.exists) return null;
    return { tripId, ...snap.data().meta };
  },

  // ── List all trips for a user (by tripIds array) ──────────────────────────
  async listUserTrips(tripIds) {
    if (!tripIds || !tripIds.length) return [];
    const results = await Promise.all(tripIds.map(id => FireDB.loadTripMeta(id)));
    return results.filter(Boolean);
  },
};
