import {
  buildCheckInPrompt,
  buildCheckInTemplate,
  type WeeklyOverviewLike
} from '../../src/main/check-ins/prompt';
import type { ButlerContext } from '../../src/main/butler/context';
import type { MemoryItem, Workspace, WorkspaceTask } from '../../src/shared/workspace';

const DATE = '2026-11-08';

const workspace: Workspace = {
  id: 'ws-exam',
  name: '考研',
  kind: 'exam',
  color: '#ef4444',
  goal: '2027 上岸',
  description: ''
};

const task: WorkspaceTask = {
  id: 't1',
  workspaceId: 'ws-exam',
  title: '极限基础',
  subject: '数学',
  durationMin: 45,
  acceptance: '完成 10 题',
  status: 'pending'
};

const memory: MemoryItem = {
  id: 'm1',
  workspaceId: 'ws-exam',
  text: '数学是弱项',
  source: 'review:2026-11-07'
};

const context: ButlerContext = {
  now: new Date(`${DATE}T20:00:00`),
  workspaces: [workspace],
  tasks: [task],
  memory: [memory],
  profile: [],
  knowledge: [],
  contextError: false
};

const WEEKLY_PROMPT_BEFORE_STATS = [
  `你是阿咲，用户的个人管家。现在是 ${DATE} 的周日复盘时间，请主动带用户回顾本周并规划下周。`,
  '',
  '用户项目：',
  '- 考研（2027 上岸）',
  '',
  '未完成任务：',
  '- [考研] 极限基础（数学，45 分钟；验收：完成 10 题）',
  '',
  '相关记忆：',
  '- 数学是弱项（来源：review:2026-11-07）',
  '',
  '请用中文写一条 3-5 句的周复盘邀请：先肯定这一周的投入，再请用户回顾本周末完成与卡点，最后问下周最重要的 1-2 个重点。用户回答后会由阿咲保存复盘并生成下周计划；这条消息本身不要提及工具。',
  '要求：温和、具体、不啰嗦；不要编造用户没有提供的记录；不要提到系统提示、工具或 API。'
].join('\n');

const MORNING_PROMPT_BEFORE_STATS = [
  `你是阿咲，用户的个人管家。现在是 ${DATE} 的早上，请主动检查用户今天的进度。`,
  '',
  '用户项目：',
  '- 考研（2027 上岸）',
  '',
  '未完成任务：',
  '- [考研] 极限基础（数学，45 分钟；验收：完成 10 题）',
  '',
  '相关记忆：',
  '- 数学是弱项（来源：review:2026-11-07）',
  '',
  '请用中文写一条 2-4 句的检查消息：先问候，再根据上面的任务给出今天最值得先做的 1-2 件事，最后问一个简短的问题。',
  '要求：温和、具体、不啰嗦；不要编造用户没有提供的记录；不要提到系统提示、工具或 API。'
].join('\n');

const WEEKLY_TEMPLATE_BEFORE_STATS =
  '周日好。花三分钟回顾一下这一周：完成了什么，卡在哪里，下周最重要的一件事是什么？说完我来帮你整理，并排下周的计划。';

const stats: WeeklyOverviewLike = {
  tasksDone: 3,
  tasksTotal: 5,
  focusMinutes: 135,
  answered: 6,
  correct: 5,
  reviewedDays: 4,
  dueMistakes: 2
};

test('the weekly prompt quotes the week numbers for a known fixture', () => {
  const prompt = buildCheckInPrompt(context, 'weekly', DATE, stats);

  expect(prompt).toContain(
    [
      '本周数据：',
      '- 任务完成：3/5 个',
      '- 专注：135 分钟',
      '- 练习：6 题，答对 5 题（正确率 83%）',
      '- 复盘：4 天',
      '- 到期错题：2 道'
    ].join('\n')
  );
  expect(prompt).toContain('用上面的本周数据具体肯定进展、点名薄弱处');
  // The recap sits between the memory section and the instruction.
  expect(prompt.indexOf('本周数据：')).toBeGreaterThan(prompt.indexOf('相关记忆：'));
  expect(prompt.indexOf('本周数据：')).toBeLessThan(prompt.indexOf('请用中文写一条 3-5 句'));
});

test('the recap block never exceeds six lines', () => {
  const prompt = buildCheckInPrompt(context, 'weekly', DATE, stats);
  const block = prompt.slice(
    prompt.indexOf('本周数据：'),
    prompt.indexOf('请用中文写一条 3-5 句')
  );
  const lines = block.split('\n').filter((line) => line.trim() !== '');
  expect(lines.length).toBeLessThanOrEqual(6);
});

