# CipherChat — Build Progress

## Project
Hybrid encrypted chat system. Spec: `prompts/CLAUDE.txt`

## Repo
https://github.com/AdityaBhardwaj04/CipherChat  
Main branch: `main`

## Build Order (from spec)
1. Project structure ✅
2. Backend basic server ✅
3. CLI basic connection ✅
4. Web authentication ✅
5. RSA key generation module ✅
6. Encryption utilities (AES + RSA) ⬅ NEXT
7. Message flow
8. Improvements

---

## Completed Steps

### Step 1 — Project Structure
- `backend/`, `cli/`, `frontend/`, `scripts/`, `prompts/` created
- `package.json` in each app dir
- `.gitignore` blocks `*.pem`, `.env`, `package-lock.json`, `settings.local.json`

### Step 2 — Backend Basic Server
**File:** `backend/src/index.js`
- Express + Socket.IO on port 5000 (env: `PORT`)
- `GET /health` → `{ status, timestamp }`
- CORS locked to `CLIENT_ORIGIN`
- Body limit 10kb, Socket.IO buffer 64KB
- `register` event: maps `userId → socketId` in memory
- `message` event: relays encrypted payload verbatim — server never reads it
- SIGTERM graceful shutdown

### Step 3 — CLI Basic Connection
**File:** `cli/src/index.js`
- readline prompts for username + recipient
- Connects to `SERVER_URL` (default `http://localhost:5000`)
- Emits `register` on connect
- Sends `{ from, to, payload: { text } }` — payload shape matches future encrypted envelope
- `printMessage()` clears input line before printing incoming messages
- Handles `connect_error`, `disconnect`, server `error` events

### Step 4 — Firebase Google Authentication
**Files:** `frontend/src/firebase.js`, `frontend/src/App.jsx`, `frontend/src/main.jsx`, `frontend/index.html`, `frontend/vite.config.js`
- Vite + React scaffold
- Firebase env-var validation at startup (throws if any `VITE_FIREBASE_*` missing)
- `signInWithPopup` with `GoogleAuthProvider`
- `ensureUserProfile()` creates Firestore doc `users/{uid}` on first login
- `publicKey: null` placeholder — filled in Step 5

### Step 5 — RSA Key Generation Module
**Files:** `frontend/src/crypto.js`, `frontend/src/App.jsx` (updated)
- `generateKeyPair(uid)`: RSA-OAEP 2048-bit via `window.crypto.subtle`
- Private key stored in **IndexedDB** — never leaves browser
- Public key exported as SPKI PEM → written to Firestore `users/{uid}.publicKey`
- `downloadPrivateKey(uid)`: exports PKCS#8 PEM, triggers browser download
- `hasKeyPair(uid)`: prevents regeneration on re-login
- App auto-generates keys after sign-in, prompts to download on first generation

---

## Step 6 — What to Build Next
**Encryption utilities (AES + RSA)**

### Plan
- `frontend/src/encrypt.js` and `cli/src/encrypt.js` (shared logic, same Web Crypto / node:crypto API)
- `encryptMessage(plaintext, recipientPublicKeyPem)`:
  1. Generate random AES-256-GCM key
  2. Encrypt plaintext with AES-256-GCM → `{ iv, ciphertext, authTag }`
  3. Encrypt AES key with recipient's RSA-OAEP public key → `encryptedKey`
  4. Return `{ iv, encryptedKey, ciphertext }` — this is the `payload` shape the backend relays
- `decryptMessage(payload, privateKey)`:
  1. Decrypt `encryptedKey` with own RSA private key → AES key
  2. Decrypt `ciphertext` with AES-256-GCM using `iv` → plaintext
- CLI needs to load private key from `.pem` file → import via `node:crypto`

### Key constraint
- Frontend uses `window.crypto.subtle`
- CLI uses `node:crypto` (same Web Crypto API in Node 18+)
- Both must produce compatible ciphertext

---

## Tooling / Hooks
- `scripts/push.js`: safe git add/commit/push using `execFileSync` (no shell injection)
- `scripts/fetch-review.js`: fetches latest PR reviewer comment, injects via `SessionStart` hook
- `.claude/settings.json`: `SessionStart` hook → `node scripts/fetch-review.js`
- `.github/workflows/review.yml`: GPT-4.1-mini reviews each PR diff, posts comment

## PR History
| PR | Step | Status |
|----|------|--------|
| #1 | Step 1 review | Merged |
| #2 | Step 2 backend | Merged |
| #6 | Step 3 CLI | Merged |
| #8 | Step 4 Auth | Merged |
| #9 | Step 5 RSA keys | Open — awaiting review |
