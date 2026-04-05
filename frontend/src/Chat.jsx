import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { collection, query, where, limit, getDocs } from 'firebase/firestore';
import { db } from './firebase';
import { encryptMessage, decryptMessage } from './encrypt';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:5000';

// Fetch a user's RSA public key from Firestore by their display name.
async function fetchPublicKey(displayName) {
  const q    = query(collection(db, 'users'), where('displayName', '==', displayName), limit(1));
  const snap = await getDocs(q);
  if (snap.empty) throw new Error(`"${displayName}" not found. Have they signed in and generated keys?`);
  const key = snap.docs[0].data().publicKey;
  if (!key) throw new Error(`"${displayName}" has no public key yet.`);
  return key;
}

export default function Chat({ user }) {
  const [recipientInput, setRecipientInput] = useState('');
  const [started, setStarted]     = useState(false);
  const [messages, setMessages]   = useState([]);
  const [input, setInput]         = useState('');
  const [status, setStatus]       = useState('disconnected');
  const [error, setError]         = useState(null);
  const socketRef      = useRef(null);
  const recipientKey   = useRef(null);
  const recipientName  = useRef('');
  const bottomRef      = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Clean up socket on unmount
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

    const socket = io(SERVER_URL, { reconnectionAttempts: 5 });
    socketRef.current = socket;

    socket.on('connect', () => {
      socket.emit('register', user.displayName);
      setStatus('connected');
      setStarted(true);
    });
    socket.on('disconnect', () => setStatus('disconnected'));
    socket.on('connect_error', () => {
      setError('Could not connect to server.');
      setStatus('disconnected');
    });
    socket.on('error', (err) => setError(err.message));

    socket.on('message', async ({ from, payload }) => {
      try {
        const text = await decryptMessage(payload, user.uid);
        setMessages((m) => [...m, { from, text }]);
      } catch {
        setMessages((m) => [...m, { from, text: '(could not decrypt)' }]);
      }
    });
  }

  async function handleSend(e) {
    e.preventDefault();
    const text = input.trim();
    if (!text || !socketRef.current?.connected) return;
    setInput('');
    try {
      const payload = await encryptMessage(text, recipientKey.current);
      socketRef.current.emit('message', {
        from: user.displayName, to: recipientName.current, payload,
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
        <input value={input} onChange={(e) => setInput(e.target.value)}
          placeholder="Type a message…" style={{ flex: 1 }} disabled={status !== 'connected'} />
        <button type="submit" disabled={status !== 'connected'}>Send</button>
      </form>
    </div>
  );
}
