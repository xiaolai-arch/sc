import { z } from 'zod';
import type { ModelClient, ModelRequest } from '../../agent/model-client';
import { createAbortError } from '../frames';
import { formatScreenLabel, type ScreenRead } from '../screen-read';
import {
  deckNotesSchema,
  enrichCardSchema,
  factcheckResultSchema,
  type DeckNotes,
  type EnrichCard,
  type FactIssue,
  type FactcheckResult
} from './content';
import {
  DECK_MODEL_TIMEOUT_MS,
  DeckStepError,
  extractJsonValue,
  jsonOutputRules,
  requestValidatedJson
} from './prompts';
import { deckSchema, validateDeck, DeckValidationError, type Deck } from './schema';

/**
 * Independent fact-check calls. Step 8 checks the notes and cards against the
 * on-screen text and then revises them; step 12 checks every slide against the
 * already verified notes. Each call uses a fresh conversation (no writer
 * history) and is expected to prefer missing a problem over inventing one.
 */

export const FACTCHECK_PROMPT_VERSION = 2;

// ---------------------------------------------------------------------------
// Prompt material
// ---------------------------------------------------------------------------

function formatClock(seconds: number): string {
  const total = Math.max(0, Math.round(Number.isFinite(seconds) ? seconds : 0));
  const minutes = Math.floor(total / 60);
  return `${String(minutes).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/** The evidence: what the frames actually show, in time order. */
function formatScreenReads(reads: readonly ScreenRead[]): string {
  const ordered = [...reads]
    .filter((read) => read.text.trim().length > 0)
    .sort((a, b) => a.t - b.t);
  if (ordered.length === 0) return '（没有画面文字。）';
  return ordered
    .map((read) => `- ${formatScreenLabel(read.t)}${read.text}`)
    .join('\n');
}

/** Notes with a stable `章节标题/段落序号` locator, paragraph numbers from 1. */
function formatNotes(notes: DeckNotes): string {
  const lines: string[] = [];
  for (const chapter of notes.chapters) {
    lines.push(`### ${chapter.title}`);
    chapter.blocks.forEach((block, index) => {
      lines.push(`- ${chapter.title}/${index + 1} [${formatClock(block.t)}][画面] ${block.text}`);
    });
    lines.push(`要点：${chapter.keyPoints.join('；')}`);
  }
  return lines.length > 0 ? lines.join('\n') : '（没有笔记。）';
}

function formatCards(cards: readonly EnrichCard[]): string {
  if (cards.length === 0) return '（没有补充卡片。）';
  const lines: string[] = [];
  for (const card of cards) {
    lines.push(`### ${card.title}（章节：${card.chapter}）`);
    lines.push(`原理：${card.principle}`);
    for (const example of card.examples) {
      lines.push(
        example.wrong === undefined
          ? `例：${example.right}`
          : `例：错——${example.wrong}；对——${example.right}`
      );
    }
    lines.push(`易错：${card.pitfall}`);
    lines.push(`迁移：${card.transfer}`);
    lines.push(
      `来源：${card.sources
        .map((source) => {
          switch (source.kind) {
            case 'video':
              return `视频 ${formatClock(source.t)}`;
            case 'screen':
              return `画面 ${formatClock(source.t)}`;
            case 'infer':
              return '推演';
            case 'ext':
              return '扩展';
          }
        })
        .join('、')}`
    );
  }
  return lines.join('\n');
}

/** The material listing for step 8, shared by the check and revision prompts. */
function materialSections(
  notes: DeckNotes,
  cards: readonly EnrichCard[],
  screenReads: readonly ScreenRead[]
): string {
  return [
    '## 画面文字（唯一的证据）',
    formatScreenReads(screenReads),
    '',
    '## 笔记',
    formatNotes(notes),
    '',
    '## 补充卡片',
    formatCards(cards)
  ].join('\n');
}

