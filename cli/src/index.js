#!/usr/bin/env node
import readline from 'node:readline';
import { io }   from 'socket.io-client';
import dotenv   from 'dotenv';
import { encryptMessage, decryptMessage, loadPrivateKey } from './encrypt.js';
import { initFirebase, signIn, fetchPublicKey, fetchOwnPublicKey, saveMessage, loadHistory, conversationId } from './firebase.js';
import { loadSession, saveSession, clearSession } from './session.js';

dotenv.config();

const SERVER_URL      = process.env.SERVER_URL || 'http://localhost:5000';
const MAX_MESSAGE_LEN = 1024;

// ── Terminal helpers ────────────────────────────────────────────────────────────
const rl  = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
const ask = (prompt) => new Promise((resolve) => rl.question(prompt, resolve));

// Ask for a password without echoing it to the terminal.
// Reads raw keystrokes so the password is never visible on screen.
async function askPassword(prompt) {
  return new Promise((resolve) => {
    const { stdin, stdout } = process;
    stdout.write(prompt);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');

    let password = '';

    function onData(char) {
      switch (char) {
        case '\n':
        case '\r':
        case '\u0004': // Ctrl-D
          stdout.write('\n');
          stdin.setRawMode(false);
          stdin.pause();
          stdin.removeListener('data', onData);
          resolve(password);
          break;
        case '\u0003': // Ctrl-C
          process.exit();
          break;
        case '\u007F': // Backspace
          if (password.length > 0) {
            password = password.slice(0, -1);
            stdout.clearLine(0);
            stdout.cursorTo(0);
            stdout.write(prompt + '*'.repeat(password.length));
          }
          break;
        default:
          password += char;
          stdout.write('*');
      }
    }

    stdin.on('data', onData);
  });
}

const printMessage = (line) => {
  readline.clearLine(process.stdout, 0);
  readline.cursorTo(process.stdout, 0);
  console.log(line);
  rl.prompt(true);
};

// ── Startup ─────────────────────────────────────────────────────────────────────
console.log('=== CipherChat CLI ===\n');

// Handle --reset flag to clear saved session
if (process.argv.includes('--reset')) {
  clearSession();
  console.log('Session cleared. Run again to set up fresh.');
  process.exit(0);
}

// Load or collect session data (everything except password)
let session = loadSession();

if (!session) {
  console.log('First-time setup. You need a Firebase project and a CipherChat account.\n');
  console.log('Paste your Firebase project config JSON (the object from Project Settings > Your apps):');
  const configRaw = (await ask('Config JSON: ')).trim();
  let firebaseConfig;
  try   { firebaseConfig = JSON.parse(configRaw); }
  catch { console.error('Invalid JSON.'); process.exit(1); }

  const email    = (await ask('Firebase account email: ')).trim();
  const username = (await ask('Your CipherChat username: ')).trim().toLowerCase();
  const keyPath  = (await ask('Path to your private key (.pem): ')).trim();

  session = { firebaseConfig, email, username, keyPath };
  saveSession(session);
  console.log(`\nSession saved to ~/.cipherchat/session.json (run with --reset to clear)\n`);
} else {
  console.log(`Logged in as @${session.username}  (--reset to switch accounts)\n`);
}

// Always ask for password — never persisted, input hidden
const password = (await askPassword('Password: ')).trim();
if (!password) { console.error('Password required.'); process.exit(1); }

// Load private key from disk
let privateKey;
try   { privateKey = loadPrivateKey(session.keyPath); }
catch (e) { console.error(`Failed to load private key: ${e.message}`); process.exit(1); }

// Initialise Firebase and sign in
initFirebase(session.firebaseConfig);
let firebaseUser;
try {
  firebaseUser = await signIn(session.email, password);
} catch (e) {
  console.error(`Sign-in failed: ${e.message}`);
  process.exit(1);
}
console.log('Signed in.\n');

