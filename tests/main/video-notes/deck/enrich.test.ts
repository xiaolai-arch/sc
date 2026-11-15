import { FakeModelClient } from '../../../../src/main/agent/model-client';
import type { DeckNotes, EnrichCard, Outline } from '../../../../src/main/video-notes/deck/content';
import {
  buildEnrichment,
  ENRICH_MAX_CARDS,
  ENRICH_PROMPT_VERSION,
  ENRICH_SPLIT_THRESHOLD
} from '../../../../src/main/video-notes/deck/enrich';
import { DECK_MODEL_TIMEOUT_MS, DeckStepError } from '../../../../src/main/video-notes/deck/prompts';

/** Notes and outline share their chapter titles; the enrich step keys on them. */
function outlineWith(titles: readonly string[]): Outline {
  return {
    chapters: titles.map((title, index) => ({
      title,
      start: index * 600,
      end: (index + 1) * 600,
      points: [`${title}的知识点`]
    }))
  };
}

function notesWith(titles: readonly string[]): DeckNotes {
  return {
    chapters: titles.map((title, index) => ({
      title,
      start: index * 600,
      blocks: [{ t: index * 600, text: `${title}的讲解内容`, source: 'screen' }],
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
    pitfall: '这里最容易出错',
    transfer: '换一道题也这样判断',
    sources: [{ kind: 'infer' }]
  };
}

function answer(cards: readonly EnrichCard[]): string {
  return JSON.stringify({ cards });
}

function options(client: FakeModelClient, titles: readonly string[]) {
  return {
    client,
    notes: notesWith(titles),
    outline: outlineWith(titles)
  };
}

describe('buildEnrichment', () => {
  it('exports a prompt version', () => {
    expect(ENRICH_PROMPT_VERSION).toBeGreaterThan(0);
  });

  it('asks for cards in a single call when the outline is short', async () => {
    const client = new FakeModelClient([answer([card('第一章', '结论甲'), card('第二章', '结论乙')])]);
    const result = await buildEnrichment(options(client, ['第一章', '第二章']));

    expect(result.cards).toHaveLength(2);
    expect(client.calls).toHaveLength(1);
    expect(client.calls[0].noTools).toBe(true);
    expect(client.calls[0].timeoutMs).toBe(DECK_MODEL_TIMEOUT_MS);
    const prompt = client.calls[0].messages[0].content;
    expect(prompt).toContain('「第一章」');
    expect(prompt).toContain('「第二章」');
    expect(prompt).toContain('易错点');
    expect(prompt).toContain('迁移');
    expect(prompt).toContain('扩展');
    // The cards explain visible material; nothing may be attributed to speech.
    expect(prompt).toContain('没有语音');
    expect(prompt).toContain('老师说');
    expect(prompt).toContain('不要使用 {"kind":"video"}');
  });

  it('strips video sources and drops cards left without any source', async () => {
    const withVideo: EnrichCard = {
      ...card('第一章', '带视频来源'),
      sources: [{ kind: 'video', t: 10 }, { kind: 'screen', t: 20 }]
    };
    const withoutSource: EnrichCard = {
      ...card('第一章', '只有视频来源'),
      sources: [{ kind: 'video', t: 30 }]
    };
    const client = new FakeModelClient([answer([withVideo, withoutSource])]);

    const result = await buildEnrichment(options(client, ['第一章', '第二章']));

    expect(result.cards.map((item) => item.title)).toEqual(['带视频来源']);
    expect(result.cards[0]?.sources).toEqual([{ kind: 'screen', t: 20 }]);
  });

  it('splits into two calls above the chapter threshold and merges the cards', async () => {
    const titles = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛'];
    expect(titles.length).toBeGreaterThan(ENRICH_SPLIT_THRESHOLD);
    const client = new FakeModelClient([
      answer([card('甲', '前半结论')]),
      answer([card('戊', '后半结论')])
    ]);

    const result = await buildEnrichment(options(client, titles));

    expect(client.calls).toHaveLength(2);
    expect(result.cards.map((item) => item.title)).toEqual(['前半结论', '后半结论']);
    // The first call only sees its half of the outline.
    expect(client.calls[0].messages[0].content).toContain('「甲」');
    expect(client.calls[0].messages[0].content).not.toContain('「戊」');
    expect(client.calls[1].messages[0].content).toContain('「戊」');
  });

  it('does not split at exactly the threshold', async () => {
    const titles = ['一', '二', '三', '四', '五', '六'];
    expect(titles.length).toBe(ENRICH_SPLIT_THRESHOLD);
    const client = new FakeModelClient([answer([card('一', '结论')])]);

    await buildEnrichment(options(client, titles));

    expect(client.calls).toHaveLength(1);
  });

  it('drops cards whose chapter is not an outline title', async () => {
    const client = new FakeModelClient([
      answer([card('第一章', '留下的'), card('不存在的章节', '丢掉的')])
    ]);

    const result = await buildEnrichment(options(client, ['第一章', '第二章']));

    expect(result.cards.map((item) => item.title)).toEqual(['留下的']);
    expect(client.calls).toHaveLength(1);
  });

  it('deduplicates cards by normalized title', async () => {
    const client = new FakeModelClient([
      answer([card('第一章', '同一个结论'), card('第二章', '同一个 结论'), card('第一章', '另一个')])
    ]);

    const result = await buildEnrichment(options(client, ['第一章', '第二章']));

    expect(result.cards.map((item) => item.title)).toEqual(['同一个结论', '另一个']);
  });

  it('caps the merged result at the card limit', async () => {
    const titles = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛'];
    const generated = (chapter: string, prefix: string) =>
      Array.from({ length: ENRICH_MAX_CARDS }, (_, index) => card(chapter, `${prefix}${index}`));
    const client = new FakeModelClient([
      answer(generated('甲', '前半')),
      answer(generated('戊', '后半'))
    ]);

    const result = await buildEnrichment(options(client, titles));

    expect(result.cards).toHaveLength(ENRICH_MAX_CARDS);
  });

  it('retries once with the valid chapter titles when every card is off-chapter', async () => {
    const client = new FakeModelClient([
      answer([card('第三章', '章节不对')]),
      answer([card('第一章', '改对了')])
    ]);

    const result = await buildEnrichment(options(client, ['第一章', '第二章']));

    expect(client.calls).toHaveLength(2);
    expect(result.cards.map((item) => item.title)).toEqual(['改对了']);
    const retryPrompt = client.calls[1].messages[0].content;
    expect(retryPrompt).toContain('上一次的回答无法使用');
    expect(retryPrompt).toContain('「第一章」');
  });

  it('throws DeckStepError when cards are still empty after the retry', async () => {
    const client = new FakeModelClient([
      answer([card('第三章', '章节不对')]),
      answer([card('第四章', '还是不对')])
    ]);

    await expect(buildEnrichment(options(client, ['第一章', '第二章']))).rejects.toBeInstanceOf(
      DeckStepError
    );
    expect(client.calls).toHaveLength(2);
  });
});
