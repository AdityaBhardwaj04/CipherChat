import { useState } from 'react';
import { saveConfig } from './firebase';

const REQUIRED = ['apiKey', 'authDomain', 'projectId', 'appId'];

export default function Setup() {
  const [raw, setRaw]     = useState('');
  const [error, setError] = useState(null);

  function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    let config;
    try {
      config = JSON.parse(raw.trim());
    } catch {
      setError('Invalid JSON — paste the full Firebase config object.');
      return;
    }
    const missing = REQUIRED.filter(k => !config[k]);
    if (missing.length) {
      setError(`Missing required fields: ${missing.join(', ')}`);
      return;
    }
    saveConfig(config);
    window.location.reload();
  }

  return (
    <main style={{ fontFamily: 'monospace', padding: '2rem', maxWidth: 540 }}>
      <h1>CipherChat</h1>
      <h2 style={{ fontWeight: 'normal' }}>Connect your Firebase project</h2>
      <p>
        CipherChat stores messages in <em>your own</em> Firebase project —
        no third-party servers ever hold your data.
      </p>
      <ol style={{ lineHeight: 2 }}>
        <li>Go to <strong>console.firebase.google.com</strong> and create a project</li>
        <li>Add a <strong>Web app</strong> to the project</li>
        <li>Enable <strong>Google Sign-in</strong> (Authentication → Sign-in method)</li>
        <li>Enable <strong>Firestore</strong> in test mode</li>
        <li>Copy your app's <code>firebaseConfig</code> object and paste it below</li>
      </ol>
      {error && <p style={{ color: 'red' }}>{error}</p>}
      <form onSubmit={handleSubmit}>
        <textarea
          value={raw}
          onChange={e => setRaw(e.target.value)}
          placeholder={'{\n  "apiKey": "...",\n  "authDomain": "...",\n  "projectId": "...",\n  ...\n}'}
          rows={10}
          style={{ width: '100%', fontFamily: 'monospace', fontSize: '0.85rem', boxSizing: 'border-box' }}
        />
        <button type="submit" style={{ marginTop: '0.5rem' }}>Connect</button>
      </form>
    </main>
  );
}
