import { runInNewContext } from 'node:vm';

import {
  DECK_CONTENT_BOTTOM_PX,
  collectOverflows,
  decideRelayout,
  layoutScript,
  type SlideLayout,
  type SlideOverflow
} from '../../../../src/main/video-notes/deck/browser';

function layout(index: number, bottom: number): SlideLayout {
  return { index, bottom };
}

function overflow(index: number, bottom: number, excessPx: number): SlideOverflow {
  return { index, bottom, excessPx };
}

describe('DECK_CONTENT_BOTTOM_PX', () => {
  it('is 656 of the 720px stage, leaving room for the footer', () => {
    expect(DECK_CONTENT_BOTTOM_PX).toBe(656);
  });
});

describe('collectOverflows', () => {
  it('returns nothing when every slide fits', () => {
    expect(collectOverflows([layout(0, 120), layout(1, 655.99)])).toEqual([]);
  });

  it('treats bottom === limit as fitting, and only greater as an overflow', () => {
    expect(collectOverflows([layout(2, DECK_CONTENT_BOTTOM_PX)])).toEqual([]);
    expect(collectOverflows([layout(2, DECK_CONTENT_BOTTOM_PX + 0.01)])).toEqual([
      overflow(2, DECK_CONTENT_BOTTOM_PX + 0.01, 0.01)
    ]);
  });

  it('reports the overrun in pixels, sorted by page index', () => {
    const slides = [layout(3, 760), layout(0, 400), layout(1, 656.5), layout(2, 700)];

    expect(collectOverflows(slides)).toEqual([
      overflow(1, 656.5, 0.5),
      overflow(2, 700, 44),
      overflow(3, 760, 104)
    ]);
  });

  it('accepts a custom limit', () => {
    expect(collectOverflows([layout(0, 500), layout(1, 501)], 500)).toEqual([
      overflow(1, 501, 1)
    ]);
  });

  it('does not leak floating point noise into excessPx', () => {
    expect(collectOverflows([layout(0, 670.35)], 656)[0]?.excessPx).toBe(14.35);
  });
});

describe('decideRelayout', () => {
  const stillOverflowing = [overflow(1, 700, 44)];

  it('is done when nothing overflows, even after the budget is spent', () => {
    expect(decideRelayout([], 0)).toBe('done');
    expect(decideRelayout([], 5, 2)).toBe('done');
  });

  it('retries while the round budget lasts', () => {
    expect(decideRelayout(stillOverflowing, 0)).toBe('retry');
    expect(decideRelayout(stillOverflowing, 1)).toBe('retry');
  });

  it('gives up once round reaches maxRounds (default 2)', () => {
    expect(decideRelayout(stillOverflowing, 2)).toBe('give-up');
    expect(decideRelayout(stillOverflowing, 3)).toBe('give-up');
  });

  it('honours a custom maxRounds', () => {
    expect(decideRelayout(stillOverflowing, 0, 1)).toBe('retry');
    expect(decideRelayout(stillOverflowing, 1, 1)).toBe('give-up');
    expect(decideRelayout(stillOverflowing, 0, 0)).toBe('give-up');
  });
});

describe('layoutScript', () => {
  it('calls __deckLayout and returns its slides as JSON', () => {
    const session = runInNewContext(layoutScript(), {
      window: {
        __deckLayout: () => ({ slides: [{ index: 0, bottom: 400 }, { index: 1, bottom: 700 }] })
      }
    });

    expect(typeof session).toBe('string');
    expect(JSON.parse(session as string)).toEqual({
      slides: [{ index: 0, bottom: 400 }, { index: 1, bottom: 700 }]
    });
  });

  it('throws a readable error when __deckLayout is missing', () => {
    expect(() => runInNewContext(layoutScript(), { window: {} })).toThrow(/__deckLayout/);
    expect(() => runInNewContext(layoutScript(), { window: { __deckLayout: 'nope' } })).toThrow(
      /__deckLayout/
    );
  });

  it('throws when the function returns something without slides', () => {
    expect(() =>
      runInNewContext(layoutScript(), { window: { __deckLayout: () => ({ pages: [] }) } })
    ).toThrow(/slides/);
  });
});