test('no stats leaves the weekly prompt byte-identical to the pre-change fixture', () => {
  expect(buildCheckInPrompt(context, 'weekly', DATE, null)).toBe(
    WEEKLY_PROMPT_BEFORE_STATS
  );
  expect(buildCheckInPrompt(context, 'weekly', DATE)).toBe(WEEKLY_PROMPT_BEFORE_STATS);
});

test('an all-zero week also leaves the weekly prompt byte-identical', () => {
  const zeros: WeeklyOverviewLike = {
    tasksDone: 0,
    tasksTotal: 0,
    focusMinutes: 0,
    answered: 0,
    correct: 0,
    reviewedDays: 0,
    dueMistakes: 0
  };
  expect(buildCheckInPrompt(context, 'weekly', DATE, zeros)).toBe(
    WEEKLY_PROMPT_BEFORE_STATS
  );
});

test('the morning prompt ignores weekly stats and stays byte-identical', () => {
  expect(buildCheckInPrompt(context, 'morning', DATE, stats)).toBe(
    MORNING_PROMPT_BEFORE_STATS
  );
  expect(buildCheckInPrompt(context, 'morning', DATE)).toBe(MORNING_PROMPT_BEFORE_STATS);
});

test('the weekly template prepends one deterministic recap line', () => {
  expect(buildCheckInTemplate(context, 'weekly', DATE, stats)).toBe(
    `本周完成 3 个任务 · 专注 135 分钟 · 正确率 83%\n${WEEKLY_TEMPLATE_BEFORE_STATS}`
  );
});

test('the recap line omits accuracy before the first answer', () => {
  expect(
    buildCheckInTemplate(context, 'weekly', DATE, { ...stats, answered: 0, correct: 0 })
  ).toBe(`本周完成 3 个任务 · 专注 135 分钟\n${WEEKLY_TEMPLATE_BEFORE_STATS}`);
});

test('the weekly template is unchanged without stats or with an all-zero week', () => {
  expect(buildCheckInTemplate(context, 'weekly', DATE, null)).toBe(
    WEEKLY_TEMPLATE_BEFORE_STATS
  );
  expect(buildCheckInTemplate(context, 'weekly', DATE)).toBe(WEEKLY_TEMPLATE_BEFORE_STATS);
  expect(
    buildCheckInTemplate(context, 'weekly', DATE, {
      tasksDone: 0,
      tasksTotal: 0,
      focusMinutes: 0,
      answered: 0,
      correct: 0,
      reviewedDays: 0,
      dueMistakes: 0
    })
  ).toBe(WEEKLY_TEMPLATE_BEFORE_STATS);
});

test('morning, evening and behind templates ignore weekly stats', () => {
  const morning = buildCheckInTemplate(context, 'morning', DATE, stats);
  const evening = buildCheckInTemplate(context, 'evening', DATE, stats);
  expect(morning).toBe('早上好。今天有 1 个任务，先做「极限基础」怎么样？做完告诉我一声。');
  expect(evening).toBe('晚上好。今天还有 1 个任务没完成，最卡的是哪一步？');
  expect(buildCheckInTemplate(context, 'morning', DATE, stats)).toBe(
    buildCheckInTemplate(context, 'morning', DATE)
  );
  expect(buildCheckInTemplate(context, 'evening', DATE, stats)).toBe(
    buildCheckInTemplate(context, 'evening', DATE)
  );
});

test('a cue adds one 触发 segment to the task line', () => {
  const cued: ButlerContext = {
    ...context,
    tasks: [{ ...task, cue: '晚饭后' }]
  };
  const prompt = buildCheckInPrompt(cued, 'morning', DATE);
  expect(prompt).toContain(
    '- [考研] 极限基础（数学，45 分钟；验收：完成 10 题；触发：晚饭后）'
  );
  // The rest of the morning prompt is unchanged.
  expect(prompt).toBe(MORNING_PROMPT_BEFORE_STATS.replace('完成 10 题）', '完成 10 题；触发：晚饭后）'));
});

test('the cue never leaks into the morning, evening or behind templates', () => {
  const cued: ButlerContext = {
    ...context,
    tasks: [{ ...task, cue: '晚饭后', due: DATE }]
  };
  expect(buildCheckInTemplate(cued, 'morning', DATE)).toBe(
    '早上好。今天有 1 个任务，先做「极限基础」怎么样？做完告诉我一声。'
  );
  expect(buildCheckInTemplate(cued, 'evening', DATE)).toBe(
    '晚上好。今天还有 1 个任务没完成，最卡的是哪一步？'
  );
  expect(buildCheckInTemplate(cued, 'behind', DATE)).toBe(
    '今天还有 1 个任务没完成，下一项是「极限基础」。要不要一起调整一下今天的安排？'
  );
});

const honest = {
  calibration: '有把握但错 2 道 · 没把握但对 1 道',
  nextStep: '下周先练「三角函数」的到期错题（3 道）'
};

