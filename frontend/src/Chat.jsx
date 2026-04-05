import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import {
  collection, doc, query, where, getDoc, getDocs, addDoc, serverTimestamp,
} from 'firebase/firestore';
import { db } from './firebase';
import { encryptMessage, decryptMessage } from './encrypt';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:5000';

// Stable ID for a conversation — same for both participants.
function conversationId(nameA, nameB) {
  return [nameA, nameB].sort().join('::');
}

// Fetch a user's RSA public key from Firestore by their username.
// Uses the usernames/{username} index to resolve uid, then reads users/{uid}.
// Avoids displayName lookup which is not unique and can change.
async function fetchPublicKey(username) {
  const indexSnap = await getDoc(doc(db, 'usernames', username));
  if (!indexSnap.exists()) throw new Error(`"${username}" not found. Have they signed in and chosen a username?`);
  const uid      = indexSnap.data().uid;
  const userSnap = await getDoc(doc(db, 'users', uid));
  const key      = userSnap.data()?.publicKey;
  if (!key) throw new Error(`"${username}" has no public key yet.`);
  return key;
}

// Load and decrypt message history for this conversation from Firestore.
// Each stored message has two encrypted copies:
//   payloadForRecipient — encrypted with the recipient's public key
//   payloadForSender    — encrypted with the sender's own public key
// This lets both parties decrypt history using only their own private key.
async function loadHistory(myUsername, recipientUsername, uid) {
  const convId = conversationId(myUsername, recipientUsername);
  const q      = query(collection(db, 'messages'), where('conversationId', '==', convId));
  const snap   = await getDocs(q);

  const docs = snap.docs
    .map(d => d.data())
    .sort((a, b) => (a.timestamp?.toMillis?.() ?? 0) - (b.timestamp?.toMillis?.() ?? 0));

  const messages = [];
  for (const data of docs) {
    // Sender decrypts their own copy; recipient decrypts theirs.
    // CLI messages only have payloadForRecipient (no sender copy).
    const payload = data.from === myUsername && data.payloadForSender
      ? data.payloadForSender
      : data.payloadForRecipient;
    try {
      const text = await decryptMessage(payload, uid);
      messages.push({ from: data.from, text });
    } catch {
      messages.push({ from: data.from, text: '(could not decrypt)' });
    }
  }
  return messages;
}

export default function Chat({ user, username, ownPublicKey }) {
  const [recipientInput, setRecipientInput] = useState('');
  const [started, setStarted]   = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput]       = useState('');
  const [status, setStatus]     = useState('disconnected');
  const [error, setError]       = useState(null);
  const socketRef     = useRef(null);
  const recipientKey  = useRef(null);
  const recipientName = useRef('');
  const bottomRef     = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => () => socketRef.current?.disconnect(), []);

  async function handleStart(e) {
    e.preventDefault();
    const name = recipientInput.trim();
    if (!name) return;
    setError(null);
    setStatus('connecting');

    try {
      recipientKey.current  = await fetchPublicKey(name);
      recipientName.current = name;
    } catch (err) {
      setError(err.message);
      setStatus('disconnected');
      return;
    }

    // Load encrypted history before opening the socket
    try {
      const history = await loadHistory(username, name, user.uid);
      setMessages(history);
    } catch {
      // Non-fatal — proceed without history
    }

    const socket = io(SERVER_URL, { reconnectionAttempts: 5 });
    socketRef.current = socket;

    socket.on('connect', () => {
      socket.emit('register', username);
      setStatus('connected');
      setStarted(true);
    });
    socket.on('disconnect',    () => setStatus('disconnected'));
    socket.on('connect_error', () => {
      setError('Could not connect to server.');
      setStatus('disconnected');
    });
    socket.on('error', (err) => setError(err.message));

    socket.on('message', async ({ from, payload }) => {
      // Decrypt first — if this fails, show placeholder and bail.
      let text;
      try {
        text = await decryptMessage(payload, user.uid);
      } catch {
        setMessages((m) => [...m, { from, text: '(could not decrypt)' }]);
        return;
      }

      // Show message immediately — don't block display on the Firestore write.
      setMessages((m) => [...m, { from, text }]);

      // Persist incoming message so recipient can read history after refresh.
      // payloadForSender is omitted — CLI senders don't use Firestore.
      // Awaited separately so any Firestore error is visible in the UI rather
      // than silently swallowed (previous .catch(()=>{}) hid the real error).
      try {
        await addDoc(collection(db, 'messages'), {
          conversationId:      conversationId(username, from),
          from,
          to:                  username,
          payloadForRecipient: payload,
          timestamp:           serverTimestamp(),
        });
      } catch (err) {
        setError(`History save failed: ${err.message}`);
      }
    });
  }

  async function handleSend(e) {
    e.preventDefault();
    const text = input.trim();
    if (!text || !socketRef.current?.connected) return;
    if (!ownPublicKey) { setError('Own public key not ready. Please wait a moment.'); return; }
    setInput('');

    try {
      // Encrypt once for recipient, once for self — so both parties can read history
      const [payloadForRecipient, payloadForSender] = await Promise.all([
        encryptMessage(text, recipientKey.current),
        encryptMessage(text, ownPublicKey),
      ]);

      // Persist to Firestore — history available even if recipient is offline
      await addDoc(collection(db, 'messages'), {
        conversationId:    conversationId(username, recipientName.current),
        from:              username,
        to:                recipientName.current,
        payloadForRecipient,
        payloadForSender,
        timestamp:         serverTimestamp(),
      });

      // Relay the recipient's payload via socket for real-time delivery
      socketRef.current.emit('message', {
        from:    username,
        to:      recipientName.current,
        payload: payloadForRecipient,
      });

      setMessages((m) => [...m, { from: 'you', text }]);
    } catch (err) {
      setError(`Send failed: ${err.message}`);
    }
  }

  if (!started) {
    return (
      <form onSubmit={handleStart} style={{ marginTop: '1rem' }}>
        <p><strong>Start a chat</strong></p>
        {error && <p style={{ color: 'red' }}>{error}</p>}
        <input
          value={recipientInput}
          onChange={(e) => setRecipientInput(e.target.value)}
          placeholder="Recipient's Google display name"
          style={{ width: 260, marginRight: 8 }}
        />
        <button type="submit" disabled={status === 'connecting'}>
          {status === 'connecting' ? 'Connecting…' : 'Start chat'}
        </button>
      </form>
    );
  }

  return (
    <div style={{ marginTop: '1rem' }}>
      <p style={{ color: 'grey', fontSize: '0.85rem' }}>
        Chatting with <strong>{recipientName.current}</strong> — end-to-end encrypted
        {status === 'disconnected' && ' — ⚠ disconnected'}
      </p>
      {error && <p style={{ color: 'red', fontSize: '0.85rem' }}>{error}</p>}
      <div style={{ border: '1px solid #ccc', padding: '0.5rem', height: 260, overflowY: 'auto', fontFamily: 'monospace', fontSize: '0.9rem' }}>
        {messages.map((m, i) => (
          <div key={i}><strong>{m.from}</strong>: {m.text}</div>
        ))}
        <div ref={bottomRef} />
      </div>
      <form onSubmit={handleSend} style={{ display: 'flex', marginTop: '0.5rem', gap: 8 }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type a message…"
          style={{ flex: 1 }}
          disabled={status !== 'connected'}
        />
        <button type="submit" disabled={status !== 'connected'}>Send</button>
      </form>
    </div>
  );
}
