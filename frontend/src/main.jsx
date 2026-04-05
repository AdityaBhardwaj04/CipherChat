import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { auth } from './firebase';
import App from './App';
import Setup from './Setup';

// If Firebase has not been configured yet (no config in localStorage),
// show the Setup screen. Once the user pastes their Firebase config and
// reloads, auth will be non-null and the full app renders.
createRoot(document.getElementById('root')).render(
  <StrictMode>
    {auth ? <App /> : <Setup />}
  </StrictMode>
);
