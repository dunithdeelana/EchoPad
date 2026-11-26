import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter';
import './styles.css';
import App from './App';
import { api } from './api';

window.addEventListener('error', (e) => api.log('error', `${e.message} @ ${e.filename}:${e.lineno}`));
window.addEventListener('unhandledrejection', (e) => api.log('error', `unhandled rejection: ${String(e.reason?.stack || e.reason)}`));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
