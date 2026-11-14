import { FakeModelClient } from '../../../../src/main/agent/model-client';
import type { DeckNotes, EnrichCard, FactIssue } from '../../../../src/main/video-notes/deck/content';
import {
  applyContested,
  checkDeck,
  checkMaterial,
  FACTCHECK_PROMPT_VERSION,
  reviseMaterial
} from '../../../../src/main/video-notes/deck/factcheck';
import { DeckStepError } from '../../../../src/main/video-notes/deck/prompts';
import type { Deck } from '../../../../src/main/video-notes/deck/schema';
import type { Transcript } from '../../../../src/main/video-notes/mimo';

function notesWith(titles: readonly string[] = ['第一章', '第二章']): DeckNotes {
  return {
    chapters: titles.map((title, index) => ({
      title,
      start: index * 600,
      blocks: [
        { t: index * 600, text: `${title}的讲解`, source: 'video' },
        { t: index * 600 + 30, text: `${title}的板书`, source: 'screen' }
      ],
      keyPoints: [`${title}要点`]
    }))
  };
}

function card(chapter: string, title: string): EnrichCard {
  return {
    chapter,
    title,
    principle: `${title}的原理`,
    examples: [{ wrong: '错误说法', right: '正确说法' }, { right: '另一个正确说法' }],
    pitfall: '易错点',
    transfer: '迁移方法',
    sources: [{ kind: 'infer' }]
  };
}

function transcriptOf(): Transcript {
  return {
    source: 'lesson.mp4',
    duration: 3600,
    language: 'zh',
    model: 'mimo',
    chars: 12,
    text: '第一章讲解。',
    chunks: [{ start: 0, text: '第一章讲解。' }]
  };
}

function issue(overrides: Partial<FactIssue> = {}): FactIssue {
  return {
    target: 'notes',
    ref: '第一章/1',
    claim: '被质疑的说法',
    problem: '转写原文是「第一章讲解」，与这句矛盾',
    severity: 'error',
    ...overrides
  };
}

/** A deck whose slides are plain `points` pages with the given ids. */
function deckWith(ids: readonly string[]): Deck {
  return {
    version: 1,
    title: '第一讲',
    sourcePath: 'C:\\courses\\lesson.mp4',
    durationSeconds: 3600,
    chapters: [
      {
        title: '一、开始',
        start: 0,
        slides: ids.map((id) => ({
          type: 'points' as const,
          id,
          title: `页 ${id}`,
          sources: [{ kind: 'video' as const, t: 10 }],
          points: [{ text: '要点', source: { kind: 'video' as const, t: 10 } }]
        }))
      }
    ]
  };
}

describe('checkMaterial', () => {
  it('parses issues and asks for transcript evidence', async () => {
    const client = new FakeModelClient([
      JSON.stringify({
        issues: [
          issue(),
          issue({ target: 'card', ref: '某张卡片', severity: 'warn' }),
          issue({ target: 'deck', ref: '不该出现在这一步' })
        ]
      })
    ]);

    const result = await checkMaterial({
      client,
      notes: notesWith(),
      cards: [card('第一章', '某张卡片')],
      transcript: transcriptOf()
    });

    expect(result.issues).toHaveLength(2);
    expect(result.issues.map((item) => item.target)).toEqual(['notes', 'card']);
    expect(result.issues[1].severity).toBe('warn');
    const prompt = client.calls[0].messages[0].content;
    expect(prompt).toContain('引用转写的原文');
    expect(prompt).toContain('宁可漏报，也不要编造错误');
    expect(prompt).toContain('章节标题/段落序号');
    expect(client.calls[0].noTools).toBe(true);
  });

  it('is a fresh call: the prompt carries the material, not prior conversation', async () => {
    const client = new FakeModelClient([JSON.stringify({ issues: [] })]);

    await checkMaterial({
      client,
      notes: notesWith(['第一章']),
      cards: [],
      transcript: transcriptOf()
    });

    expect(client.calls[0].messages).toHaveLength(1);
    expect(client.calls[0].messages[0].role).toBe('user');
  });
});

