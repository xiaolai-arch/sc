import { formatLocalDate } from '../shared/date';
import type {
  FocusSnapshotInput,
  FocusSnapshotRecord
} from '../shared/ipc';
import type { AppState, JsonStateStore } from './state-store';

/**
 * The single focus-session slot over the JSON state store (iter33 P2b①).
 *
 * The renderer owns the live session; it calls `set` at the state
 * transitions (start / pause / resume / settlement / reset) and `flush` runs
 * once before quit. Ticks never reach this class — the 1s clock stays
 * memory-only, so `state.json` sees exactly the transition writes. The slot
 * is global (one window, one session); the workspace that owned the session
 * travels inside the record so the restore prompt can appear only in its
 * view.
 */
export class FocusSnapshotStore {
  private readonly state: JsonStateStore;

  constructor(state: JsonStateStore) {
    this.state = state;
  }

  /** The persisted snapshot, or null when the slot is empty. */
  async get(): Promise<FocusSnapshotRecord | null> {
    const current = await this.state.read();
    return current.focusSession ?? null;
  }

  /**
   * Writes one transition. `null` clears the slot (dismiss, stale snapshot
   * discarded, or nothing left worth restoring). The local date is stamped
   * here, at write time, so the same-day restore rule reads the truth about
   * when the snapshot was saved.
   */
  async set(input: FocusSnapshotInput | null, now: Date = new Date()): Promise<void> {
    await this.state.update((current: AppState) => {
      const next: AppState = { ...current };
      if (input === null) {
        delete next.focusSession;
        return next;
      }
      next.focusSession = {
        workspaceId: input.workspaceId,
        session: { ...input.session },
        savedAtLocalDate: formatLocalDate(now)
      };
      return next;
    });
  }

  /**
   * The before-quit write. A running session settles against the wall clock —
   * elapsed time since `lastTickAt` is subtracted once — so the snapshot the
   * next launch reads is the pre-exit value, not the value at the last
   * transition (acceptance 18). Paused time is excluded by construction: a
   * paused session keeps its remaining time untouched. A settled session
   * (remaining 0) stays in the slot but fails the restore rule, which is the
   * intended discard.
   */
  async flushForQuit(now: Date = new Date()): Promise<void> {
    // No snapshot, no write: an empty slot must not materialize a state.json
    // of defaults on every clean quit.
    const current = await this.state.read();
    if (!current.focusSession) return;
    await this.state.update((state: AppState) => {
      const snapshot = state.focusSession;
      if (!snapshot) return state;
      const session = snapshot.session;
      const elapsed =
        session.running && Number.isFinite(session.lastTickAt)
          ? Math.max(0, now.getTime() - session.lastTickAt)
          : 0;
      const remainingMs = Math.max(0, session.remainingMs - elapsed);
      return {
        ...state,
        focusSession: {
          ...snapshot,
          session: {
            ...session,
            remainingMs,
            running: remainingMs > 0 && session.running,
            lastTickAt: session.running ? now.getTime() : session.lastTickAt
          },
          savedAtLocalDate: formatLocalDate(now)
        }
      };
    });
  }
}
