#!/usr/bin/env node
import readline from 'readline';
import { io } from 'socket.io-client';
import dotenv from 'dotenv';
import { encryptMessage, decryptMessage, loadPrivateKey } from './encrypt.js';

dotenv.config();

const SERVER_URL       = process.env.SERVER_URL        || 'http://localhost:5000';
const FIREBASE_PROJECT = process.env.FIREBASE_PROJECT_ID;
const MAX_LEN = 32;

// ── Firestore REST lookup ───────────────────────────────────────────────────────
// Queries users collection by displayName to fetch the recipient's RSA public key.
async function fetchPublicKey(displayName) {
  if (!FIREBASE_PROJECT) throw new Error('FIREBASE_PROJECT_ID not set in .env');
  const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents:runQuery`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: 'users' }],
        where: { fieldFilter: {
          field: { fieldPath: 'displayName' },
          op: 'EQUAL',
          value: { stringValue: displayName },
        }},
        limit: 1,
      },
    }),
  });
  const [result] = await res.json();
  const key = result?.document?.fields?.publicKey?.stringValue;
  if (!key) throw new Error(`No public key for "${displayName}". Have they signed in and generated keys?`);
  return key;
}

// ── Terminal helpers ────────────────────────────────────────────────────────────
const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
const ask = (p) => new Promise((r) => rl.question(p, r));
const printMessage = (line) => {
  readline.clearLine(process.stdout, 0);
  readline.cursorTo(process.stdout, 0);
  console.log(line);
  rl.prompt(true);
};

// ── Startup prompts ─────────────────────────────────────────────────────────────
console.log('=== CipherChat CLI ===');

const username = (await ask('Your username (must match your Google display name): ')).trim().slice(0, MAX_LEN);
if (!username) { console.error('Username required.'); process.exit(1); }

const recipient = (await ask('Chat with (display name): ')).trim().slice(0, MAX_LEN);
if (!recipient) { console.error('Recipient required.'); process.exit(1); }
if (recipient === username) { console.error('Cannot chat with yourself.'); process.exit(1); }

const keyPath = (await ask('Path to your private key (.pem): ')).trim();
let privateKey;
try   { privateKey = loadPrivateKey(keyPath); }
catch (e) { console.error(`Failed to load private key: ${e.message}`); process.exit(1); }

console.log('\nLooking up recipient public key…');
let recipientPublicKey;
try   { recipientPublicKey = await fetchPublicKey(recipient); }
catch (e) { console.error(e.message); process.exit(1); }
console.log('Recipient key found. End-to-end encryption active.\n');

// ── Socket connection ───────────────────────────────────────────────────────────
console.log(`Connecting to ${SERVER_URL} …`);
const socket = io(SERVER_URL, { reconnectionAttempts: 5, timeout: 5000 });

socket.on('connect', () => {
  console.log(`Connected. Chatting with [${recipient}]. Type a message and press Enter.\n`);
  socket.emit('register', username);
  rl.setPrompt(`[${username}]: `);
  rl.prompt();
});

socket.on('connect_error', (err) => { console.error(`Connection failed: ${err.message}`); process.exit(1); });
socket.on('disconnect',    (reason) => { console.log(`\nDisconnected: ${reason}`); process.exit(0); });
socket.on('error',         (err) => printMessage(`[server]: ${err.message}`));

// Incoming — decrypt then display
socket.on('message', ({ from, payload }) => {
  try {
    const text = decryptMessage(payload, privateKey);
    printMessage(`[${from}]: ${text}`);
  } catch {
    printMessage(`[${from}]: (could not decrypt message)`);
  }
});

// ── Outgoing — encrypt then send ────────────────────────────────────────────────
rl.on('line', (line) => {
  const text = line.trim().slice(0, 1024);
  if (!text) { rl.prompt(); return; }
  if (!socket.connected) { console.error('Not connected.'); rl.prompt(); return; }

  try {
    const payload = encryptMessage(text, recipientPublicKey);
    socket.emit('message', { from: username, to: recipient, payload });
  } catch (e) {
    console.error(`Encrypt failed: ${e.message}`);
  }
  rl.prompt();
});

// ── Graceful exit ───────────────────────────────────────────────────────────────
rl.on('close', () => { console.log('\nGoodbye.'); socket.disconnect(); process.exit(0); });
