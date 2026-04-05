/**
 * CipherChat — client-side RSA key generation module
 *
 * Rules:
 *  - Private key NEVER leaves the browser automatically
 *  - Only public key (SPKI/PEM) is shared with Firestore
 *  - Private key is stored in IndexedDB (CryptoKey object)
 *  - User may explicitly download private key as .pem for CLI use
 *
 * NOTE on extractable:true — the spec requires a .pem download for CLI use,
 * so the private key must be extractable. This is a deliberate trade-off:
 * export only happens on explicit user action (with a confirmation dialog in
 * the UI). XSS risk is mitigated by CSP headers at the hosting layer.
 * Firestore security rules must restrict publicKey writes to the owning uid only.
 */

const DB_NAME    = 'cipherchat-keys';
const DB_VERSION = 1;
const STORE_NAME = 'privateKeys';

// ── IndexedDB helpers ──────────────────────────────────────────────────────────

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      e.target.result.createObjectStore(STORE_NAME);
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror   = () => reject(req.error);
  });
}

async function savePrivateKey(uid, cryptoKey) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE_NAME, 'readwrite');
    const req = tx.objectStore(STORE_NAME).put(cryptoKey, uid);
    req.onsuccess = () => resolve();
    req.onerror   = () => reject(req.error);
  });
}

async function loadPrivateKey(uid) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(uid);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror   = () => reject(req.error);
  });
}

// ── Encoding helpers ───────────────────────────────────────────────────────────

function bufferToPem(buffer, label) {
  // Chunked encoding avoids spread-operator argument limit for large keys.
  const bytes = new Uint8Array(buffer);
  let b64 = '';
  const CHUNK = 4096;
  for (let i = 0; i < bytes.byteLength; i += CHUNK) {
    b64 += btoa(String.fromCharCode(...bytes.subarray(i, i + CHUNK)));
  }
  const lines = b64.match(/.{1,64}/g).join('\n');
  return `-----BEGIN ${label}-----\n${lines}\n-----END ${label}-----\n`;
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Generate a 2048-bit RSA-OAEP key pair.
 * Returns { publicKeyPem } — private key is stored in IndexedDB only.
 */
export async function generateKeyPair(uid) {
  const keyPair = await window.crypto.subtle.generateKey(
    {
      name:           'RSA-OAEP',
      modulusLength:  2048,
      publicExponent: new Uint8Array([0x01, 0x00, 0x01]), // 65537
      hash:           'SHA-256',
    },
    true,                      // extractable — needed for .pem export
    ['encrypt', 'decrypt'],
  );

  // Export public key → SPKI → PEM  (safe to share)
  const spki         = await window.crypto.subtle.exportKey('spki', keyPair.publicKey);
  const publicKeyPem = bufferToPem(spki, 'PUBLIC KEY');

  // Store private key in IndexedDB — stays on this device
  await savePrivateKey(uid, keyPair.privateKey);

  return { publicKeyPem };
}

/**
 * Check whether a key pair already exists for this user in IndexedDB.
 */
export async function hasKeyPair(uid) {
  const key = await loadPrivateKey(uid);
  return key !== null;
}

/**
 * Export private key as PKCS#8 PEM and trigger a browser download.
 * This is the one-time export for CLI use — user is responsible for keeping it safe.
 */
export async function downloadPrivateKey(uid) {
  const privateKey = await loadPrivateKey(uid);
  if (!privateKey) throw new Error('No private key found for this user.');

  const pkcs8 = await window.crypto.subtle.exportKey('pkcs8', privateKey);
  const pem   = bufferToPem(pkcs8, 'PRIVATE KEY');

  const blob = new Blob([pem], { type: 'application/x-pem-file' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `cipherchat-private-${uid.slice(0, 8)}.pem`;
  a.click();
  URL.revokeObjectURL(url);
}
