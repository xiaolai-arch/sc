import {
  backupAgeLine,
  backupFailureLines,
  buildCheckInPrompt,
  buildCheckInTemplate,
  morningRecoveryLine,
  nextStepCheckInLine,
  resumeCheckInLine,
  tomorrowCheckInLine,
  WEEK_AVAILABILITY_QUESTION,
  weekAvailabilityQuestion,
  type BackupStatusLike,
  type TomorrowBridgeLike,
  type WeeklyOverviewLike
} from '../../src/main/check-ins/prompt';
import {
  normalizeTomorrow,
  STALE_TOMORROW_THRESHOLD,
  tomorrowBridge,
  type TomorrowBridgeReview
} from '../../src/shared/review-stats';
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
    `本周完成 3 个任务 · 专注 135 分钟 · 正确率 83%\n${WEEKLY_TEMPLATE_BEFORE_STATS}\n${WEEK_AVAILABILITY_QUESTION}`
  );
});

test('the recap line omits accuracy before the first answer', () => {
  expect(
    buildCheckInTemplate(context, 'weekly', DATE, { ...stats, answered: 0, correct: 0 })
  ).toBe(
    `本周完成 3 个任务 · 专注 135 分钟\n${WEEKLY_TEMPLATE_BEFORE_STATS}\n${WEEK_AVAILABILITY_QUESTION}`
  );
});

test('the weekly template asks the availability question exactly once, last', () => {
  const weekly = buildCheckInTemplate(context, 'weekly', DATE, stats, {
    calibration: '有把握但错 2 道 · 没把握但对 1 道',
    nextStep: '下周先练「三角函数」的到期错题（3 道）'
  });
  expect(weekly.split(WEEK_AVAILABILITY_QUESTION)).toHaveLength(2);
  expect(weekly.endsWith(WEEK_AVAILABILITY_QUESTION)).toBe(true);
});

test('the weekly template is unchanged without stats or with an all-zero week', () => {
  expect(buildCheckInTemplate(context, 'weekly', DATE, null)).toBe(
    `${WEEKLY_TEMPLATE_BEFORE_STATS}\n${WEEK_AVAILABILITY_QUESTION}`
  );
  expect(buildCheckInTemplate(context, 'weekly', DATE)).toBe(
    `${WEEKLY_TEMPLATE_BEFORE_STATS}\n${WEEK_AVAILABILITY_QUESTION}`
  );
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
  ).toBe(`${WEEKLY_TEMPLATE_BEFORE_STATS}\n${WEEK_AVAILABILITY_QUESTION}`);
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
      '下一步：下周先练「三角函数」的到期错题（3 道）',
      WEEK_AVAILABILITY_QUESTION
    ].join('\n')
  );
});

test('honest lines stand alone when the week has no recap numbers', () => {
  expect(buildCheckInTemplate(context, 'weekly', DATE, null, honest)).toBe(
    [
      WEEKLY_TEMPLATE_BEFORE_STATS,
      '有把握但错 2 道 · 没把握但对 1 道',
      '下一步：下周先练「三角函数」的到期错题（3 道）',
      WEEK_AVAILABILITY_QUESTION
    ].join('\n')
  );
});

test('only the non-null honest line is appended', () => {
  expect(
    buildCheckInTemplate(context, 'weekly', DATE, null, {
      calibration: null,
      nextStep: '下周先练「三角函数」的到期错题（3 道）'
    })
  ).toBe(
    `${WEEKLY_TEMPLATE_BEFORE_STATS}\n下一步：下周先练「三角函数」的到期错题（3 道）\n${WEEK_AVAILABILITY_QUESTION}`
  );
  expect(
    buildCheckInTemplate(context, 'weekly', DATE, null, {
      calibration: '有把握但错 2 道 · 没把握但对 1 道',
      nextStep: null
    })
  ).toBe(
    `${WEEKLY_TEMPLATE_BEFORE_STATS}\n有把握但错 2 道 · 没把握但对 1 道\n${WEEK_AVAILABILITY_QUESTION}`
  );
});

