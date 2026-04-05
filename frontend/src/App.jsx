import { useEffect, useState } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth';
import { doc, setDoc, getDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db, provider } from './firebase';

// Persist minimal user profile in Firestore on first sign-in.
// Public key will be written here in Step 5 (RSA generation).
async function ensureUserProfile(user) {
  const ref = doc(db, 'users', user.uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, {
      uid:         user.uid,
      displayName: user.displayName,
      email:       user.email,
      photoURL:    user.photoURL,
      publicKey:   null,          // populated in Step 5
      createdAt:   serverTimestamp(),
    });
  }
}

export default function App() {
  const [user, setUser]     = useState(undefined); // undefined = loading
  const [error, setError]   = useState(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (u) {
        try {
          await ensureUserProfile(u);
        } catch (e) {
          setError('Failed to save profile. Check Firestore rules.');
        }
      }
      setUser(u ?? null);
    });
    return unsub;
  }, []);

  const handleSignIn = async () => {
    setError(null);
    try {
      await signInWithPopup(auth, provider);
    } catch (e) {
      setError(e.message);
    }
  };

  const handleSignOut = async () => {
    setError(null);
    try {
      await signOut(auth);
    } catch (e) {
      setError(e.message);
    }
  };

  if (user === undefined) return <p>Loading…</p>;

  return (
    <main style={{ fontFamily: 'monospace', padding: '2rem', maxWidth: 480 }}>
      <h1>CipherChat</h1>

      {error && (
        <p style={{ color: 'red', background: '#fee', padding: '0.5rem', borderRadius: 4 }}>
          {error}
        </p>
      )}

      {user ? (
        <>
          <p>Signed in as <strong>{user.displayName}</strong> ({user.email})</p>
          <p style={{ color: 'grey', fontSize: '0.85rem' }}>UID: {user.uid}</p>
          <p style={{ color: 'orange' }}>
            RSA key pair will be generated here in Step 5.
          </p>
          <button onClick={handleSignOut}>Sign out</button>
        </>
      ) : (
        <>
          <p>Sign in to generate your encrypted identity.</p>
          <button onClick={handleSignIn}>Sign in with Google</button>
        </>
      )}
    </main>
  );
}