/** Prompt for the check half of step 8. */
export function buildMaterialCheckPrompt(
  notes: DeckNotes,
  cards: readonly EnrichCard[],
  screenReads: readonly ScreenRead[]
): string {
  return [
    '你是讲课视频课件的独立核查员。下面给出画面文字、笔记和补充卡片。笔记和卡片是另一个模型写的，写作时只看到了画面文字。',
    '这段视频没有语音材料：课件只依据画面内容，任何声称「老师讲过」的说法都没有依据。',
    '你的任务：找出笔记和卡片里与画面文字矛盾、或者画面文字里根本没有依据的说法。',
    '',
    '核查规则：',
    '1. 只挑真正的问题。画面文字没有明确反驳、只是没有出现的内容，只有在它被当成画面内容陈述时才记问题。',
    '2. problem 里必须引用画面文字的原文片段作为证据（照抄原句），并说明为什么它是问题。',
    '3. 宁可漏报，也不要编造错误：没有把握就不报，不要为了凑数硬找问题。',
    '4. 与画面文字直接矛盾的，severity 用 "error"；具体细节在画面上找不到依据、说得太绝对的，用 "warn"。',
    '5. 每条问题的字段：',
    '   - target：笔记的问题用 "notes"，补充卡片的问题用 "card"；',
    '   - ref：笔记用「章节标题/段落序号」，段落序号从 1 开始；卡片用卡片标题；',
    '   - claim：被质疑的那句话，照抄原文；',
    '   - problem：错在哪里，并引用画面文字原文作为证据；',
    '   - severity："error" 或 "warn"。',
    '6. 没有问题就输出 {"issues":[]}。',
    '',
    jsonOutputRules(),
    '',
    '输出格式：{"issues":[{"target":"notes","ref":"章节标题/1","claim":"原文","problem":"画面文字是……，与这句矛盾","severity":"error"}]}',
    '',
    materialSections(notes, cards, screenReads)
  ].join('\n');
}

/** Prompt for the revision half of step 8. */
export function buildRevisionPrompt(
  notes: DeckNotes,
  cards: readonly EnrichCard[],
  issues: readonly FactIssue[],
  screenReads: readonly ScreenRead[]
): string {
  const issueLines = issues.map(
    (issue) =>
      `- [${issue.severity}][${issue.target}] ${issue.ref}：${issue.claim} —— ${issue.problem}`
  );
  return [
    '你是课件的内容编辑。下面给出画面文字、笔记、补充卡片和核查发现的问题。请逐条处理这些问题，输出修订后的笔记和补充卡片。',
    '',
    '修改规则：',
    '1. error：必须改正或删除。能依据画面文字改正的，按画面文字改；画面文字里没有依据的，删掉那句话或整条卡片。',
    '2. warn：收紧表述，补上限定条件，删掉绝对化的说法。',
    '3. 不要改动章节标题和章节顺序：notes.chapters 的 title 必须和输入完全一致。',
    '4. 不要新增画面文字里没有的事实；确实要保留的外部知识，来源必须标成扩展（ext）。',
    '5. 笔记的 blocks 逐字沿用画面文字，source 一律写 "screen"；不要写「老师说」「视频里讲」这类话。',
    '6. 补充卡片的 sources 只能用 screen、infer 或 ext，不能用 video。',
    '7. 没有问题的内容原样保留，不要顺手改写。',
    '',
    jsonOutputRules(),
    '',
    '输出格式：{"notes":{"chapters":[...]},"cards":[{"chapter":"章节标题","title":"结论","principle":"原理","examples":[{"right":"例子"}],"pitfall":"易错点","transfer":"迁移","sources":[{"kind":"screen","t":10}]}]}',
    '',
    '## 核查问题',
    issueLines.length > 0 ? issueLines.join('\n') : '（没有需要处理的问题，原样返回。）',
    '',
    materialSections(notes, cards, screenReads)
  ].join('\n');
}

