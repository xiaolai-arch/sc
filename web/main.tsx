import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '../src/renderer/App';
import { createMockApi, resetMockData } from './mock-api';
import '../src/renderer/styles.css';

if (!window.studyCoach) {
  window.studyCoach = createMockApi(undefined, { streamPace: 1 });
}

window.studyCoachPrototype = {
  reset: () => {
    resetMockData();
    window.location.reload();
  }
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
