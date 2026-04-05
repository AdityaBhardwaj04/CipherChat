#!/usr/bin/env node
import readline from 'readline';
import { io } from 'socket.io-client';
import dotenv from 'dotenv';

dotenv.config();

const SERVER_URL = process.env.SERVER_URL || 'http://localhost:5000';
const MAX_USERNAME_LEN = 32;
const MAX_MESSAGE_LEN  = 1024;

// ── Terminal interface ─────────────────────────────────────────────────────────
const rl = readline.createInterface({
  input:  process.stdin,
  output: process.stdout,
  terminal: true,
});

const ask = (prompt) =>
  new Promise((resolve) => rl.question(prompt, resolve));

// Reprint the input prompt below an incoming message so UX stays clean
const printMessage = (line) => {
  readline.clearLine(process.stdout, 0);
  readline.cursorTo(process.stdout, 0);
  console.log(line);
  rl.prompt(true);
};

// ── Startup ────────────────────────────────────────────────────────────────────
console.log('=== CipherChat CLI ===');

const rawUsername = await ask('Enter username: ');
const username = rawUsername.trim().slice(0, MAX_USERNAME_LEN);

if (!username) {
  console.error('Username cannot be empty.');
  process.exit(1);
}

const recipient = (await ask('Chat with (username): ')).trim().slice(0, MAX_USERNAME_LEN);

if (!recipient) {
  console.error('Recipient cannot be empty.');
  process.exit(1);
}

if (recipient === username) {
  console.error('Cannot chat with yourself.');
  process.exit(1);
}

// ── Socket connection ──────────────────────────────────────────────────────────
console.log(`\nConnecting to ${SERVER_URL} …`);

const socket = io(SERVER_URL, {
  reconnectionAttempts: 5,
  timeout: 5000,
});

socket.on('connect', () => {
  console.log(`Connected. Chatting with [${recipient}]. Type a message and press Enter.\n`);
  socket.emit('register', username);
  rl.setPrompt(`[${username}]: `);
  rl.prompt();
});

socket.on('connect_error', (err) => {
  console.error(`Connection failed: ${err.message}`);
  process.exit(1);
});

socket.on('disconnect', (reason) => {
  console.log(`\nDisconnected: ${reason}`);
  process.exit(0);
});

socket.on('error', (err) => {
  // Server-emitted application errors (e.g. recipient offline)
  printMessage(`[server]: ${err.message}`);
});

// Incoming message from relay server
socket.on('message', ({ from, payload }) => {
  // Step 3: no encryption yet — payload.text is plaintext
  printMessage(`[${from}]: ${payload?.text ?? ''}`);
});

// ── Outgoing messages ──────────────────────────────────────────────────────────
rl.on('line', (line) => {
  const text = line.trim().slice(0, MAX_MESSAGE_LEN);

  if (!text) {
    rl.prompt();
    return;
  }

  if (!socket.connected) {
    console.error('Not connected. Waiting for reconnect …');
    rl.prompt();
    return;
  }

  socket.emit('message', {
    from:    username,
    to:      recipient,
    payload: { text },      // will be replaced with encrypted payload in Step 6
  });

  rl.prompt();
});

// ── Graceful exit on Ctrl+C ────────────────────────────────────────────────────
rl.on('close', () => {
  console.log('\nGoodbye.');
  socket.disconnect();
  process.exit(0);
});
