import { useEffect, useState } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth';
import { doc, setDoc, getDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db, provider } from './firebase';
import { generateKeyPair, hasKeyPair, downloadPrivateKey } from './crypto';

// Create Firestore profile on first sign-in.
async function ensureUserProfile(user) {
  const ref  = doc(db, 'users', user.uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, {
      uid:         user.uid,
      displayName: user.displayName,
      email:       user.email,
      photoURL:    user.photoURL,
      publicKey:   null,
      createdAt:   serverTimestamp(),
    });
  }
  return snap.data() ?? null;
}

// Generate keys if none exist, then persist public key to Firestore.
async function setupKeys(uid) {
  const alreadyHasKeys = await hasKeyPair(uid);
  if (alreadyHasKeys) return { generated: false };

  const { publicKeyPem } = await generateKeyPair(uid);
  await updateDoc(doc(db, 'users', uid), { publicKey: publicKeyPem });
  return { generated: true, publicKeyPem };
}

export default function App() {
  const [user, setUser]       = useState(undefined);
  const [keyReady, setKeyReady] = useState(false);
  const [keyGenerated, setKeyGenerated] = useState(false);
  const [error, setError]     = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (u) {
        try {
          await ensureUserProfile(u);
          const { generated } = await setupKeys(u.uid);
          setKeyGenerated(generated);
          setKeyReady(true);
        } catch (e) {
          setError(`Setup failed: ${e.message}`);
        }
      } else {
        setKeyReady(false);
        setKeyGenerated(false);
      }
      setUser(u ?? null);
    });
    return unsub;
  }, []);

  const handleSignIn = async () => {
    setError(null);
    setLoading(true);
    try {
      await signInWithPopup(auth, provider);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSignOut = async () => {
    setError(null);
    try { await signOut(auth); } catch (e) { setError(e.message); }
  };

  const handleDownload = async () => {
    setError(null);
    try {
      await downloadPrivateKey(user.uid);
    } catch (e) {
      setError(e.message);
    }
  };

  if (user === undefined) return <p>Loading…</p>;

  return (
    <main style={{ fontFamily: 'monospace', padding: '2rem', maxWidth: 520 }}>
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

          {!keyReady && <p>Generating RSA key pair…</p>}

          {keyReady && keyGenerated && (
            <div style={{ background: '#efffef', padding: '0.75rem', borderRadius: 4, margin: '1rem 0' }}>
              <strong>RSA-2048 key pair generated.</strong>
              <p style={{ margin: '0.5rem 0 0', fontSize: '0.85rem' }}>
                Private key is stored locally in IndexedDB — it never left your browser.
                Download it now to use with the CipherChat CLI.
              </p>
              <button onClick={handleDownload} style={{ marginTop: '0.5rem' }}>
                Download private key (.pem)
              </button>
            </div>
          )}

          {keyReady && !keyGenerated && (
            <p style={{ color: 'green' }}>RSA key pair already exists on this device.</p>
          )}

          <button onClick={handleDownload} style={{ marginRight: '0.5rem' }}>
            Re-download private key
          </button>
          <button onClick={handleSignOut}>Sign out</button>
        </>
      ) : (
        <>
          <p>Sign in to generate your encrypted identity.</p>
          <button onClick={handleSignIn} disabled={loading}>
            {loading ? 'Signing in…' : 'Sign in with Google'}
          </button>
        </>
      )}
    </main>
  );
}