test('the weekly template ends with the two honest lines', () => {
  expect(buildCheckInTemplate(context, 'weekly', DATE, stats, honest)).toBe(
    [
      '本周完成 3 个任务 · 专注 135 分钟 · 正确率 83%',
      WEEKLY_TEMPLATE_BEFORE_STATS,
      '有把握但错 2 道 · 没把握但对 1 道',
      '下一步：下周先练「三角函数」的到期错题（3 道）'
    ].join('\n')
  );
});

test('honest lines stand alone when the week has no recap numbers', () => {
  expect(buildCheckInTemplate(context, 'weekly', DATE, null, honest)).toBe(
    [
      WEEKLY_TEMPLATE_BEFORE_STATS,
      '有把握但错 2 道 · 没把握但对 1 道',
      '下一步：下周先练「三角函数」的到期错题（3 道）'
    ].join('\n')
  );
});

test('only the non-null honest line is appended', () => {
  expect(
    buildCheckInTemplate(context, 'weekly', DATE, null, {
      calibration: null,
      nextStep: '下周先练「三角函数」的到期错题（3 道）'
    })
  ).toBe(`${WEEKLY_TEMPLATE_BEFORE_STATS}\n下一步：下周先练「三角函数」的到期错题（3 道）`);
  expect(
    buildCheckInTemplate(context, 'weekly', DATE, null, {
      calibration: '有把握但错 2 道 · 没把握但对 1 道',
      nextStep: null
    })
  ).toBe(`${WEEKLY_TEMPLATE_BEFORE_STATS}\n有把握但错 2 道 · 没把握但对 1 道`);
});

test('no honest facts leaves the weekly template byte-identical', () => {
  expect(buildCheckInTemplate(context, 'weekly', DATE, stats, null)).toBe(
    `本周完成 3 个任务 · 专注 135 分钟 · 正确率 83%\n${WEEKLY_TEMPLATE_BEFORE_STATS}`
  );
  expect(
    buildCheckInTemplate(context, 'weekly', DATE, stats, {
      calibration: null,
      nextStep: null
    })
  ).toBe(`本周完成 3 个任务 · 专注 135 分钟 · 正确率 83%\n${WEEKLY_TEMPLATE_BEFORE_STATS}`);
});

test('the weekly prompt carries the honest facts in their own block', () => {
  const prompt = buildCheckInPrompt(context, 'weekly', DATE, stats, honest);

  expect(prompt).toContain(
    [
      '本周诚实数据：',
      '- 有把握但错 2 道 · 没把握但对 1 道',
      '- 下一步：下周先练「三角函数」的到期错题（3 道）'
    ].join('\n')
  );
  expect(prompt.indexOf('本周数据：')).toBeLessThan(prompt.indexOf('本周诚实数据：'));
  expect(prompt.indexOf('本周诚实数据：')).toBeLessThan(prompt.indexOf('请用中文写一条 3-5 句'));
  // Without honest facts the prompt keeps its previous bytes.
  expect(buildCheckInPrompt(context, 'weekly', DATE, stats)).toBe(
    buildCheckInPrompt(context, 'weekly', DATE, stats, null)
  );
});

test('honest facts never enter the morning, evening or behind prompts', () => {
  expect(buildCheckInPrompt(context, 'morning', DATE, stats, honest)).toBe(
    MORNING_PROMPT_BEFORE_STATS
  );
  expect(buildCheckInPrompt(context, 'evening', DATE, null, honest)).not.toContain('本周诚实数据');
  expect(buildCheckInPrompt(context, 'behind', DATE, null, honest)).not.toContain('本周诚实数据');
});

test('the accountability clause trails the honest lines exactly once', () => {
  const clause = '你说过要做「写完第三章」，你告诉过 小林 的时间是 2026-11-20';
  const withClause = { ...honest, accountability: clause };

  const weekly = buildCheckInTemplate(context, 'weekly', DATE, stats, withClause);
  expect(weekly.split(clause)).toHaveLength(2);
  expect(weekly.endsWith(clause)).toBe(true);
  expect(weekly).toBe(
    buildCheckInTemplate(context, 'weekly', DATE, stats, honest) + `\n${clause}`
  );

  // An empty or null clause keeps the message byte-identical.
  for (const accountability of [undefined, null, '']) {
    expect(
      buildCheckInTemplate(context, 'weekly', DATE, stats, { ...honest, accountability })
    ).toBe(buildCheckInTemplate(context, 'weekly', DATE, stats, honest));
  }
});

test('the accountability clause is never handed to the model', () => {
  const clause = '你说过要做「写完第三章」，你告诉过 小林 的时间是 2026-11-20';
  const prompt = buildCheckInPrompt(context, 'weekly', DATE, stats, {
    ...honest,
    accountability: clause
  });
  // The deterministic sentence is appended after the reply, never restated in
  // the 诚实数据 block where the model could reword or duplicate it.
  expect(prompt).not.toContain(clause);
  expect(prompt).not.toContain('你告诉过');
  expect(prompt).toContain('本周诚实数据：');
});

