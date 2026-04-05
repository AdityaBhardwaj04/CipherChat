/**
 * CipherChat — CLI encryption module (node:crypto)
 *
 * Payload shape (all fields base64):  { iv, encryptedKey, ciphertext }
 *  - iv:           12-byte AES-GCM nonce
 *  - encryptedKey: AES-256 key encrypted with recipient's RSA-OAEP public key
 *  - ciphertext:   AES-GCM encrypted text with 16-byte auth tag appended
 *                  (matches Web Crypto layout in frontend/src/encrypt.js)
 *
 * Compatible with frontend/src/encrypt.js (Web Crypto API).
 * Requires Node.js 18+ (node:crypto exposes the Web Crypto-compatible API).
 */

import {
  randomBytes,
  createCipheriv,
  createDecipheriv,
  publicEncrypt,
  privateDecrypt,
  createPublicKey,
  createPrivateKey,
} from 'node:crypto';
import { readFileSync } from 'node:fs';

// ── Key helpers ─────────────────────────────────────────────────────────────────

/**
 * Load a PKCS#8 PEM private key from disk and validate it meets minimum security requirements.
 * @param {string} pemPath  Path to the .pem file downloaded from the web app
 * @returns {KeyObject}
 */
export function loadPrivateKey(pemPath) {
  const pem = readFileSync(pemPath, 'utf8');
  const key = createPrivateKey(pem);
  const { modulusLength } = key.asymmetricKeyDetails ?? {};
  if (!modulusLength || modulusLength < 2048) {
    throw new Error(`RSA key too weak: ${modulusLength ?? 'unknown'} bits. Minimum is 2048.`);
  }
  return key;
}

// ── Public API ──────────────────────────────────────────────────────────────────

/**
 * Encrypt a plaintext string for a recipient.
 * @param {string} plaintext
 * @param {string} recipientPublicKeyPem  SPKI PEM from Firestore
 * @returns {{ iv: string, encryptedKey: string, ciphertext: string }}
 */
export function encryptMessage(plaintext, recipientPublicKeyPem) {
  // 1. Random AES-256-GCM key + IV
  const aesKey = randomBytes(32);
  const iv     = randomBytes(12);

  // 2. Encrypt plaintext, then append auth tag — matches Web Crypto layout
  const cipher = createCipheriv('aes-256-gcm', aesKey, iv);
  const ciphertext = Buffer.concat([
    cipher.update(Buffer.from(plaintext, 'utf8')),
    cipher.final(),
    cipher.getAuthTag(), // 16 bytes appended so layout matches SubtleCrypto
  ]);

  // 3. Wrap AES key with recipient's RSA-OAEP public key
  const publicKey    = createPublicKey(recipientPublicKeyPem);
  const encryptedKey = publicEncrypt(
    { key: publicKey, oaepHash: 'sha256' },
    aesKey,
  );

  return {
    iv:           iv.toString('base64'),
    encryptedKey: encryptedKey.toString('base64'),
    ciphertext:   ciphertext.toString('base64'),
  };
}

/**
 * Decrypt a payload using a private key loaded from a .pem file.
 * @param {{ iv: string, encryptedKey: string, ciphertext: string }} payload
 * @param {import('node:crypto').KeyObject} privateKey  From loadPrivateKey()
 * @returns {string} plaintext
 */
export function decryptMessage(payload, privateKey) {
  // 1. Unwrap AES key with own RSA private key
  const aesKey = privateDecrypt(
    { key: privateKey, oaepHash: 'sha256' },
    Buffer.from(payload.encryptedKey, 'base64'),
  );

  // 2. Split auth tag (last 16 bytes) from ciphertext, then decrypt
  const ciphertextWithTag = Buffer.from(payload.ciphertext, 'base64');
  const authTag    = ciphertextWithTag.subarray(-16);
  const ciphertext = ciphertextWithTag.subarray(0, -16);
  const iv         = Buffer.from(payload.iv, 'base64');

  const decipher = createDecipheriv('aes-256-gcm', aesKey, iv);
  decipher.setAuthTag(authTag);

  return Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString('utf8');
}