// Fetch own public key (needed for double-encrypting sent messages → history)
const ownPublicKey = await fetchOwnPublicKey(firebaseUser.uid);
if (!ownPublicKey) {
  console.error('Your public key is missing from Firestore. Sign in via the browser first.');
  process.exit(1);
}

// Ask who to chat with
const recipient = (await ask('Chat with (@username): ')).trim().toLowerCase();
if (!recipient) { console.error('Recipient required.'); process.exit(1); }
if (recipient === session.username) { console.error('Cannot chat with yourself.'); process.exit(1); }

// Fetch recipient public key via usernames index (unique, immutable)
console.log('\nLooking up recipient…');
let recipientPublicKey;
try   { recipientPublicKey = await fetchPublicKey(recipient); }
catch (e) { console.error(e.message); process.exit(1); }
console.log('Recipient found. End-to-end encryption active.\n');

// Load and display message history from Firestore
const convId = conversationId(session.username, recipient);
try {
  const history = await loadHistory(convId);
  if (history.length > 0) {
    console.log('─── History ───────────────────────────────────────');
    for (const msg of history) {
      // Use correct payload: sender reads their own copy, recipient reads theirs
      const payload = msg.from === session.username && msg.payloadForSender
        ? msg.payloadForSender
        : msg.payloadForRecipient;
      try {
        const text = decryptMessage(payload, privateKey);
        console.log(`[${msg.from}]: ${text}`);
      } catch {
        console.log(`[${msg.from}]: (could not decrypt)`);
      }
    }
    console.log('─── Live ──────────────────────────────────────────\n');
  }
} catch {
  // Non-fatal — proceed without history
}

// ── Socket connection ───────────────────────────────────────────────────────────
console.log(`Connecting to ${SERVER_URL} …`);
const socket = io(SERVER_URL, { reconnectionAttempts: 5, timeout: 5000 });

socket.on('connect', () => {
  console.log(`Connected. Chatting with @${recipient}. Type a message and press Enter.\n`);
  socket.emit('register', session.username);
  rl.setPrompt(`[@${session.username}]: `);
  rl.prompt();
});

socket.on('connect_error', (err) => { console.error(`Connection failed: ${err.message}`); process.exit(1); });
socket.on('disconnect',    (reason) => { console.log(`\nDisconnected: ${reason}`); process.exit(0); });
socket.on('error',         (err) => printMessage(`[server]: ${err.message}`));

// Incoming — decrypt, display, and persist to Firestore
socket.on('message', async ({ from, payload }) => {
  try {
    const text = decryptMessage(payload, privateKey);
    printMessage(`[@${from}]: ${text}`);
    // Persist received message so history is available next session
    saveMessage({
      convId,
      from,
      to: session.username,
      payloadForRecipient: payload,
    }).catch(() => {}); // non-fatal
  } catch {
    printMessage(`[@${from}]: (could not decrypt message)`);
  }
});

// ── Outgoing — encrypt, persist, then relay ─────────────────────────────────────
rl.on('line', async (line) => {
  const text = line.trim().slice(0, MAX_MESSAGE_LEN);
  if (!text) { rl.prompt(); return; }
  if (!socket.connected) { console.error('Not connected.'); rl.prompt(); return; }

  try {
    // Double-encrypt: once for recipient, once for self (so history is readable both ways)
    const payloadForRecipient = encryptMessage(text, recipientPublicKey);
    const payloadForSender    = encryptMessage(text, ownPublicKey);

    // Persist to Firestore before relaying — history survives even if recipient is offline
    await saveMessage({
      convId,
      from:    session.username,
      to:      recipient,
      payloadForRecipient,
      payloadForSender,
    });

    // Relay the recipient's payload via socket for real-time delivery
    socket.emit('message', { from: session.username, to: recipient, payload: payloadForRecipient });
  } catch (e) {
    console.error(`Send failed: ${e.message}`);
  }
  rl.prompt();
});

// ── Graceful exit ───────────────────────────────────────────────────────────────
rl.on('close', () => { console.log('\nGoodbye.'); socket.disconnect(); process.exit(0); });
