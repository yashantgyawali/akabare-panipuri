/** App entry: global styles, then the hash-routed app. */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/tumlet.css';
import './styles/home.css';
import './styles/lobby.css';
import './styles/table.css';
import './styles/overlays.css';
import './styles/rules.css';
import { App } from './App.tsx';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
