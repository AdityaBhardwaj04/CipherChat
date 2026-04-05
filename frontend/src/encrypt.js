/**
 * CipherChat — browser-side encryption module (Web Crypto API)
 *
 * Payload shape (all fields base64):  { iv, encryptedKey, ciphertext }
 *  - iv:           12-byte AES-GCM nonce
 *  - encryptedKey: AES-256 key encrypted with recipient's RSA-OAEP public key
 *  - ciphertext:   AES-GCM encrypted plaintext (last 16 bytes are the auth tag,
 *                  appended automatically by SubtleCrypto — matches cli/src/encrypt.js)
 *
 * Compatible with cli/src/encrypt.js (node:crypto).
 */

import { loadPrivateKey } from './crypto.js';

// ── Encoding helpers ────────────────────────────────────────────────────────────

function b64(buf) {
  const bytes = new Uint8Array(buf);
  let str = '';
  const CHUNK = 4096;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    str += btoa(String.fromCharCode(...bytes.subarray(i, i + CHUNK)));
  }
  return str;
}

function unb64(s) {
  return Uint8Array.from(atob(s), c => c.charCodeAt(0));
}

// ── Key helpers ─────────────────────────────────────────────────────────────────

async function importRsaPublicKey(pem) {
  const b64str = pem.replace(/-----[^-]+-----/g, '').replace(/\s/g, '');
  const der = Uint8Array.from(atob(b64str), c => c.charCodeAt(0));
  return window.crypto.subtle.importKey(
    'spki', der.buffer,
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    false, ['encrypt'],
  );
}

// ── Public API ──────────────────────────────────────────────────────────────────

/**
 * Encrypt a plaintext string for a recipient.
 * @param {string} plaintext
 * @param {string} recipientPublicKeyPem  SPKI PEM from Firestore
 * @returns {{ iv: string, encryptedKey: string, ciphertext: string }}
 */
export async function encryptMessage(plaintext, recipientPublicKeyPem) {
  // 1. Random AES-256-GCM key + IV
  const aesKey = await window.crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 }, true, ['encrypt'],
  );
  const iv = window.crypto.getRandomValues(new Uint8Array(12));

  // 2. Encrypt plaintext — output includes 16-byte auth tag at the end
  const ciphertext = await window.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    aesKey,
    new TextEncoder().encode(plaintext),
  );

  // 3. Wrap AES key with recipient's RSA public key
  const rawAes = await window.crypto.subtle.exportKey('raw', aesKey);
  const rsaKey  = await importRsaPublicKey(recipientPublicKeyPem);
  const encryptedKey = await window.crypto.subtle.encrypt(
    { name: 'RSA-OAEP' }, rsaKey, rawAes,
  );

  return { iv: b64(iv), encryptedKey: b64(encryptedKey), ciphertext: b64(ciphertext) };
}

/**
 * Decrypt a payload using the current user's private key from IndexedDB.
 * @param {{ iv: string, encryptedKey: string, ciphertext: string }} payload
 * @param {string} uid  Firebase user ID (used to look up key in IndexedDB)
 * @returns {string} plaintext
 */
export async function decryptMessage(payload, uid) {
  const privateKey = await loadPrivateKey(uid);
  if (!privateKey) throw new Error('No private key found in IndexedDB.');

  // 1. Unwrap AES key with own RSA private key
  const rawAes = await window.crypto.subtle.decrypt(
    { name: 'RSA-OAEP' },
    privateKey,
    unb64(payload.encryptedKey),
  );

  // 2. Import AES key
  const aesKey = await window.crypto.subtle.importKey(
    'raw', rawAes, { name: 'AES-GCM' }, false, ['decrypt'],
  );

  // 3. Decrypt — SubtleCrypto verifies the appended auth tag automatically
  const plaintext = await window.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: unb64(payload.iv) },
    aesKey,
    unb64(payload.ciphertext),
  );

  return new TextDecoder().decode(plaintext);
}
