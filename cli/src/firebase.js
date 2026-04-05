/**
 * CipherChat CLI — Firebase SDK wrapper
 *
 * Handles auth (email/password) and all Firestore operations.
 * initFirebase() must be called with the project config before anything else.
 */

import { initializeApp }               from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import {
  getFirestore,
  doc, getDoc, addDoc, getDocs,
  collection, query, where,
  serverTimestamp,
} from 'firebase/firestore';

let auth, db;

// Stable conversation ID — identical for both participants.
export function conversationId(a, b) {
  return [a, b].sort().join('::');
}

export function initFirebase(config) {
  const app = initializeApp(config);
  auth      = getAuth(app);
  db        = getFirestore(app);
}

// Sign in with email + password. Returns the Firebase user object.
export async function signIn(email, password) {
  const { user } = await signInWithEmailAndPassword(auth, email, password);
  return user;
}

// Resolve a username → uid via the usernames index, then fetch the public key.
// Same two-step lookup used by the browser (Chat.jsx fetchPublicKey).
export async function fetchPublicKey(username) {
  const indexSnap = await getDoc(doc(db, 'usernames', username));
  if (!indexSnap.exists()) throw new Error(`"${username}" not found. Have they signed in and chosen a username?`);
  const uid      = indexSnap.data().uid;
  const userSnap = await getDoc(doc(db, 'users', uid));
  const key      = userSnap.data()?.publicKey;
  if (!key) throw new Error(`"${username}" has no public key yet.`);
  return key;
}

// Fetch own public key from Firestore (needed for double-encryption of sent messages).
export async function fetchOwnPublicKey(uid) {
  const snap = await getDoc(doc(db, 'users', uid));
  return snap.data()?.publicKey ?? null;
}

// Persist a message to Firestore.
// payloadForSender is optional — omit when only the recipient can decrypt (legacy/incoming).
export async function saveMessage({ convId, from, to, payloadForRecipient, payloadForSender }) {
  await addDoc(collection(db, 'messages'), {
    conversationId: convId,
    from,
    to,
    payloadForRecipient,
    ...(payloadForSender ? { payloadForSender } : {}),
    timestamp: serverTimestamp(),
  });
}

// Load all messages for a conversation, sorted by timestamp client-side.
// Uses client-side sort (not orderBy) to avoid requiring a composite Firestore index.
export async function loadHistory(convId) {
  const q    = query(collection(db, 'messages'), where('conversationId', '==', convId));
  const snap = await getDocs(q);
  return snap.docs
    .map(d => d.data())
    .sort((a, b) => (a.timestamp?.toMillis?.() ?? 0) - (b.timestamp?.toMillis?.() ?? 0));
}