test('no honest facts leaves the weekly template byte-identical', () => {
  expect(buildCheckInTemplate(context, 'weekly', DATE, stats, null)).toBe(
    `本周完成 3 个任务 · 专注 135 分钟 · 正确率 83%\n${WEEKLY_TEMPLATE_BEFORE_STATS}\n${WEEK_AVAILABILITY_QUESTION}`
  );
  expect(
    buildCheckInTemplate(context, 'weekly', DATE, stats, {
      calibration: null,
      nextStep: null
    })
  ).toBe(
    `本周完成 3 个任务 · 专注 135 分钟 · 正确率 83%\n${WEEKLY_TEMPLATE_BEFORE_STATS}\n${WEEK_AVAILABILITY_QUESTION}`
  );
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
  // The clause ends before the deterministic availability question.
  expect(weekly.endsWith(`${clause}\n${WEEK_AVAILABILITY_QUESTION}`)).toBe(true);
  expect(weekly).toBe(
    buildCheckInTemplate(context, 'weekly', DATE, stats, honest).replace(
      WEEK_AVAILABILITY_QUESTION,
      `${clause}\n${WEEK_AVAILABILITY_QUESTION}`
    )
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

// --- the backup age line (weekly only, opt-in) -------------------------------

const BACKUP_ON: BackupStatusLike = { ageLineEnabled: true };

test('backupAgeLine produces exactly one factual sentence', () => {
  // 2026-11-05 is three days before the 2026-11-08 check-in.
  expect(
    backupAgeLine({ ageLineEnabled: true, lastBackupAt: '2026-11-05T14:32:10' }, DATE)
  ).toBe('上次导出备份是 3 天前（11月5日）。');
  // The clock time never leaks into the age sentence.
  expect(
    backupAgeLine({ ageLineEnabled: true, lastBackupAt: '2026-10-09T08:00:59' }, DATE)
  ).toBe('上次导出备份是 30 天前（10月9日）。');
});

test('backupAgeLine says nothing for today, the future or a bad date', () => {
  expect(
    backupAgeLine({ ageLineEnabled: true, lastBackupAt: `${DATE}T09:00:00` }, DATE)
  ).toBe('');
  // Clock skew: a future record never becomes a negative age.
  expect(
    backupAgeLine({ ageLineEnabled: true, lastBackupAt: '2026-11-09T09:00:00' }, DATE)
  ).toBe('');
  // Junk and impossible dates read as "no record", never as a wrong fact.
  expect(
    backupAgeLine({ ageLineEnabled: true, lastBackupAt: '上周' }, DATE)
  ).toBe('还没有导出备份。');
  expect(
    backupAgeLine({ ageLineEnabled: true, lastBackupAt: '2026-02-30T10:00:00' }, DATE)
  ).toBe('还没有导出备份。');
  expect(
    backupAgeLine({ ageLineEnabled: true, lastBackupAt: '2026-11-05T14:32' }, DATE)
  ).toBe('还没有导出备份。');
});

test('backupAgeLine is off by default and needs a real check-in date', () => {
  expect(backupAgeLine(undefined, DATE)).toBe('');
  expect(backupAgeLine(null, DATE)).toBe('');
  expect(backupAgeLine({}, DATE)).toBe('');
  expect(backupAgeLine({ ageLineEnabled: false, lastBackupAt: '2026-11-05T14:32:10' }, DATE)).toBe('');
  expect(backupAgeLine(BACKUP_ON, '')).toBe('');
  expect(backupAgeLine(BACKUP_ON, '下周')).toBe('');
});

const AGE_LINE = '上次导出备份是 3 天前（11月5日）。';

test('the weekly template appends the age line after the honest receipt', () => {
  const withHonest = buildCheckInTemplate(
    context,
    'weekly',
    DATE,
    stats,
    honest,
    null,
    { ageLineEnabled: true, lastBackupAt: '2026-11-05T14:32:10' }
  );
  expect(withHonest).toBe(
    [
      '本周完成 3 个任务 · 专注 135 分钟 · 正确率 83%',
      WEEKLY_TEMPLATE_BEFORE_STATS,
      '有把握但错 2 道 · 没把握但对 1 道',
      '下一步：下周先练「三角函数」的到期错题（3 道）',
      AGE_LINE,
      WEEK_AVAILABILITY_QUESTION
    ].join('\n')
  );
  expect(withHonest.split(AGE_LINE)).toHaveLength(2);

  // Without honest facts the age line still sits before the question.
  const withoutHonest = buildCheckInTemplate(
    context,
    'weekly',
    DATE,
    null,
    null,
    null,
    { ageLineEnabled: true, lastBackupAt: '2026-11-05T14:32:10' }
  );
  expect(withoutHonest).toBe(
    `${WEEKLY_TEMPLATE_BEFORE_STATS}\n${AGE_LINE}\n${WEEK_AVAILABILITY_QUESTION}`
  );
});

test('the weekly template names a missing record once, before the question', () => {
  expect(
    buildCheckInTemplate(context, 'weekly', DATE, null, null, null, BACKUP_ON)
  ).toBe(`${WEEKLY_TEMPLATE_BEFORE_STATS}\n还没有导出备份。\n${WEEK_AVAILABILITY_QUESTION}`);
});

test('a same-day export leaves the weekly template byte-identical', () => {
  const enabled = { ageLineEnabled: true, lastBackupAt: `${DATE}T09:15:00` };
  expect(buildCheckInTemplate(context, 'weekly', DATE, null, null, null, enabled)).toBe(
    `${WEEKLY_TEMPLATE_BEFORE_STATS}\n${WEEK_AVAILABILITY_QUESTION}`
  );
  expect(buildCheckInTemplate(context, 'weekly', DATE, null, null, null, enabled)).toBe(
    buildCheckInTemplate(context, 'weekly', DATE)
  );
});

test('the switch off keeps the weekly template byte-identical', () => {
  const withRecord = { ageLineEnabled: false, lastBackupAt: '2026-11-05T14:32:10' };
  expect(
    buildCheckInTemplate(context, 'weekly', DATE, null, null, null, withRecord)
  ).toBe(buildCheckInTemplate(context, 'weekly', DATE));
});

test('an enabled switch with no record names the gap even with honest facts', () => {
  expect(
    buildCheckInTemplate(context, 'weekly', DATE, stats, honest, null, BACKUP_ON)
  ).toBe(
    [
      '本周完成 3 个任务 · 专注 135 分钟 · 正确率 83%',
      WEEKLY_TEMPLATE_BEFORE_STATS,
      '有把握但错 2 道 · 没把握但对 1 道',
      '下一步：下周先练「三角函数」的到期错题（3 道）',
      '还没有导出备份。',
      WEEK_AVAILABILITY_QUESTION
    ].join('\n')
  );
});

test('the age line never enters the other triggers or the model prompt', () => {
  const enabled = { ageLineEnabled: true, lastBackupAt: '2026-11-05T14:32:10' };
  for (const trigger of ['morning', 'evening', 'behind'] as const) {
    expect(buildCheckInTemplate(context, trigger, DATE, null, null, null, enabled)).toBe(
      buildCheckInTemplate(context, trigger, DATE)
    );
  }
  const prompt = buildCheckInPrompt(context, 'weekly', DATE, stats, honest);
  expect(prompt).not.toContain('上次导出备份');
  expect(prompt).not.toContain('还没有导出备份');
  expect(prompt).not.toContain('上次备份');
});

// --- the auto-backup failure copy (weekly only, said once) --------------------

const FAILURE_REASON = '磁盘空间不足';

const FAILURE_COPY =
  '自动备份没有成功（磁盘空间不足）。你的数据没有被动过；可以稍后重试，或在「设置 → 数据与备份」手动导出。';

test('backupFailureLines builds the three-layer copy from a pending reason', () => {
  expect(backupFailureLines({ lastBackupError: FAILURE_REASON })).toEqual([FAILURE_COPY]);
  // A blank or absent reason is nothing pending, not an empty sentence.
  expect(backupFailureLines({ lastBackupError: '  ' })).toEqual([]);
  expect(backupFailureLines({})).toEqual([]);
  expect(backupFailureLines(null)).toEqual([]);
  expect(backupFailureLines(undefined)).toEqual([]);
});

test('the weekly template appends the failure copy after the age line, before the question', () => {
  const both = buildCheckInTemplate(
    context,
    'weekly',
    DATE,
    null,
    null,
    null,
    { ageLineEnabled: true, lastBackupAt: '2026-11-05T14:32:10', lastBackupError: FAILURE_REASON }
  );
  expect(both).toBe(
    `${WEEKLY_TEMPLATE_BEFORE_STATS}\n${AGE_LINE}\n${FAILURE_COPY}\n${WEEK_AVAILABILITY_QUESTION}`
  );
  expect(both.split('自动备份没有成功')).toHaveLength(2);

  // A pending failure without the age switch sits in the same slot.
  const failureOnly = buildCheckInTemplate(
    context,
    'weekly',
    DATE,
    null,
    null,
    null,
    { lastBackupError: FAILURE_REASON }
  );
  expect(failureOnly).toBe(
    `${WEEKLY_TEMPLATE_BEFORE_STATS}\n${FAILURE_COPY}\n${WEEK_AVAILABILITY_QUESTION}`
  );

  // No pending reason keeps the template at its previous bytes.
  const clean = { ageLineEnabled: false, lastBackupError: '' };
  expect(buildCheckInTemplate(context, 'weekly', DATE, null, null, null, clean)).toBe(
    buildCheckInTemplate(context, 'weekly', DATE)
  );
});

test('the failure copy never enters the other triggers or the model prompt', () => {
  const pending = { lastBackupError: FAILURE_REASON };
  for (const trigger of ['morning', 'evening', 'behind'] as const) {
    expect(buildCheckInTemplate(context, trigger, DATE, null, null, null, pending)).toBe(
      buildCheckInTemplate(context, trigger, DATE)
    );
  }
  const prompt = buildCheckInPrompt(context, 'weekly', DATE, stats, honest);
  expect(prompt).not.toContain('自动备份没有成功');
});

// --- the weekly availability question ---------------------------------------

const NO_WORKSPACE: ButlerContext = { ...context, workspaces: [] };

test('the weekly template asks which days next week are packed', () => {
  const weekly = buildCheckInTemplate(context, 'weekly', DATE);
  expect(weekly.endsWith(WEEK_AVAILABILITY_QUESTION)).toBe(true);
  expect(weekly).toBe(
    `${WEEKLY_TEMPLATE_BEFORE_STATS}\n${WEEK_AVAILABILITY_QUESTION}`
  );
});

test('no workspace leaves the weekly template byte-identical', () => {
  expect(buildCheckInTemplate(NO_WORKSPACE, 'weekly', DATE)).toBe(
    WEEKLY_TEMPLATE_BEFORE_STATS
  );
  expect(buildCheckInTemplate(NO_WORKSPACE, 'weekly', DATE, stats, honest)).toBe(
    [
      '本周完成 3 个任务 · 专注 135 分钟 · 正确率 83%',
      WEEKLY_TEMPLATE_BEFORE_STATS,
      '有把握但错 2 道 · 没把握但对 1 道',
      '下一步：下周先练「三角函数」的到期错题（3 道）'
    ].join('\n')
  );
});

test('the question never enters the model prompt or other triggers', () => {
  // Like the accountability clause, the ask is deterministic and delivered
  // after the message; the model must not restate it in its own words.
  expect(buildCheckInPrompt(context, 'weekly', DATE, stats, honest)).not.toContain(
    WEEK_AVAILABILITY_QUESTION
  );
  expect(buildCheckInPrompt(context, 'weekly', DATE, stats, honest)).not.toContain(
    '特别满'
  );
  expect(buildCheckInPrompt(context, 'morning', DATE)).not.toContain(
    WEEK_AVAILABILITY_QUESTION
  );
  for (const trigger of ['morning', 'evening', 'behind'] as const) {
    expect(buildCheckInTemplate(context, trigger, DATE, stats, honest)).not.toContain(
      WEEK_AVAILABILITY_QUESTION
    );
  }
});

test('weekAvailabilityQuestion is empty without a workspace', () => {
  expect(weekAvailabilityQuestion(context)).toBe(WEEK_AVAILABILITY_QUESTION);
  expect(weekAvailabilityQuestion(NO_WORKSPACE)).toBe('');
});

// --- the mute-resume line ----------------------------------------------------

test('resumeCheckInLine produces exactly one factual first-day sentence', () => {
  expect(resumeCheckInLine('2026-11-07', DATE)).toBe(
    '你之前暂停到 11月7日，今天是恢复的第一天。'
  );
  // The same day is still the first day back.
  expect(resumeCheckInLine(DATE, DATE)).toBe(
    '你之前暂停到 11月8日，今天是恢复的第一天。'
  );
  // A day after the check-in, a junk day, or nothing pending says nothing.
  expect(resumeCheckInLine('2026-11-09', DATE)).toBe('');
  expect(resumeCheckInLine('上周', DATE)).toBe('');
  expect(resumeCheckInLine(null, DATE)).toBe('');
  expect(resumeCheckInLine(undefined, DATE)).toBe('');
  expect(resumeCheckInLine('', DATE)).toBe('');
  // The structured form for a natural expiry is byte-identical to the string.
  expect(resumeCheckInLine({ day: '2026-11-07' }, DATE)).toBe(
    '你之前暂停到 11月7日，今天是恢复的第一天。'
  );
});

test('resumeCheckInLine names the original end for an early manual resume', () => {
  // The user resumed today; the mute would have run to a later day. The
  // sentence must say the pause was cut short, naming the day it would have
  // ended, and must not claim the mute already ended.
  expect(resumeCheckInLine({ day: DATE, muteEnd: '2026-11-13' }, DATE)).toBe(
    '你提前恢复了提醒，原定暂停到 11月13日。'
  );
  // It is not positive-gated by the check date: the mute end is still ahead.
  expect(resumeCheckInLine({ day: '2026-11-08', muteEnd: '2026-11-13' }, DATE)).toBe(
    '你提前恢复了提醒，原定暂停到 11月13日。'
  );
  // A malformed muteEnd says nothing rather than a half sentence.
  expect(resumeCheckInLine({ day: DATE, muteEnd: '下周' }, DATE)).toBe('');
  // A non-date day still says nothing.
  expect(resumeCheckInLine({ day: '上周', muteEnd: '2026-11-13' }, DATE)).toBe('');
});

test('the resume sentence is never handed to the model', () => {
  for (const trigger of ['morning', 'evening', 'weekly', 'behind'] as const) {
    const prompt = buildCheckInPrompt(context, trigger, DATE, null, null, null);
    expect(prompt).not.toContain('恢复的第一天');
    expect(prompt).not.toContain('暂停到');
  }
  // The prompt builder signature has no resume input at all, so no call site
  // can leak it into a model prompt by accident.
  expect(buildCheckInPrompt.length).toBeLessThanOrEqual(6);
});

// --- the fresh-start line (morning after a missed review day) -----------------

const FRESH_START_LINE = '昨天没有复盘，新的一天从一件小事开始就行。';
const MORNING_BASE =
  '早上好。今天有 1 个任务，先做「极限基础」怎么样？做完告诉我一声。';
const PROMISE_YESTERDAY = '昨天你说要做「背 20 个单词」，做了吗？没做的话，挪到今天还是先放一放？';

test('the morning template appends the fresh-start line after the greeting', () => {
  expect(
    buildCheckInTemplate(context, 'morning', DATE, null, null, null, null, {
      freshStart: true
    })
  ).toBe(`${MORNING_BASE}\n${FRESH_START_LINE}`);
});

test('the fresh-start line precedes the promise line when both fire, in that order', () => {
  const template = buildCheckInTemplate(
    context,
    'morning',
    DATE,
    null,
    null,
    { text: '背 20 个单词', due: '2026-11-07' },
    null,
    { freshStart: true }
  );
  expect(template).toBe([MORNING_BASE, FRESH_START_LINE, PROMISE_YESTERDAY].join('\n'));
  expect(template.indexOf(FRESH_START_LINE)).toBeLessThan(template.indexOf(PROMISE_YESTERDAY));
  // Each line appears exactly once.
  expect(template.split(FRESH_START_LINE)).toHaveLength(2);
  expect(template.split(PROMISE_YESTERDAY)).toHaveLength(2);
});

test('the empty-plan morning template keeps the same fixed order', () => {
  const empty: ButlerContext = { ...context, tasks: [] };
  expect(
    buildCheckInTemplate(
      empty,
      'morning',
      DATE,
      null,
      null,
      { text: '背 20 个单词', due: DATE },
      null,
      { freshStart: true }
    )
  ).toBe(
    [
      '早上好。今天还没有安排任务，想先做点什么？',
      FRESH_START_LINE,
      '你说今天要做「背 20 个单词」，做了吗？'
    ].join('\n')
  );
});

test('an absent or negative fresh-start fact keeps the morning template byte-identical', () => {
  expect(buildCheckInTemplate(context, 'morning', DATE, null, null, null, null, null)).toBe(
    MORNING_BASE
  );
  expect(
    buildCheckInTemplate(context, 'morning', DATE, null, null, null, null, { freshStart: false })
  ).toBe(MORNING_BASE);
  expect(buildCheckInTemplate(context, 'morning', DATE)).toBe(MORNING_BASE);
  // With a promise due, a negative fact changes nothing either.
  const commitment = { text: '背 20 个单词', due: '2026-11-07' };
  expect(
    buildCheckInTemplate(context, 'morning', DATE, null, null, commitment, null, {
      freshStart: false
    })
  ).toBe(`${MORNING_BASE}\n${PROMISE_YESTERDAY}`);
});

test('the fresh-start line never enters the model prompt', () => {
  // Like the resume sentence it is code-owned: the prompt builder has no
  // input for it, so no call site can leak it into a model prompt.
  expect(buildCheckInPrompt.length).toBeLessThanOrEqual(6);
  expect(buildCheckInPrompt(context, 'morning', DATE)).not.toContain('昨天没有复盘');
});

test('no other trigger carries the fresh-start line', () => {
  for (const trigger of ['weekly', 'evening', 'behind'] as const) {
    expect(
      buildCheckInTemplate(context, trigger, DATE, null, null, null, null, { freshStart: true })
    ).toBe(buildCheckInTemplate(context, trigger, DATE));
  }
});

// --- the tomorrow bridge (iter33 P0) -----------------------------------------

const STEP = '把第三章的错题重做一遍';
const LINE_A = `你在复盘里写下明天第一步：${STEP}——今天第一件事就是它吗？`;
const LINE_B = '这步写了好几天了——要不要把它切小一点，或者干脆换一步？';

function tomorrowReview(
  date: string,
  tomorrow: unknown,
  submittedAt = `${date}T21:30:00`
): TomorrowBridgeReview {
  return { date, submittedAt, tomorrow };
}

test('the staleness threshold is the spec-filled default of 3', () => {
  expect(STALE_TOMORROW_THRESHOLD).toBe(3);
});

test('tomorrowBridge hands back the newest pre-today review with a non-empty tomorrow', () => {
  const reviews = [
    tomorrowReview('2026-11-05', '早上的计划'),
    tomorrowReview('2026-11-06', STEP),
    // Newest before today, but empty: selection falls to the one above.
    tomorrowReview('2026-11-07', '   '),
    // Dated today: can never leak into this morning's line.
    tomorrowReview('2026-11-08', '今天才写的')
  ];
  expect(tomorrowBridge(reviews, DATE)).toEqual({ tomorrow: STEP, stale: false });
  // Unordered input is re-sorted by submittedAt, like readReviews does.
  expect(tomorrowBridge([...reviews].reverse(), DATE)).toEqual({
    tomorrow: STEP,
    stale: false
  });
});

test('tomorrowBridge reads empty, blank and badly-typed tomorrows as no data', () => {
  expect(tomorrowBridge([], DATE)).toBeNull();
  expect(tomorrowBridge([tomorrowReview('2026-11-07', '')], DATE)).toBeNull();
  expect(tomorrowBridge([tomorrowReview('2026-11-07', '  \n\t ')], DATE)).toBeNull();
  expect(tomorrowBridge([tomorrowReview('2026-11-07', 42)], DATE)).toBeNull();
  expect(tomorrowBridge([tomorrowReview('2026-11-07', null)], DATE)).toBeNull();
  expect(tomorrowBridge([tomorrowReview('2026-11-07', {})], DATE)).toBeNull();
});

test('normalizeTomorrow trims and collapses whitespace runs, and nothing else', () => {
  expect(normalizeTomorrow('  背\t\n 单词 \t')).toBe('背 单词');
  expect(normalizeTomorrow('背  单词')).toBe(normalizeTomorrow('背 单词'));
  // Full- and half-width characters are different spellings: 写什么比什么.
  expect(normalizeTomorrow('ＡＢ卷')).toBe('ＡＢ卷');
  expect(normalizeTomorrow('ＡＢ卷')).not.toBe(normalizeTomorrow('AB卷'));
});

test('three normalized-identical tomorrows produce the staleness line only (验收 3)', () => {
  const reviews = [
    tomorrowReview('2026-11-05', '  背\t单词  '),
    tomorrowReview('2026-11-06', '背 单词'),
    tomorrowReview('2026-11-07', '背  单词 ')
  ];
  const facts = tomorrowBridge(reviews, DATE);
  expect(facts?.stale).toBe(true);
  expect(tomorrowCheckInLine(facts)).toBe(LINE_B);
  // Line B replaces line A; there is no embed beside it.
  expect(tomorrowCheckInLine(facts)).not.toContain('你在复盘里写下');
});

test('a differing third step keeps the regular line A (验收 3)', () => {
  const reviews = [
    tomorrowReview('2026-11-05', '换英语单词'),
    tomorrowReview('2026-11-06', STEP),
    tomorrowReview('2026-11-07', STEP)
  ];
  const facts = tomorrowBridge(reviews, DATE);
  expect(facts?.stale).toBe(false);
  expect(tomorrowCheckInLine(facts)).toBe(LINE_A);
  // Two identical steps alone never reach the threshold.
  expect(
    tomorrowBridge(
      [tomorrowReview('2026-11-06', STEP), tomorrowReview('2026-11-07', STEP)],
      DATE
    )?.stale
  ).toBe(false);
  // Full-width vs half-width spellings count as different steps.
  const widths = [
    tomorrowReview('2026-11-05', 'ＡＢ卷'),
    tomorrowReview('2026-11-06', 'AB卷'),
    tomorrowReview('2026-11-07', 'ＡＢ卷')
  ];
  const widthFacts = tomorrowBridge(widths, DATE);
  expect(widthFacts?.stale).toBe(false);
  expect(tomorrowCheckInLine(widthFacts)).toBe(LINE_A.replace(STEP, 'ＡＢ卷'));
});

test('an empty tomorrow in between neither breaks the run nor counts toward it (验收 5)', () => {
  // Case 1 — 不断开: a reset-based count would stop at the empty review and
  // see only two consecutive steps; skipping it keeps three, so line B fires.
  const notBreaking = [
    tomorrowReview('2026-11-04', STEP),
    tomorrowReview('2026-11-05', ''),
    tomorrowReview('2026-11-06', STEP),
    tomorrowReview('2026-11-07', STEP)
  ];
  expect(tomorrowBridge(notBreaking, DATE)?.stale).toBe(true);
  // Case 2 — 不计入: the newest review is empty. If empties consumed a
  // threshold slot the window would be [empty, STEP, STEP] and line B would
  // not fire; skipping it keeps three counted same steps.
  const notCounting = [
    tomorrowReview('2026-11-04', STEP),
    tomorrowReview('2026-11-05', STEP),
    tomorrowReview('2026-11-06', STEP),
    tomorrowReview('2026-11-07', '   ')
  ];
  expect(tomorrowBridge(notCounting, DATE)?.stale).toBe(true);
});

test('line A embeds the step verbatim and neither line ever says 昨天', () => {
  expect(tomorrowCheckInLine({ tomorrow: STEP, stale: false })).toBe(LINE_A);
  expect(LINE_A).not.toContain('昨天');
  expect(LINE_B).not.toContain('昨天');
  expect(LINE_A).toContain('你在复盘里写下');
});

test('a tomorrow past 60 code points is truncated to 57 plus an ellipsis', () => {
  // Exactly 60 code points embeds unchanged.
  const exact = '一'.repeat(60);
  expect(tomorrowCheckInLine({ tomorrow: exact, stale: false })).toBe(
    `你在复盘里写下明天第一步：${exact}——今天第一件事就是它吗？`
  );
  // One over cuts at 57 code points plus 「…」.
  const over = '一'.repeat(61);
  expect(tomorrowCheckInLine({ tomorrow: over, stale: false })).toBe(
    `你在复盘里写下明天第一步：${'一'.repeat(57)}…——今天第一件事就是它吗？`
  );
  // Astral characters are one code point each, never split in half.
  const astralLine = tomorrowCheckInLine({ tomorrow: '𠮷'.repeat(61), stale: false });
  const embedded = astralLine.slice(
    astralLine.indexOf('：') + 1,
    astralLine.indexOf('——')
  );
  expect([...embedded]).toHaveLength(58);
  expect(embedded.endsWith('…')).toBe(true);
  // Code-point slicing: UTF-16 .slice would cut a surrogate pair in half.
  expect([...embedded].slice(0, 57).join('')).toBe('𠮷'.repeat(57));
  // The staleness variant has no embed, so truncation never touches it.
  expect(tomorrowCheckInLine({ tomorrow: over, stale: true })).toBe(LINE_B);
});

test('absent or empty facts keep the empty line', () => {
  expect(tomorrowCheckInLine(null)).toBe('');
  expect(tomorrowCheckInLine(undefined)).toBe('');
  expect(tomorrowCheckInLine({} as unknown as TomorrowBridgeLike)).toBe('');
  expect(tomorrowCheckInLine({ tomorrow: '', stale: false })).toBe('');
  expect(tomorrowCheckInLine({ tomorrow: '   ', stale: true })).toBe('');
  expect(tomorrowCheckInLine({ tomorrow: 42 as unknown as string, stale: false })).toBe('');
});

test('the morning template appends exactly one bridge line, stale or not', () => {
  const regular = buildCheckInTemplate(
    context, 'morning', DATE, null, null, null, null, null, { tomorrow: STEP, stale: false }
  );
  expect(regular).toBe(`${MORNING_BASE}\n${LINE_A}`);
  expect(regular.split(LINE_A)).toHaveLength(2);
  const stale = buildCheckInTemplate(
    context, 'morning', DATE, null, null, null, null, null, { tomorrow: STEP, stale: true }
  );
  expect(stale).toBe(`${MORNING_BASE}\n${LINE_B}`);
  expect(stale).not.toContain('你在复盘里写下');
});

test('the bridge line stacks after the fresh-start and promise lines, in that order', () => {
  const all = buildCheckInTemplate(
    context,
    'morning',
    DATE,
    null,
    null,
    { text: '背 20 个单词', due: '2026-11-07' },
    null,
    { freshStart: true },
    { tomorrow: STEP, stale: false }
  );
  expect(all).toBe([MORNING_BASE, FRESH_START_LINE, PROMISE_YESTERDAY, LINE_A].join('\n'));
});

test('no bridge fact keeps the morning template byte-identical', () => {
  expect(buildCheckInTemplate(context, 'morning', DATE)).toBe(MORNING_BASE);
  expect(
    buildCheckInTemplate(context, 'morning', DATE, null, null, null, null, null, null)
  ).toBe(MORNING_BASE);
  expect(
    buildCheckInTemplate(context, 'morning', DATE, null, null, null, null, null, {
      tomorrow: '',
      stale: false
    })
  ).toBe(MORNING_BASE);
});

test('no other trigger carries the bridge line, and the model never sees it', () => {
  const facts: TomorrowBridgeLike = { tomorrow: STEP, stale: false };
  for (const trigger of ['weekly', 'evening', 'behind'] as const) {
    expect(
      buildCheckInTemplate(context, trigger, DATE, null, null, null, null, null, facts)
    ).toBe(buildCheckInTemplate(context, trigger, DATE));
  }
  // Like the fresh-start line the bridge is code-owned: the prompt builder
  // takes no such input, so no call site can leak it into a model prompt.
  expect(buildCheckInPrompt.length).toBeLessThanOrEqual(6);
  expect(buildCheckInPrompt(context, 'morning', DATE)).not.toContain('明天第一步');
  expect(buildCheckInPrompt(context, 'morning', DATE)).not.toContain(STEP);
});

// --- the task next-step priority (iter33 P2b②) -------------------------------

const TASK_LINE = `极限基础 的下一步已经记好：先把例题抄一遍——从它开始？`;

function taskWithNextStep(
  overrides: Partial<WorkspaceTask> = {}
): WorkspaceTask {
  return { ...task, nextStep: '先把例题抄一遍', ...overrides };
}

test('nextStepCheckInLine states the task line once, word for word', () => {
  expect(nextStepCheckInLine(taskWithNextStep())).toBe(TASK_LINE);
  expect(nextStepCheckInLine(taskWithNextStep())).not.toContain('你在复盘里写下');
});

test('a task without a next step keeps the empty line', () => {
  expect(nextStepCheckInLine(null)).toBe('');
  expect(nextStepCheckInLine(undefined)).toBe('');
  expect(nextStepCheckInLine(task)).toBe('');
  expect(nextStepCheckInLine({ title: '', nextStep: '有步骤' })).toBe('');
  expect(nextStepCheckInLine({ title: '极限基础', nextStep: '   ' })).toBe('');
});

test('morningRecoveryLine: task line first, review line falls back, never both (验收 22)', () => {
  const facts: TomorrowBridgeLike = { tomorrow: STEP, stale: false };
  // Priority 1: the first unfinished task carries a next step → task line.
  expect(morningRecoveryLine(taskWithNextStep(), facts)).toBe(TASK_LINE);
  // Priority 2: no next step on the task → the P0 review line A.
  expect(morningRecoveryLine(task, facts)).toBe(LINE_A);
  // The staleness variant B still falls through the same slot.
  expect(morningRecoveryLine(task, { tomorrow: STEP, stale: true })).toBe(LINE_B);
  // Neither fact → empty (byte-identical baseline).
  expect(morningRecoveryLine(task, null)).toBe('');
  expect(morningRecoveryLine(null, null)).toBe('');
  // At most one line: the task line never sits beside line A/B.
  const line = morningRecoveryLine(taskWithNextStep(), facts);
  expect(line.split('\n')).toHaveLength(1);
  expect(line).toBe(TASK_LINE);
});

test('the morning template speaks the task line in place of the review line', () => {
  const withStep: ButlerContext = {
    ...context,
    tasks: [taskWithNextStep()]
  };
  const template = buildCheckInTemplate(
    withStep,
    'morning',
    DATE,
    null,
    null,
    null,
    null,
    null,
    { tomorrow: STEP, stale: false }
  );
  expect(template).toBe([MORNING_BASE, TASK_LINE].join('\n'));
  expect(template).not.toContain(LINE_A);
});

test('a first task without a next step keeps the P0 review line', () => {
  // The review's tomorrow stands in exactly as before (P0 baseline bytes).
  const template = buildCheckInTemplate(
    context,
    'morning',
    DATE,
    null,
    null,
    null,
    null,
    null,
    { tomorrow: STEP, stale: false }
  );
  expect(template).toBe([MORNING_BASE, LINE_A].join('\n'));
});

test('no next step and no bridge keeps the morning template byte-identical', () => {
  expect(buildCheckInTemplate(context, 'morning', DATE)).toBe(MORNING_BASE);
  const withStep = buildCheckInTemplate(
    { ...context, tasks: [taskWithNextStep()] },
    'morning',
    DATE
  );
  // A recorded step with no bridge still speaks the task line.
  expect(withStep).toBe([MORNING_BASE, TASK_LINE].join('\n'));
});

test('no other trigger carries the task line (验收 22)', () => {
  const withStep: ButlerContext = { ...context, tasks: [taskWithNextStep()] };
  for (const trigger of ['weekly', 'evening', 'behind'] as const) {
    expect(buildCheckInTemplate(withStep, trigger, DATE)).toBe(
      buildCheckInTemplate(context, trigger, DATE)
    );
  }
});
