import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '../src/renderer/App';
import '../src/renderer/styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
