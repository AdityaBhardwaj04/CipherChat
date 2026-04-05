import { useState } from 'react';
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { db } from './firebase';

const USERNAME_RE = /^[a-z0-9_]{3,20}$/;

// Claim a username atomically:
//   1. Check usernames/{username} doesn't exist yet
//   2. Write usernames/{username} = { uid }        ← uniqueness index
//   3. Write users/{uid}.username = username
// If step 2 fails (doc already exists), the username is taken.
async function claimUsername(uid, username) {
  const indexRef = doc(db, 'usernames', username);
  const snap     = await getDoc(indexRef);
  if (snap.exists()) throw new Error('Username already taken.');

  await setDoc(indexRef, { uid });
  await updateDoc(doc(db, 'users', uid), { username });
}

export default function UsernameSetup({ uid, onComplete }) {
  const [value, setValue]   = useState('');
  const [error, setError]   = useState(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    const username = value.trim().toLowerCase();

    if (!USERNAME_RE.test(username)) {
      setError('3–20 characters, lowercase letters, numbers, and underscores only.');
      return;
    }

    setError(null);
    setLoading(true);
    try {
      await claimUsername(uid, username);
      onComplete(username);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ marginTop: '1.5rem' }}>
      <p><strong>Choose a username</strong></p>
      <p style={{ fontSize: '0.85rem', color: '#555' }}>
        This is how other users will find and message you.<br />
        Lowercase letters, numbers, underscores — 3 to 20 characters. Cannot be changed.
      </p>
      {error && <p style={{ color: 'red' }}>{error}</p>}
      <form onSubmit={handleSubmit} style={{ display: 'flex', gap: 8 }}>
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="e.g. aditya04"
          style={{ width: 200 }}
          disabled={loading}
          autoFocus
        />
        <button type="submit" disabled={loading}>
          {loading ? 'Claiming…' : 'Confirm'}
        </button>
      </form>
    </div>
  );
}