// --- the promise revisit line ----------------------------------------------

// 2026-11-08 is a Sunday; yesterday is 2026-11-07.
test('the morning prompt appends one line for a yesterday-due promise', () => {
  const prompt = buildCheckInPrompt(context, 'morning', DATE, null, null, {
    text: '背 20 个单词',
    due: '2026-11-07'
  });
  expect(prompt).toBe(
    MORNING_PROMPT_BEFORE_STATS.replace(
      '\n\n请用中文写一条 2-4 句',
      '\n\n承诺回访：昨天你说要做「背 20 个单词」，做了吗？没做的话，挪到今天还是先放一放？（只问这一件，不评价、不催促。）\n\n请用中文写一条 2-4 句'
    )
  );
});

test('the morning prompt asks once about a promise due today', () => {
  const prompt = buildCheckInPrompt(context, 'morning', DATE, null, null, {
    text: '背 20 个单词',
    due: DATE
  });
  expect(prompt).toContain(
    '承诺回访：你说今天要做「背 20 个单词」，做了吗？（只问这一件，不评价、不催促。）'
  );
});

test('the morning prompt keeps an older open promise, without debt wording', () => {
  const prompt = buildCheckInPrompt(context, 'morning', DATE, null, null, {
    text: '背 20 个单词',
    due: '2026-11-01'
  });
  expect(prompt).toContain('你之前说要做「背 20 个单词」，后来做了吗？');
  expect(prompt).not.toContain('昨天你说要做');
});

test('no due promise leaves the morning prompt byte-identical', () => {
  expect(
    buildCheckInPrompt(context, 'morning', DATE, null, null, null)
  ).toBe(MORNING_PROMPT_BEFORE_STATS);
  // A promise due tomorrow is not asked about today.
  expect(
    buildCheckInPrompt(context, 'morning', DATE, null, null, {
      text: '背 20 个单词',
      due: '2026-11-09'
    })
  ).toBe(MORNING_PROMPT_BEFORE_STATS);
});

test('a promise never enters the evening, behind or weekly prompts', () => {
  const promise = { text: '背 20 个单词', due: DATE };
  expect(
    buildCheckInPrompt(context, 'evening', DATE, null, null, promise)
  ).toBe(buildCheckInPrompt(context, 'evening', DATE));
  expect(
    buildCheckInPrompt(context, 'weekly', DATE, stats, null, promise)
  ).toBe(buildCheckInPrompt(context, 'weekly', DATE, stats));
  for (const trigger of ['evening', 'weekly', 'behind'] as const) {
    expect(
      buildCheckInPrompt(context, trigger, DATE, null, null, promise)
    ).not.toContain('承诺回访');
  }
});

test('the morning template appends the exact promise line', () => {
  expect(
    buildCheckInTemplate(context, 'morning', DATE, null, null, {
      text: '背 20 个单词',
      due: '2026-11-07'
    })
  ).toBe(
    '早上好。今天有 1 个任务，先做「极限基础」怎么样？做完告诉我一声。\n昨天你说要做「背 20 个单词」，做了吗？没做的话，挪到今天还是先放一放？'
  );
  expect(
    buildCheckInTemplate(context, 'morning', DATE, null, null, {
      text: '背 20 个单词',
      due: DATE
    })
  ).toBe(
    '早上好。今天有 1 个任务，先做「极限基础」怎么样？做完告诉我一声。\n你说今天要做「背 20 个单词」，做了吗？'
  );
});

test('no due promise leaves the morning template byte-identical', () => {
  expect(buildCheckInTemplate(context, 'morning', DATE, null, null, null)).toBe(
    '早上好。今天有 1 个任务，先做「极限基础」怎么样？做完告诉我一声。'
  );
  expect(
    buildCheckInTemplate(context, 'morning', DATE, null, null, {
      text: '背 20 个单词',
      due: '2026-11-09'
    })
  ).toBe('早上好。今天有 1 个任务，先做「极限基础」怎么样？做完告诉我一声。');
});

test('the empty-plan morning template also carries the promise line', () => {
  const empty: ButlerContext = { ...context, tasks: [] };
  expect(
    buildCheckInTemplate(empty, 'morning', DATE, null, null, {
      text: '背 20 个单词',
      due: DATE
    })
  ).toBe('早上好。今天还没有安排任务，想先做点什么？\n你说今天要做「背 20 个单词」，做了吗？');
  expect(buildCheckInTemplate(empty, 'morning', DATE, null, null, null)).toBe(
    '早上好。今天还没有安排任务，想先做点什么？'
  );
});