/** Prompt for step 12. `issues` must name only problems left after the revision. */
export function buildDeckCheckPrompt(deck: Deck, notes: DeckNotes): string {
  return [
    '你是课件成品的独立核查员。下面给出已经核查过的笔记，以及一份课件 JSON。',
    '请逐页核对课件的说法是否有笔记依据，并在必要时给出修订后的完整课件。',
    '',
    '核查规则：',
    '1. 来源标为 screen 的页，内容必须能在笔记里找到依据；与笔记矛盾、或笔记里没有依据的，记为问题。',
    '2. 由画面内容直接推出的，标 infer；画面以外的知识，标 ext，并写清出处。任何页都不能标 video：这段视频没有语音材料。',
    '3. 用 ext 或 infer 的页里不能出现「老师说」「视频里讲」这类话。',
    '4. 有问题的页：能改的，在 deck 里改正说法、补上或改正来源，或直接删掉无法确认的页。',
    '5. issues 只列修订后仍然无法解决的问题；已经改好的不要再列。每条写 target "deck"、ref 用页的 id、claim 照抄原句、problem 写清依据（引用笔记原文）、severity 用 "error" 或 "warn"。',
    '6. 输出完整的 deck：保持 version、title、sourcePath、durationSeconds、各章标题和页 id 不变，只改必要的地方；不能确认的页保留内容，并把 status 设为 "contested"。',
    '7. 没有问题就原样返回 deck，issues 输出空数组。',
    '',
    jsonOutputRules(),
    '',
    '输出格式：{"issues":[{"target":"deck","ref":"页 id","claim":"原文","problem":"笔记原文是……","severity":"error"}],"deck":{"version":1,"title":"…","sourcePath":"…","durationSeconds":0,"chapters":[]}}',
    '',
    '## 笔记（已核查）',
    formatNotes(notes),
    '',
    '## 课件 JSON',
    JSON.stringify(deck)
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Step 8: check and revise notes + cards
// ---------------------------------------------------------------------------

export interface CheckMaterialOptions {
  client: ModelClient;
  notes: DeckNotes;
  cards: EnrichCard[];
  screenReads: ScreenRead[];
  signal?: AbortSignal;
  timeoutMs?: number;
}

/**
 * Finds claims in the notes and cards that contradict or are unsupported by
 * the on-screen text. Issues whose target is not `notes` or `card` belong to a
 * different step and are dropped here.
 */
export async function checkMaterial(options: CheckMaterialOptions): Promise<FactcheckResult> {
  const { client, notes, cards, screenReads, signal, timeoutMs = DECK_MODEL_TIMEOUT_MS } = options;
  const request: ModelRequest = {
    messages: [
      { role: 'user', content: buildMaterialCheckPrompt(notes, cards, screenReads) }
    ],
    noTools: true,
    timeoutMs,
    signal
  };
  const result = await requestValidatedJson({
    client,
    request,
    schema: factcheckResultSchema,
    step: 'factcheck-a',
    signal
  });
  return {
    issues: result.issues.filter((issue) => issue.target === 'notes' || issue.target === 'card')
  };
}

/** Revision schema bound to the input notes, so chapter titles cannot drift. */
function makeRevisionSchema(expectedTitles: readonly string[]) {
  return z.object({ notes: deckNotesSchema, cards: z.array(enrichCardSchema).max(12) }).superRefine((value, context) => {
    const titles = value.notes.chapters.map((chapter) => chapter.title);
    const same =
      titles.length === expectedTitles.length &&
      titles.every((title, index) => title === expectedTitles[index]);
    if (!same) {
      context.addIssue({
        code: 'custom',
        path: ['notes', 'chapters'],
        message: `章节标题必须与输入笔记完全一致：${expectedTitles.join('、')}`
      });
    }
  });
}

export interface ReviseMaterialOptions {
  client: ModelClient;
  notes: DeckNotes;
  cards: EnrichCard[];
  issues: FactIssue[];
  screenReads: ScreenRead[];
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface RevisedMaterial {
  notes: DeckNotes;
  cards: EnrichCard[];
}

/**
 * Applies the check issues to the notes and cards. The answer is validated
 * against both schemas and must keep the input chapter titles; a second bad
 * answer fails the step.
 */
export async function reviseMaterial(options: ReviseMaterialOptions): Promise<RevisedMaterial> {
  const { client, notes, cards, issues, screenReads, signal, timeoutMs = DECK_MODEL_TIMEOUT_MS } =
    options;
  const request: ModelRequest = {
    messages: [
      { role: 'user', content: buildRevisionPrompt(notes, cards, issues, screenReads) }
    ],
    noTools: true,
    timeoutMs,
    signal
  };
  const schema = makeRevisionSchema(notes.chapters.map((chapter) => chapter.title));
  const revised = await requestValidatedJson({
    client,
    request,
    schema,
    step: 'factcheck-a-revise',
    signal
  });
  return { notes: revised.notes, cards: revised.cards };
}

// ---------------------------------------------------------------------------
// Step 12: check the deck against the notes
// ---------------------------------------------------------------------------

export interface CheckDeckOptions {
  client: ModelClient;
  deck: Deck;
  notes: DeckNotes;
  signal?: AbortSignal;
  timeoutMs?: number;
}

interface DeckCheckAttempt {
  issues: FactIssue[] | null;
  deck: Deck | null;
  problem: string;
}

function describeZod(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.length > 0 ? issue.path.join('.') : '(root)'}: ${issue.message}`)
    .join('；');
}

/** One model call; never throws for a bad answer, only for a client error. */
async function attemptDeckCheck(
  client: ModelClient,
  deck: Deck,
  notes: DeckNotes,
  content: string,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<DeckCheckAttempt> {
  const response = await client.complete({
    messages: [{ role: 'user', content }],
    noTools: true,
    timeoutMs,
    signal
  });

  let parsed: unknown;
  try {
    parsed = extractJsonValue(response.text);
  } catch (error) {
    return {
      issues: null,
      deck: null,
      problem: error instanceof Error ? error.message : String(error)
    };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { issues: null, deck: null, problem: '模型返回的不是 JSON 对象。' };
  }

  const record = parsed as Record<string, unknown>;
  const issueResult = factcheckResultSchema.safeParse(record);
  const issues = issueResult.success ? issueResult.data.issues : null;
  const problemParts: string[] = [];
  if (!issueResult.success) problemParts.push(describeZod(issueResult.error));

  const deckResult = deckSchema.safeParse(record.deck);
  let revised: Deck | null = null;
  if (!deckResult.success) {
    problemParts.push(describeZod(deckResult.error));
  } else {
    try {
      revised = validateDeck(deckResult.data);
    } catch (error) {
      problemParts.push(error instanceof DeckValidationError ? error.message : String(error));
    }
  }

  if (issues !== null && revised !== null) {
    return { issues, deck: revised, problem: '' };
  }
  return {
    issues,
    deck: null,
    problem: problemParts.length > 0 ? problemParts.join('；') : '模型返回的内容缺少 issues 或 deck。'
  };
}

/**
 * Step 12: checks every slide against the verified notes and returns the
 * revised deck plus the issues that remain. A bad revision is retried once;
 * when both answers are unusable the original deck is kept, because a broken
 * fact-check must not lose an otherwise good lesson. `applyContested` turns
 * the remaining errors into `status: 'contested'` pages.
 */
export async function checkDeck(options: CheckDeckOptions): Promise<{ issues: FactIssue[]; deck: Deck }> {
  const { client, deck, notes, signal, timeoutMs = DECK_MODEL_TIMEOUT_MS } = options;
  const base = buildDeckCheckPrompt(deck, notes);
  let content = base;
  let lastIssues: FactIssue[] = [];

  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (signal?.aborted) throw createAbortError();
    const result = await attemptDeckCheck(client, deck, notes, content, timeoutMs, signal);
    if (result.issues !== null) lastIssues = result.issues;
    if (result.deck !== null && result.issues !== null) {
      return { issues: result.issues, deck: result.deck };
    }
    if (attempt === 0) {
      content = `${base}\n\n上一次的回答无法使用：${result.problem}\n请只输出一个 JSON 对象，包含修订后的完整 deck 和 issues，并修正上述问题后重试。`;
    }
  }

  return { issues: lastIssues, deck };
}

/**
 * Marks every slide whose id is named by an `error` issue as contested. Warns
 * and references that name no slide are ignored. Always returns a new deck.
 */
export function applyContested(deck: Deck, issues: readonly FactIssue[]): Deck {
  const contested = new Set<string>();
  for (const issue of issues) {
    if (issue.severity !== 'error') continue;
    const ref = issue.ref.trim();
    if (ref !== '') contested.add(ref);
  }
  return {
    ...deck,
    chapters: deck.chapters.map((chapter) => ({
      ...chapter,
      slides: chapter.slides.map((slide) =>
        contested.has(slide.id) ? { ...slide, status: 'contested' as const } : slide
      )
    }))
  };
}