describe('reviseMaterial', () => {
  it('returns validated notes and cards, listing the issues in the prompt', async () => {
    const notes = notesWith();
    const revisedNotes = notesWith();
    revisedNotes.chapters[0].blocks[0].text = '按转写改正后的说法';
    const revisedCards = [card('第一章', '修订后的卡片')];
    const client = new FakeModelClient([
      JSON.stringify({ notes: revisedNotes, cards: revisedCards })
    ]);

    const result = await reviseMaterial({
      client,
      notes,
      cards: [card('第一章', '原卡片')],
      issues: [issue({ ref: '第一章/1' })],
      transcript: transcriptOf()
    });

    expect(result.notes.chapters[0].blocks[0].text).toBe('按转写改正后的说法');
    expect(result.cards.map((item) => item.title)).toEqual(['修订后的卡片']);
    expect(client.calls[0].messages[0].content).toContain('第一章/1');
  });

  it('retries once when the chapter titles drift, then fails the step', async () => {
    const wrong = notesWith(['第一章', '改名了']);
    const client = new FakeModelClient([
      JSON.stringify({ notes: wrong, cards: [] }),
      JSON.stringify({ notes: wrong, cards: [] })
    ]);

    await expect(
      reviseMaterial({
        client,
        notes: notesWith(),
        cards: [],
        issues: [issue()],
        transcript: transcriptOf()
      })
    ).rejects.toBeInstanceOf(DeckStepError);
    expect(client.calls).toHaveLength(2);
    expect(client.calls[1].messages[0].content).toContain('上一次的回答无法使用');
  });

  it('accepts a first bad answer corrected on the retry', async () => {
    const good = notesWith();
    const client = new FakeModelClient([
      JSON.stringify({ notes: notesWith(['别的章节']), cards: [] }),
      JSON.stringify({ notes: good, cards: [] })
    ]);

    const result = await reviseMaterial({
      client,
      notes: notesWith(),
      cards: [],
      issues: [issue()],
      transcript: transcriptOf()
    });

    expect(result.notes.chapters.map((chapter) => chapter.title)).toEqual(['第一章', '第二章']);
    expect(client.calls).toHaveLength(2);
  });
});

describe('checkDeck', () => {
  it('returns the revised deck and the remaining issues', async () => {
    const original = deckWith(['a', 'b']);
    const revised = deckWith(['a', 'b']);
    revised.chapters[0].slides[0].title = '改正后的标题';
    const client = new FakeModelClient([
      JSON.stringify({ issues: [issue({ target: 'deck', ref: 'a' })], deck: revised })
    ]);

    const result = await checkDeck({ client, deck: original, notes: notesWith() });

    expect(result.deck.chapters[0].slides[0].title).toBe('改正后的标题');
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].ref).toBe('a');
    expect(client.calls).toHaveLength(1);
    const prompt = client.calls[0].messages[0].content;
    expect(prompt).toContain('已经核查过的笔记');
  });

  it('keeps the original deck when both revisions are invalid', async () => {
    const original = deckWith(['a']);
    const broken = { issues: [issue({ target: 'deck', ref: 'a' })], deck: { version: 1, title: '' } };
    const client = new FakeModelClient([JSON.stringify(broken), JSON.stringify(broken)]);

    const result = await checkDeck({ client, deck: original, notes: notesWith() });

    expect(result.deck).toEqual(original);
    expect(result.issues).toHaveLength(1);
    expect(client.calls).toHaveLength(2);
    expect(client.calls[1].messages[0].content).toContain('上一次的回答无法使用');
  });

  it('checks slides against the notes, not the transcript', async () => {
    const client = new FakeModelClient([
      JSON.stringify({ issues: [], deck: deckWith(['a']) })
    ]);

    await checkDeck({ client, deck: deckWith(['a']), notes: notesWith(['第一章']) });

    const prompt = client.calls[0].messages[0].content;
    expect(prompt).toContain('## 笔记（已核查）');
    expect(prompt).not.toContain('## 转写');
    expect(prompt).toContain('status 设为 "contested"');
  });
});

describe('applyContested', () => {
  it('marks exactly the slides named by error issues, on a new deck', () => {
    const deck = deckWith(['a', 'b', 'c']);
    const issues = [
      issue({ target: 'deck', ref: 'a', severity: 'error' }),
      issue({ target: 'deck', ref: 'b', severity: 'warn' }),
      issue({ target: 'deck', ref: 'missing', severity: 'error' })
    ];

    const result = applyContested(deck, issues);
    const slides = result.chapters[0].slides;

    expect(result).not.toBe(deck);
    expect(slides[0].status).toBe('contested');
    expect(slides[1].status).toBeUndefined();
    expect(slides[2].status).toBeUndefined();
    // The input deck is untouched.
    expect(deck.chapters[0].slides[0].status).toBeUndefined();
  });

  it('trims the reference before matching', () => {
    const result = applyContested(deckWith(['a']), [issue({ target: 'deck', ref: ' a ' })]);
    expect(result.chapters[0].slides[0].status).toBe('contested');
  });

  it('exports a prompt version', () => {
    expect(FACTCHECK_PROMPT_VERSION).toBeGreaterThan(0);
  });
});
