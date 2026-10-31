import '@testing-library/jest-dom/vitest';

afterEach(() => {
  if (typeof window !== 'undefined') {
    delete window.studyCoach;
    delete window.studyCoachPrototype;
    document.body.style.overflow = '';
  }
});
