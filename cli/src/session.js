/**
 * CipherChat CLI — session persistence
 *
 * Saves non-secret session data (Firebase config, email, username, key path)
 * to ~/.cipherchat/session.json so users don't re-enter them on every run.
 * Passwords are never saved — entered once per session and used only for auth.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { join }    from 'node:path';

const SESSION_DIR  = join(homedir(), '.cipherchat');
const SESSION_FILE = join(SESSION_DIR, 'session.json');

export function loadSession() {
  if (!existsSync(SESSION_FILE)) return null;
  try { return JSON.parse(readFileSync(SESSION_FILE, 'utf8')); } catch { return null; }
}

export function saveSession(session) {
  if (!existsSync(SESSION_DIR)) mkdirSync(SESSION_DIR, { recursive: true });
  writeFileSync(SESSION_FILE, JSON.stringify(session, null, 2), 'utf8');
}

export function clearSession() {
  if (existsSync(SESSION_FILE)) unlinkSync(SESSION_FILE);
}
