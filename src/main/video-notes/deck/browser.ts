/**
 * Pure helpers for the deck layout step. The hidden `BrowserWindow` that
 * actually loads a deck and calls `window.__deckLayout()` lives in
 * `src/main/deck-browser.ts`; everything here is plain Node so the layout
 * rules can be tested without Electron.
 */

/** One slide's lowest visible content edge, in CSS pixels on the 1280x720 stage. */
export interface SlideLayout {
  index: number;
  bottom: number;
}

/** A slide whose content runs past the printable area, with the overrun. */
export interface SlideOverflow {
  index: number;
  bottom: number;
  excessPx: number;
}

/**
 * Content must end by 656px on the 720px stage: the remaining 64px are the
 * bottom padding plus the footer band, so the source badges stay readable.
 * This is the same limit as video-md-ppt's `check_slides.py`, and the design
 * forbids shrinking type to make a slide fit (doc 4.4 and requirement 9.3).
 */
export const DECK_CONTENT_BOTTOM_PX = 656;

/** Matches the 2 decimals `__deckLayout()` reports, so 44.000000001 stays 44. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * The slides whose bottom edge is past the limit, sorted by page index.
 * `bottom === limit` is inside the page; only strictly greater is an overflow.
 */
export function collectOverflows(
  slides: SlideLayout[],
  limitPx: number = DECK_CONTENT_BOTTOM_PX
): SlideOverflow[] {
  return slides
    .filter((slide) => slide.bottom > limitPx)
    .map((slide) => ({
      index: slide.index,
      bottom: slide.bottom,
      excessPx: round2(slide.bottom - limitPx)
    }))
    .sort((left, right) => left.index - right.index);
}

export type RelayoutDecision = 'done' | 'retry' | 'give-up';

/**
 * Decides what to do after one measurement. `round` is the number of
 * correction passes already done, so with the default `maxRounds = 2` a
 * slide may be re-composed twice: after that, keeping the page and reporting
 * the overflow is better than looping forever.
 */
export function decideRelayout(
  overflows: SlideOverflow[],
  round: number,
  maxRounds = 2
): RelayoutDecision {
  if (overflows.length === 0) return 'done';
  return round < maxRounds ? 'retry' : 'give-up';
}

/**
 * The exact `executeJavaScript` source for measuring a loaded deck. The
 * result is stringified because the answer crosses the renderer/main
 * boundary, and a missing `__deckLayout` becomes a readable, localized error
 * instead of Electron's generic "Script failed to execute".
 */
export function layoutScript(): string {
  return `(() => {
  if (typeof window.__deckLayout !== 'function') {
    throw new Error('课件页面没有加载完成，找不到 window.__deckLayout()，无法测量版面');
  }
  const layout = window.__deckLayout();
  if (!layout || !Array.isArray(layout.slides)) {
    throw new Error('课件版面测量没有返回 slides 列表');
  }
  return JSON.stringify({ slides: layout.slides });
})()`;
}
