import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

// ── Runtime config ──────────────────────────────────────────────────────────────
// Firebase config is stored in localStorage by the user on first visit (Setup screen).
// This lets every user bring their own Firebase project — no shared backend database.
// No env vars needed for Firebase; only VITE_SERVER_URL is baked in at build time.

const STORAGE_KEY = 'cipherchat_firebase_config';

export function getStoredConfig() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); } catch { return null; }
}

export function saveConfig(config) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

export function clearConfig() {
  localStorage.removeItem(STORAGE_KEY);
}

// ── Firebase initialization ─────────────────────────────────────────────────────
// Initialized at module load time from localStorage. If no config exists yet,
// all exports are null — main.jsx will render <Setup /> instead of <App />.

const storedConfig = getStoredConfig();

let auth = null;
let db   = null;
let provider = null;

if (storedConfig) {
  const app = initializeApp(storedConfig);
  auth     = getAuth(app);
  db       = getFirestore(app);
  provider = new GoogleAuthProvider();
}

export { auth, db, provider };
