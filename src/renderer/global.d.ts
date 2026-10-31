import type { StudyCoachApi } from '../shared/ipc';

declare global {
  interface Window {
    studyCoach?: StudyCoachApi;
    studyCoachPrototype?: { reset(): void };
  }
}

export {};
