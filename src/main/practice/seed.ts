import type { PracticeQuestion, PracticeSet } from '../../shared/practice';

export type SeedPracticeSet = {
  id: string;
  workspaceId: string;
  title: string;
  subject: string;
  questions: PracticeQuestion[];
};

/**
 * Offline seed content, mirroring the renderer prototype's 考研/英语 practice
 * sets. No model or network call is involved — these files are written into
 * the vault the first time practice data is requested.
 */
export const SEED_PRACTICE_SETS: readonly SeedPracticeSet[] = [
  {
    id: 'ps1',
    workspaceId: 'kaoyan',
    title: '极限基础 3 题',
    subject: '数学',
    questions: [
      {
        id: 'q1',
        prompt: '当 x→0 时，sin x / x 的极限是？',
        options: ['0', '1', '∞', '不存在'],
        answer: 1,
        explanation: '这是第一个重要极限，sin x / x → 1。'
      },
      {
        id: 'q2',
        prompt: '下列哪一项通常是 0/0 型未定式？',
        options: [
          'x / (x + 1) 当 x→0',
          'sin x / x 当 x→0',
          '(e^x - 1) / x 当 x→0',
          'x^2 当 x→1'
        ],
        answer: 2,
        explanation: 'x→0 时 e^x - 1 → 0，分母 x → 0，所以是 0/0 型。'
      },
      {
        id: 'q3',
        prompt: '使用洛必达法则前，必须确认什么？',
        options: ['函数是连续的', '分母不为 0', '导函数比值的极限存在', '函数是单调的'],
        answer: 2,
        explanation: '洛必达法则要求导函数比值的极限存在（或为 ∞），否则不能直接下结论。'
      }
    ]
  },
  {
    id: 'ps2',
    workspaceId: 'kaoyan',
    title: '马原易错 3 题',
    subject: '政治',
    questions: [
      {
        id: 'p1',
        prompt: '矛盾的两个基本属性是？',
        options: ['普遍性和特殊性', '同一性和斗争性', '主要方面和次要方面', '内因和外因'],
        answer: 1,
        explanation: '矛盾的基本属性是同一性和斗争性。'
      },
      {
        id: 'p2',
        prompt: '“具体问题具体分析”体现的是？',
        options: ['矛盾的普遍性', '矛盾的特殊性', '矛盾的同一性', '矛盾的斗争性'],
        answer: 1,
        explanation: '具体问题具体分析是矛盾特殊性的方法论要求。'
      },
      {
        id: 'p3',
        prompt: '量变和质变的关系是？',
        options: [
          '量变必然立即引起质变',
          '质变与量变无关',
          '量变是质变的必要准备，质变是量变的必然结果',
          '只有质变有意义'
        ],
        answer: 2,
        explanation: '量变积累到一定程度引起质变，质变又为新的量变开辟道路。'
      }
    ]
  },
  {
    id: 'ps3',
    workspaceId: 'english',
    title: '长难句 3 题',
    subject: '英语',
    questions: [
      {
        id: 'e1',
        prompt: 'The book that I bought yesterday is more useful than I expected. 主句的主语是？',
        options: ['The book', 'that', 'I', 'yesterday'],
        answer: 0,
        explanation: '主句是 The book is more useful...，that 从句修饰 book。'
      },
      {
        id: 'e2',
        prompt: 'Not until midnight ____ the work.',
        options: ['he finished', 'did he finish', 'he did finish', 'finished he'],
        answer: 1,
        explanation: 'Not until 位于句首，主句用部分倒装：did he finish。'
      },
      {
        id: 'e3',
        prompt: 'Despite the rain, the match continued. “Despite the rain” 在句中作？',
        options: ['主语', '让步状语', '宾语', '定语'],
        answer: 1,
        explanation: 'Despite 引导让步状语，表示“尽管下雨”。'
      }
    ]
  }
];

/** Builds fresh set objects so callers can stamp created/updated timestamps. */
export function buildSeedSets(timestamp: string): PracticeSet[] {
  return SEED_PRACTICE_SETS.map((seed) => ({
    ...seed,
    questions: seed.questions.map((question) => ({ ...question, options: [...question.options] })),
    createdAt: timestamp,
    updatedAt: timestamp
  }));
}
