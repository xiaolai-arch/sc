import {
  DeckValidationError,
  parseDeck,
  validateDeck,
  type Deck
} from '../../../../src/main/video-notes/deck/schema';

/** A minimal deck that passes every rule; tests mutate one thing at a time. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function validDeckJson(): any {
  return {
    version: 1,
    title: '第一讲 集合',
    sourcePath: 'C:\\courses\\01-集合.mp4',
    durationSeconds: 3725,
    chapters: [
      {
        title: '一、集合与元素',
        start: 0,
        slides: [
          {
            type: 'cover',
            id: 'cover',
            title: '集合',
            subtitle: '第一讲',
            sources: [{ kind: 'video', t: 0 }]
          },
          {
            type: 'points',
            id: 'points',
            title: '三个性质',
            sources: [{ kind: 'video', t: 65 }],
            points: [
              { text: '元素互不相同', source: { kind: 'screen', t: 70 } },
              { text: '元素没有顺序', source: { kind: 'video', t: 80 } }
            ]
          }
        ]
      },
      {
        title: '二、练习',
        start: 1200,
        slides: [
          {
            type: 'quiz',
            id: 'quiz',
            title: '小测',
            sources: [{ kind: 'infer' }],
            question: '1 + 1 等于几？',
            options: ['1', '2'],
            answer: 1,
            explanation: '一加一等于二。'
          }
        ]
      }
    ]
  };
}

function figureDeckJson(): any {
  return {
    version: 1,
    title: '图表一讲',
    sourcePath: 'C:\\courses\\02.mp4',
    durationSeconds: 600,
    chapters: [
      {
        title: '一、图表',
        start: 0,
        slides: [
          {
            type: 'figure',
            id: 'figure',
            title: '这张图说明什么',
            sources: [{ kind: 'screen', t: 30 }],
            frame: 'frames/30000.jpg',
            keepImage: true,
            captions: ['横轴是时间']
          }
        ]
      }
    ]
  };
}

describe('deck schema', () => {
  test('parses a valid deck', () => {
    const deck = parseDeck(validDeckJson());

    expect(deck.title).toBe('第一讲 集合');
    expect(deck.chapters).toHaveLength(2);
    expect(deck.chapters[1]?.slides[0]?.type).toBe('quiz');
  });

  test('reports a source time beyond the video duration with its path', () => {
    const json = validDeckJson();
    json.chapters[0].slides[0].sources[0].t = 9999;

    expect(() => parseDeck(json)).toThrow(
      'chapters[0].slides[0].sources[0].t: time 9999 exceeds duration 3725'
    );
  });

  test('rejects a negative source time', () => {
    const json = validDeckJson();
    json.chapters[0].slides[1].sources[0].t = -5;

    expect(() => parseDeck(json)).toThrow(
      'chapters[0].slides[1].sources[0].t: negative time'
    );
  });

  test('rejects a slide time beyond the video duration', () => {
    const json = validDeckJson();
    json.chapters[0].slides[1].t = 5000;

    expect(() => parseDeck(json)).toThrow(
      'chapters[0].slides[1].t: time 5000 exceeds duration 3725'
    );
  });

  test('accepts a figure slide whose frame exists', () => {
    const deck = parseDeck(figureDeckJson());

    expect(validateDeck(deck, { framePaths: ['frames/30000.jpg'] })).toBe(deck);
  });

  test('rejects a figure slide whose frame is missing', () => {
    const deck = parseDeck(figureDeckJson());

    expect(() => validateDeck(deck, { framePaths: ['frames/other.jpg'] })).toThrow(
      /chapters\[0\]\.slides\[0\]\.frame: frame "frames\/30000\.jpg" does not exist/
    );
    expect(() => validateDeck(deck, { framePaths: ['frames/other.jpg'] })).toThrow(
      DeckValidationError
    );
  });

  test('requires figure frames to live under frames/', () => {
    const json = figureDeckJson();
    json.chapters[0].slides[0].frame = 'C:\\elsewhere\\30000.jpg';

    expect(() => parseDeck(json)).toThrow(/chapters\[0\]\.slides\[0\]\.frame: must be a frames\/\*\.jpg path/);
  });

  test('requires keepImage on figure slides', () => {
    const json = figureDeckJson();
    json.chapters[0].slides[0].keepImage = false;

    expect(() => parseDeck(json)).toThrow(
      'chapters[0].slides[0].keepImage: figure requires keepImage: true'
    );
  });

  test('rejects ext sources that claim the teacher said it', () => {
    const json = validDeckJson();
    const slide = json.chapters[0].slides[1];
    slide.sources = [{ kind: 'ext', title: '牛津词典' }];
    slide.points[0].text = '老师说这个词常考';

    expect(() => parseDeck(json)).toThrow(
      /chapters\[0\]\.slides\[1\]\.points\[0\]\.text: ext source cannot claim video content/
    );
  });

  test('rejects ext sources that claim the video explained it', () => {
    const json = validDeckJson();
    const slide = json.chapters[0].slides[1];
    slide.sources = [{ kind: 'ext' }];
    slide.title = '视频里讲的搭配';

    expect(() => parseDeck(json)).toThrow(
      /chapters\[0\]\.slides\[1\]\.title: ext source cannot claim video content/
    );
  });

  test('allows video phrasing when the page also cites the video', () => {
    const json = validDeckJson();
    const slide = json.chapters[0].slides[1];
    slide.sources = [{ kind: 'ext', title: '牛津词典' }, { kind: 'video', t: 65 }];
    slide.points[0].text = '老师讲的这个词常考';

    expect(() => parseDeck(json)).not.toThrow();
  });

  test('accepts ext metadata without a time', () => {
    const json = validDeckJson();
    json.chapters[1].slides[0].sources = [{ kind: 'ext', title: '牛津词典', page: 12 }];

    const deck = parseDeck(json);
    const source = deck.chapters[1]?.slides[0]?.sources[0];

    expect(source).toEqual({ kind: 'ext', title: '牛津词典', page: 12 });
  });

  test('rejects chapters that are not sorted by start', () => {
    const json = validDeckJson();
    json.chapters[0].start = 500;
    json.chapters[1].start = 100;

    expect(() => parseDeck(json)).toThrow(
      'chapters[1].start: chapters must be sorted by start'
    );
  });

  test('rejects overlong text with the full path', () => {
    const json = validDeckJson();
    json.chapters[0].slides[1].points[1].text = 'x'.repeat(301);

    expect(() => parseDeck(json)).toThrow(
      'chapters[0].slides[1].points[1].text: too big'
    );
  });

  test('rejects empty text', () => {
    const json = validDeckJson();
    json.chapters[0].slides[1].points[0].text = '   ';

    expect(() => parseDeck(json)).toThrow(
      'chapters[0].slides[1].points[0].text: empty'
    );
  });

  test('rejects a quiz answer outside its options', () => {
    const json = validDeckJson();
    json.chapters[1].slides[0].answer = 3;

    expect(() => parseDeck(json)).toThrow(
      'chapters[1].slides[0].answer: answer 3 is out of range for 2 options'
    );
  });

  test('rejects code slides with too many lines', () => {
    const json = validDeckJson();
    json.chapters[1].slides[0] = {
      type: 'code',
      id: 'code',
      title: '示例',
      sources: [{ kind: 'infer' }],
      language: 'ts',
      code: Array.from({ length: 13 }, (_, index) => `line ${index}`).join('\n')
    };

    expect(() => parseDeck(json)).toThrow(/chapters\[1\]\.slides\[0\]\.code: too many lines/);
  });

  test('rejects a deck with an unknown slide type', () => {
    const json = validDeckJson();
    json.chapters[0].slides[0].type = 'notes';

    expect(() => parseDeck(json)).toThrow(DeckValidationError);
  });
});
