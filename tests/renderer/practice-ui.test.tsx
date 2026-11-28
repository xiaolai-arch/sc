// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {
  CreatePracticeSetInput,
  ExportMistakeSheetResult,
  PracticeAttempt,
  PracticeMistake,
  PracticeSet,
  SubmitAnswerResult
} from '../../src/shared/practice';
import type { Workspace } from '../../src/shared/workspace';
import { LearningPane } from '../../src/renderer/shell/LearningPane';
import { MistakeBook } from '../../src/renderer/shell/PracticePanels';
import { FluencyTrend } from '../../src/renderer/shell/FluencyTrend';
import { fluencyTrend } from '../../src/renderer/shell/fluency-trend';
import { AUTO_RECALL_MS } from '../../src/shared/practice';
import { pickOption } from './select-option';

type PaneProps = Parameters<typeof LearningPane>[0];

/**
 * 用时流畅度 fixture factory: a correct choice attempt on ps1/q1 by default,
 * with optional durationMs — absent means a legacy / mistake-review attempt.
 */
function timedAttempt(
  id: string,
  answeredAt: string,
  opts: { correct?: boolean; durationMs?: number; questionId?: string; setId?: string } = {}
): PracticeAttempt {
  return {
    id,
    workspaceId: 'kaoyan',
    setId: opts.setId ?? 'ps1',
    questionId: opts.questionId ?? 'q1',
    choice: 1,
    ...(opts.durationMs !== undefined ? { durationMs: opts.durationMs } : {}),
    correct: opts.correct ?? true,
    answeredAt
  };
}

const workspace: Workspace = {
  id: 'kaoyan',
  name: '考研',
  kind: 'exam',
  color: '#0071e3',
  goal: '上岸',
  description: ''
};

const guokaoWorkspace: Workspace = {
  id: 'guokao',
  name: '2027 国考',
  kind: 'exam',
  color: '#ff9500',
  goal: '行测 75+',
  description: ''
};

const practiceSet: PracticeSet = {
  id: 'ps1',
  workspaceId: 'kaoyan',
  title: '极限基础',
  subject: '数学',
  questions: [
    {
      id: 'q1',
      prompt: '当 x→0 时，sin x / x 的极限是？',
      options: ['0', '1', '∞'],
      answer: 1,
      explanation: '第一个重要极限。'
    }
  ]
};

function mistake(index: number): PracticeMistake {
  return {
    id: `pm${index}`,
    workspaceId: 'kaoyan',
    setId: 'ps1',
    questionId: `q${index}`,
    prompt: `错题 ${index}`,
    options: ['A', 'B'],
    answer: 0,
    explanation: '',
    wrongCount: index,
    correctStreak: 0,
    priority: 1,
    intervalDays: 1,
    due: `2026-11-0${index}`,
    status: 'active',
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
    lastAnsweredAt: '2026-11-01T00:00:00.000Z'
  };
}

function renderPane(overrides: Partial<PaneProps> = {}) {
  return render(
    <LearningPane
      set={null}
      workspace={workspace}
      notes={[]}
      mistakes={[]}
      onSubmitAnswer={vi.fn(async () => {
        throw new Error('not used');
      })}
      onOpenChat={vi.fn()}
      onOpenNote={vi.fn()}
      {...overrides}
    />
  );
}

describe('LearningPane practice UI', () => {
  it('opens the create-set dialog, validates, and submits the right input', async () => {
    const user = userEvent.setup();
    const created: PracticeSet = {
      id: 'ps-new',
      workspaceId: 'kaoyan',
      title: '新练习',
      subject: '数学',
      questions: []
    };
    const onCreateSet = vi.fn(
      async (_input: CreatePracticeSetInput): Promise<PracticeSet> => created
    );

    renderPane({ onCreateSet });

    await user.click(screen.getByRole('button', { name: '新建练习集' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '创建练习集' }));
    expect(screen.getByRole('alert')).toHaveTextContent('请填写标题');

    await user.type(screen.getByLabelText('标题'), '新练习');
    await user.click(screen.getByRole('button', { name: '创建练习集' }));
    expect(screen.getByRole('alert')).toHaveTextContent('第 1 题的题干不能为空');

    await user.type(screen.getByLabelText('第 1 题题干'), '1 + 1 等于几？');
    await user.click(screen.getByRole('button', { name: '创建练习集' }));
    expect(screen.getByRole('alert')).toHaveTextContent('第 1 题的选项不能为空');

    await user.type(screen.getByLabelText('科目'), '数学');
    await user.type(screen.getByLabelText('第 1 题选项 1'), '1');
    await user.type(screen.getByLabelText('第 1 题选项 2'), '2');
    await pickOption('第 1 题正确答案', 'B · 2');
    await user.type(screen.getByLabelText('第 1 题解析'), '基础加法');

    await user.click(screen.getByRole('button', { name: '创建练习集' }));

    await waitFor(() => expect(onCreateSet).toHaveBeenCalledTimes(1));
    expect(onCreateSet).toHaveBeenCalledWith({
      workspaceId: 'kaoyan',
      title: '新练习',
      subject: '数学',
      questions: [
        {
          prompt: '1 + 1 等于几？',
          options: ['1', '2'],
          answer: 1,
          explanation: '基础加法'
        }
      ]
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('shows and lets the user change the destination project on create', async () => {
    const user = userEvent.setup();
    const onCreateSet = vi.fn(
      async (input: CreatePracticeSetInput): Promise<PracticeSet> => ({
        ...practiceSet,
        id: 'ps-new',
        workspaceId: input.workspaceId,
        title: input.title
      })
    );

    renderPane({
      workspace: guokaoWorkspace,
      workspaces: [workspace, guokaoWorkspace],
      onCreateSet
    });

    await user.click(screen.getByRole('button', { name: '新建练习集' }));
    // The destination defaults to the project the pane was opened from.
    expect(screen.getByLabelText('所属项目')).toHaveTextContent('2027 国考');

    await user.type(screen.getByLabelText('标题'), '判断推理');
    await user.type(screen.getByLabelText('第 1 题题干'), '图形推理');
    await user.type(screen.getByLabelText('第 1 题选项 1'), 'A');
    await user.type(screen.getByLabelText('第 1 题选项 2'), 'B');
    await pickOption('第 1 题正确答案', 'A · A');
    await pickOption('所属项目', '考研');
    await user.click(screen.getByRole('button', { name: '创建练习集' }));

    await waitFor(() => expect(onCreateSet).toHaveBeenCalledTimes(1));
    expect(onCreateSet.mock.calls[0]?.[0]).toMatchObject({ workspaceId: 'kaoyan' });
  });

  it('keeps the create actions outside the scrollable dialog body', async () => {
    const user = userEvent.setup();
    renderPane({ onCreateSet: vi.fn(async () => practiceSet) });

    await user.click(screen.getByRole('button', { name: '新建练习集' }));

    const dialog = screen.getByRole('dialog');
    const body = dialog.querySelector('[data-dialog-body]');
    const footer = dialog.querySelector('[data-dialog-footer]');
    expect(body).not.toBeNull();
    expect(footer).not.toBeNull();
    expect(body).not.toContainElement(screen.getByRole('button', { name: '创建练习集' }));
    expect(footer).toContainElement(screen.getByRole('button', { name: '创建练习集' }));
  });

  it('adds and removes question rows', async () => {
    const user = userEvent.setup();
    renderPane({ onCreateSet: vi.fn(async () => practiceSet) });

    await user.click(screen.getByRole('button', { name: '新建练习集' }));
    await user.click(screen.getByRole('button', { name: '添加题目' }));

    expect(screen.getByLabelText('第 2 题题干')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '删除第 2 题' }));
    expect(screen.queryByLabelText('第 2 题题干')).not.toBeInTheDocument();
  });

  it('hides the create button when onCreateSet is absent', () => {
    renderPane();

    expect(screen.queryByRole('button', { name: '新建练习集' })).not.toBeInTheDocument();
  });

  it('expands the mistake book into the full list and collapses it again', async () => {
    const user = userEvent.setup();
    const mistakes = Array.from({ length: 6 }, (_, index) => mistake(index + 1));

    renderPane({ mistakes });

    expect(screen.getByText('错题 1')).toBeInTheDocument();
    expect(screen.queryByText('错题 5')).not.toBeInTheDocument();
    expect(screen.queryByText('错题 6')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '查看全部错题' }));

    expect(screen.getByText('错题 5')).toBeInTheDocument();
    expect(screen.getByText('错题 6')).toBeInTheDocument();
    expect(screen.getByText(/2026-11-05 复习 · 错 5 次 · 优先级 1/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '收起' }));

    expect(screen.queryByText('错题 5')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '查看全部错题' })).toBeInTheDocument();
  });

  it('renders answer history with resolved prompts and hides it when empty', () => {
    const attempts: PracticeAttempt[] = [
      {
        id: 'pa1',
        workspaceId: 'kaoyan',
        setId: 'ps1',
        questionId: 'q1',
        choice: 1,
        correct: true,
        answeredAt: '2026-11-01T08:30:00.000Z'
      },
      {
        id: 'pa2',
        workspaceId: 'kaoyan',
        setId: 'ps1',
        questionId: 'q1',
        choice: 0,
        correct: false,
        answeredAt: '2026-11-02T09:15:00.000Z'
      },
      {
        id: 'pa3',
        workspaceId: 'kaoyan',
        setId: 'ps1',
        questionId: 'q1',
        choice: 0,
        response: '极限是 1',
        correct: true,
        answeredAt: '2026-11-03T09:15:00.000Z'
      }
    ];

    const view = renderPane({ set: practiceSet, attempts });

    expect(screen.getByText('答题历史')).toBeInTheDocument();
    expect(screen.getByText('2026-11-01 08:30')).toBeInTheDocument();
    expect(screen.getByText('2026-11-02 09:15')).toBeInTheDocument();
    expect(screen.getByText('2026-11-03 09:15')).toBeInTheDocument();
    expect(screen.getAllByText('回答正确')).toHaveLength(2);
    expect(screen.getByText('回答错误')).toBeInTheDocument();
    // A free-recall attempt shows what was typed.
    expect(screen.getByText('你写的是：极限是 1')).toBeInTheDocument();
    expect(screen.getAllByText(practiceSet.questions[0].prompt)).toHaveLength(4);

    view.unmount();

    renderPane({ attempts: [] });
    expect(screen.queryByText('答题历史')).not.toBeInTheDocument();
  });
});

describe('short-answer (free recall) practice UI', () => {
  const shortSet: PracticeSet = {
    id: 'ps-short',
    workspaceId: 'kaoyan',
    title: '简答练习',
    subject: '数学',
    questions: [
      {
        id: 'sq1',
        kind: 'short',
        prompt: '用自己的话说明第一个重要极限。',
        options: [],
        answer: 0,
        referenceAnswer: 'x→0 时 sin x / x 的极限是 1。',
        explanation: '夹逼准则可证。'
      }
    ]
  };

  function shortResult(correct: boolean): SubmitAnswerResult {
    return {
      questionId: 'sq1',
      setId: 'ps-short',
      workspaceId: 'kaoyan',
      choice: 0,
      correct,
      answer: 0,
      explanation: '夹逼准则可证。',
      attempt: {
        id: 'pa-short',
        workspaceId: 'kaoyan',
        setId: 'ps-short',
        questionId: 'sq1',
        choice: 0,
        response: '极限是 1',
        correct,
        answeredAt: '2026-11-01T09:00:00.000Z'
      },
      mistake: correct
        ? null
        : {
            ...mistake(1),
            questionId: 'sq1',
            kind: 'short',
            referenceAnswer: 'x→0 时 sin x / x 的极限是 1。',
            due: '2026-11-02'
          },
      due: correct ? undefined : '2026-11-02'
    };
  }

  it('reveals the reference answer on 提交 without recording anything', async () => {
    const user = userEvent.setup();
    const onSubmitShortAnswer = vi.fn(async () => shortResult(true));

    renderPane({ set: shortSet, onSubmitShortAnswer });

    expect(screen.getByLabelText('用你自己的话回答')).toBeInTheDocument();
    // Nothing is submitted until the learner self-assesses.
    expect(screen.getByRole('button', { name: '提交' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: '答对了' })).not.toBeInTheDocument();

    await user.type(screen.getByLabelText('用你自己的话回答'), '极限是 1');
    await user.click(screen.getByRole('button', { name: '提交' }));

    expect(screen.getByText('参考答案：x→0 时 sin x / x 的极限是 1。')).toBeInTheDocument();
    expect(screen.getByText('你写的是：极限是 1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '答对了' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '没答对' })).toBeInTheDocument();
    expect(onSubmitShortAnswer).not.toHaveBeenCalled();
  });

  it('records the attempt only when a self-assessment button is pressed', async () => {
    const user = userEvent.setup();
    const onSubmitShortAnswer = vi.fn(async () => shortResult(true));

    renderPane({ set: shortSet, onSubmitShortAnswer });
    await user.type(screen.getByLabelText('用你自己的话回答'), '极限是 1');
    await user.click(screen.getByRole('button', { name: '提交' }));
    await user.click(screen.getByRole('button', { name: '答对了' }));

    await waitFor(() => expect(onSubmitShortAnswer).toHaveBeenCalledTimes(1));
    expect(onSubmitShortAnswer).toHaveBeenCalledWith({
      questionId: 'sq1',
      response: '极限是 1',
      selfCorrect: true,
      durationMs: expect.any(Number)
    });
    expect(await screen.findByText('回答正确')).toBeInTheDocument();
  });

  it('marks a mis-recall through 没答对 and shows the scheduled review', async () => {
    const user = userEvent.setup();
    const onSubmitShortAnswer = vi.fn(async () => shortResult(false));

    renderPane({ set: shortSet, onSubmitShortAnswer });
    await user.type(screen.getByLabelText('用你自己的话回答'), '极限是 0');
    await user.click(screen.getByRole('button', { name: '提交' }));
    await user.click(screen.getByRole('button', { name: '没答对' }));

    await waitFor(() =>
      expect(onSubmitShortAnswer).toHaveBeenCalledWith({
        questionId: 'sq1',
        response: '极限是 0',
        selfCorrect: false,
        durationMs: expect.any(Number)
      })
    );
    expect(await screen.findByText('回答错误')).toBeInTheDocument();
    expect(screen.getByText('已加入错题本，2026-11-02 复习。')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// 对照检查点自查（P2a）：带检查点的简答题在 提交 与 对答案 之间多一步逐条自勾；
// 自查时不展示参考答案；对答案揭示面板不即时高亮——漏勾项（中性色，不给分）
// 在自评点击之后才渲染（spec :42 字面顺序，item 67 裁 A）。无检查点的简答题
// 保持基线两步流，UI 文案与步骤逐字节不变。
// ---------------------------------------------------------------------------

describe('checkpoint self-check (对照检查点自查)', () => {
  const checkpointSet: PracticeSet = {
    id: 'ps-cp',
    workspaceId: 'kaoyan',
    title: '检查点练习',
    subject: '数学',
    questions: [
      {
        id: 'sq-cp',
        kind: 'short',
        prompt: '说明第一个重要极限。',
        options: [],
        answer: 0,
        referenceAnswer: 'x→0 时 sin x / x 的极限是 1。',
        explanation: '',
        checkpoints: ['极限值是 1', '用到了夹逼准则']
      }
    ]
  };

  const plainShortSet: PracticeSet = {
    id: 'ps-plain',
    workspaceId: 'kaoyan',
    title: '普通简答',
    subject: '数学',
    questions: [
      {
        id: 'sq-plain',
        kind: 'short',
        prompt: '用自己的话说明第一个重要极限。',
        options: [],
        answer: 0,
        referenceAnswer: 'x→0 时 sin x / x 的极限是 1。',
        explanation: ''
      }
    ]
  };

  function checkpointResult(correct: boolean): SubmitAnswerResult {
    return {
      questionId: 'sq-cp',
      setId: 'ps-cp',
      workspaceId: 'kaoyan',
      choice: 0,
      correct,
      answer: 0,
      explanation: '',
      attempt: {
        id: 'pa-cp',
        workspaceId: 'kaoyan',
        setId: 'ps-cp',
        questionId: 'sq-cp',
        choice: 0,
        response: '极限是 1',
        checkpointHits: [true, false],
        correct,
        answeredAt: '2026-11-01T09:00:00.000Z'
      },
      mistake: null
    };
  }

  it('puts the self-check between 提交 and the reference answer, then highlights misses', async () => {
    const user = userEvent.setup();
    const onSubmitShortAnswer = vi.fn(async () => checkpointResult(true));
    renderPane({ set: checkpointSet, onSubmitShortAnswer });

    // 验收 14 顺序（item 67 裁 A，按 spec 字面）：提交 → 自查（不展示参考答案）
    // → 对答案（揭示，无高亮）→ 自评点击之后才高亮漏勾项。
    await user.type(screen.getByLabelText('用你自己的话回答'), '极限是 1');
    await user.click(screen.getByRole('button', { name: '提交' }));

    // 自查界面出现（标题「对照检查点自查」），参考答案此刻不出现，什么都没记录。
    expect(screen.getByText('对照检查点自查')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: '对照检查点自查' })).toBeInTheDocument();
    expect(screen.queryByText(/参考答案：/)).not.toBeInTheDocument();
    expect(onSubmitShortAnswer).not.toHaveBeenCalled();

    // 逐条自勾「答到了吗」：只勾第一条。
    await user.click(screen.getByRole('checkbox', { name: '极限值是 1' }));
    await user.click(screen.getByRole('checkbox', { name: '极限值是 1' })); // 取消再勾回
    await user.click(screen.getByRole('checkbox', { name: '极限值是 1' }));

    // 对答案之后参考答案显示，但揭示面板不即时高亮——漏勾回看等自评点击之后。
    await user.click(screen.getByRole('button', { name: '对答案' }));
    expect(screen.getByText('参考答案：x→0 时 sin x / x 的极限是 1。')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: '检查点对照' })).not.toBeInTheDocument();
    expect(screen.queryByText(/（没答到）/)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '答对了' }));
    await waitFor(() => expect(onSubmitShortAnswer).toHaveBeenCalledTimes(1));
    // P1 口径 B 的 durationMs 与 P2a 的 checkpointHits 并存于同一次提交。
    expect(onSubmitShortAnswer).toHaveBeenCalledWith({
      questionId: 'sq-cp',
      response: '极限是 1',
      selfCorrect: true,
      durationMs: expect.any(Number),
      checkpointHits: [true, false]
    });
    expect(await screen.findByText('回答正确')).toBeInTheDocument();

    // 自评点击之后：漏勾项带中性高亮与「没答到」标记，勾到的带 ✓。
    const hit = screen.getByText(/极限值是 1/).closest('li');
    const missed = screen.getByText(/用到了夹逼准则/).closest('li');
    expect(hit).toHaveAttribute('data-hit', 'true');
    expect(missed).toHaveAttribute('data-hit', 'false');
    expect(missed).toHaveTextContent('（没答到）');
    // 漏勾是信息不是错误：中性琥珀，不是判错红。
    expect(missed?.className).toContain('#ffb340');
    expect(missed?.className).not.toContain('#d70015');
  });

  it('keeps the baseline two-step flow for a short question without checkpoints', async () => {
    const user = userEvent.setup();
    const onSubmitShortAnswer = vi.fn(async () => checkpointResult(true));
    renderPane({ set: plainShortSet, onSubmitShortAnswer });

    // 基线负例：不出现自查步骤与对答案按钮。
    expect(screen.queryByText('对照检查点自查')).not.toBeInTheDocument();

    await user.type(screen.getByLabelText('用你自己的话回答'), '极限是 1');
    await user.click(screen.getByRole('button', { name: '提交' }));

    expect(screen.queryByText('对照检查点自查')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '对答案' })).not.toBeInTheDocument();
    expect(screen.getByText('参考答案：x→0 时 sin x / x 的极限是 1。')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '答对了' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '没答对' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '答对了' }));
    await waitFor(() => expect(onSubmitShortAnswer).toHaveBeenCalledTimes(1));
    // 无检查点 → 不带 checkpointHits；P1 的 durationMs 照常随行。
    expect(onSubmitShortAnswer).toHaveBeenCalledWith({
      questionId: 'sq-plain',
      response: '极限是 1',
      selfCorrect: true,
      durationMs: expect.any(Number)
    });
  });
});

describe('mistake review sheet', () => {
  function stubClipboard(): ReturnType<typeof vi.fn> {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText }
    });
    return writeText;
  }

  const savedResult: ExportMistakeSheetResult = {
    path: 'workspaces/kaoyan/practice/review-sheets/2026-11-02.md',
    count: 2,
    date: '2026-11-02'
  };

  function mistakes(): PracticeMistake[] {
    return [mistake(1), mistake(2)];
  }

  it('hides both sheet actions until there are mistakes to export', () => {
    renderPane();
    expect(screen.queryByRole('button', { name: '导出复习单' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '复制清单' })).not.toBeInTheDocument();
  });

  it('exports the sheet and shows the saved path in a polite live region', async () => {
    const user = userEvent.setup();
    const onExportMistakeSheet = vi.fn(async () => savedResult);

    renderPane({ mistakes: mistakes(), onExportMistakeSheet });

    const button = screen.getByRole('button', { name: '导出复习单' });
    expect(
      screen.queryByText(/已保存：/)
    ).not.toBeInTheDocument();

    await user.click(button);

    await waitFor(() =>
      expect(onExportMistakeSheet).toHaveBeenCalledWith({ workspaceId: 'kaoyan', dueOnly: false })
    );
    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent(`已保存：${savedResult.path}`);
    expect(status).toHaveAttribute('aria-live', 'polite');
    // A second export reuses the same button and stays idempotent from the UI's view.
    await user.click(button);
    await waitFor(() => expect(onExportMistakeSheet).toHaveBeenCalledTimes(2));
  });

  it('shows the error line when the export is rejected', async () => {
    const user = userEvent.setup();
    const onExportMistakeSheet = vi.fn(async () => {
      throw new Error('项目不存在');
    });

    renderPane({ mistakes: mistakes(), onExportMistakeSheet });
    await user.click(screen.getByRole('button', { name: '导出复习单' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('项目不存在');
    expect(screen.queryByText(/已保存：/)).not.toBeInTheDocument();
  });

  it('copies the same markdown the shared builder renders and flips its label', async () => {
    const user = userEvent.setup();
    const writeText = stubClipboard();
    renderPane({ mistakes: mistakes(), onExportMistakeSheet: vi.fn(async () => savedResult) });

    await user.click(screen.getByRole('button', { name: '复制清单' }));

    expect(writeText).toHaveBeenCalledTimes(1);
    const text = String(writeText.mock.calls[0]?.[0]);
    expect(text).toContain('# 错题复习单 · ');
    expect(text).toContain('kind: practice-review-sheet');
    expect(text).toContain('## 1. 错题 1');
    expect(text).toContain('## 2. 错题 2');
    expect(text).toContain('答案：A');

    expect(await screen.findByRole('button', { name: '已复制' })).toBeInTheDocument();
    await waitFor(
      () => expect(screen.getByRole('button', { name: '复制清单' })).toBeInTheDocument(),
      { timeout: 2500 }
    );
  });

  it('renders the sheet actions without an export handler as long as mistakes exist', () => {
    render(
      <MistakeBook
        mistakes={mistakes()}
        workspaceId="kaoyan"
        onReview={() => undefined}
      />
    );
    expect(screen.queryByRole('button', { name: '导出复习单' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '复制清单' })).toBeInTheDocument();
  });
});

describe('interleaved mixed practice', () => {
  const secondSet: PracticeSet = {
    id: 'ps2',
    workspaceId: 'kaoyan',
    title: '导数入门',
    subject: '数学',
    questions: [
      {
        id: 'q2',
        prompt: '导数定义中的差商是？',
        options: ['f(x+h)-f(x)', '(f(x+h)-f(x))/h', 'f(x)/h'],
        answer: 1,
        explanation: '差商。'
      }
    ]
  };

  it('hides the entry when fewer than two sets share a subject', () => {
    renderPane({ set: practiceSet, sets: [practiceSet] });
    expect(screen.queryByRole('button', { name: '交错混练' })).not.toBeInTheDocument();

    const englishSet: PracticeSet = { ...secondSet, id: 'ps-en', subject: '英语' };
    renderPane({ set: practiceSet, sets: [practiceSet, englishSet] });
    expect(screen.queryByRole('button', { name: '交错混练' })).not.toBeInTheDocument();
  });

  it('shows the entry for two same-subject sets and starts a mixed session', async () => {
    const user = userEvent.setup();
    const onSubmitAnswer = vi.fn(async () => ({
      questionId: 'q1',
      setId: 'ps1',
      workspaceId: 'kaoyan',
      choice: 1,
      correct: true,
      answer: 1,
      explanation: '第一个重要极限。',
      attempt: {
        id: 'pa1',
        workspaceId: 'kaoyan',
        setId: 'ps1',
        questionId: 'q1',
        choice: 1,
        correct: true,
        answeredAt: '2026-11-01T09:00:00.000Z'
      },
      mistake: null
    }));

    renderPane({ set: practiceSet, sets: [practiceSet, secondSet], onSubmitAnswer });

    expect(screen.getByText('1 / 1')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '交错混练' }));

    // The synthetic set drives the same flow: two questions, and the source
    // of the card currently shown is printed quietly above the prompt.
    expect(screen.getByText('交错混练 · 数学')).toBeInTheDocument();
    expect(screen.getByText('1 / 2')).toBeInTheDocument();
    expect(screen.getByText('来自：极限基础')).toBeInTheDocument();

    // Answers still resolve the real question, so attempts land on the real set.
    await user.click(screen.getByRole('button', { name: 'B. 1' }));
    await user.click(screen.getByRole('button', { name: '检查答案' }));
    await waitFor(() =>
      expect(onSubmitAnswer).toHaveBeenCalledWith({
        questionId: 'q1',
        choice: 1,
        durationMs: expect.any(Number)
      })
    );
  });

  it('shows the source of the second set on the next mixed question', async () => {
    const user = userEvent.setup();
    const onSubmitAnswer = vi.fn(async () => ({
      questionId: 'q1',
      setId: 'ps1',
      workspaceId: 'kaoyan',
      choice: 1,
      correct: true,
      answer: 1,
      explanation: '第一个重要极限。',
      attempt: {
        id: 'pa1',
        workspaceId: 'kaoyan',
        setId: 'ps1',
        questionId: 'q1',
        choice: 1,
        correct: true,
        answeredAt: '2026-11-01T09:00:00.000Z'
      },
      mistake: null
    }));

    renderPane({ set: practiceSet, sets: [practiceSet, secondSet], onSubmitAnswer });
    await user.click(screen.getByRole('button', { name: '交错混练' }));
    await user.click(screen.getByRole('button', { name: 'B. 1' }));
    await user.click(screen.getByRole('button', { name: '检查答案' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '下一题' })).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: '下一题' }));

    expect(screen.getByText('2 / 2')).toBeInTheDocument();
    expect(screen.getByText('来自：导数入门')).toBeInTheDocument();
  });
});

describe('confidence picker while answering', () => {
  function choiceResult(correct: boolean): SubmitAnswerResult {
    return {
      questionId: 'q1',
      setId: 'ps1',
      workspaceId: 'kaoyan',
      choice: 1,
      correct,
      answer: 1,
      explanation: '第一个重要极限。',
      attempt: {
        id: 'pa1',
        workspaceId: 'kaoyan',
        setId: 'ps1',
        questionId: 'q1',
        choice: 1,
        correct,
        answeredAt: '2026-11-01T09:00:00.000Z'
      },
      mistake: correct ? null : { ...mistake(1), questionId: 'q1', due: '2026-11-02' },
      due: correct ? undefined : '2026-11-02'
    };
  }

  it('sends no confidence when none is picked', async () => {
    const user = userEvent.setup();
    const onSubmitAnswer = vi.fn(async () => choiceResult(true));
    renderPane({ set: practiceSet, onSubmitAnswer });

    const sure = screen.getByRole('button', { name: '有把握' });
    expect(sure).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: '不确定' })).toHaveAttribute('aria-pressed', 'false');

    await user.click(screen.getByRole('button', { name: 'B. 1' }));
    await user.click(screen.getByRole('button', { name: '检查答案' }));

    await waitFor(() => expect(onSubmitAnswer).toHaveBeenCalledTimes(1));
    expect(onSubmitAnswer).toHaveBeenCalledWith({
      questionId: 'q1',
      choice: 1,
      durationMs: expect.any(Number)
    });
  });

  it('keeps the marks mutually exclusive and sends the picked one', async () => {
    const user = userEvent.setup();
    const onSubmitAnswer = vi.fn(async () => choiceResult(true));
    renderPane({ set: practiceSet, onSubmitAnswer });

    await user.click(screen.getByRole('button', { name: '有把握' }));
    expect(screen.getByRole('button', { name: '有把握' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '不确定' })).toHaveAttribute('aria-pressed', 'false');

    // Picking the other swaps the selection instead of adding to it.
    await user.click(screen.getByRole('button', { name: '不确定' }));
    expect(screen.getByRole('button', { name: '有把握' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: '不确定' })).toHaveAttribute('aria-pressed', 'true');

    await user.click(screen.getByRole('button', { name: 'B. 1' }));
    await user.click(screen.getByRole('button', { name: '检查答案' }));

    await waitFor(() => expect(onSubmitAnswer).toHaveBeenCalledTimes(1));
    expect(onSubmitAnswer).toHaveBeenCalledWith({
      questionId: 'q1',
      choice: 1,
      durationMs: expect.any(Number),
      confidence: 'unsure'
    });
  });

  it('sends the picked confidence with a short self-assessment', async () => {
    const user = userEvent.setup();
    const shortSet: PracticeSet = {
      id: 'ps-short',
      workspaceId: 'kaoyan',
      title: '简答练习',
      subject: '数学',
      questions: [
        {
          id: 'sq1',
          kind: 'short',
          prompt: '用自己的话说明第一个重要极限。',
          options: [],
          answer: 0,
          referenceAnswer: 'x→0 时 sin x / x 的极限是 1。',
          explanation: ''
        }
      ]
    };
    const onSubmitShortAnswer = vi.fn(async () => ({
      ...choiceResult(false),
      questionId: 'sq1',
      setId: 'ps-short',
      choice: 0,
      answer: 0
    }));
    renderPane({ set: shortSet, onSubmitShortAnswer });

    await user.click(screen.getByRole('button', { name: '有把握' }));
    await user.type(screen.getByLabelText('用你自己的话回答'), '极限是 0');
    await user.click(screen.getByRole('button', { name: '提交' }));
    await user.click(screen.getByRole('button', { name: '没答对' }));

    await waitFor(() =>
      expect(onSubmitShortAnswer).toHaveBeenCalledWith({
        questionId: 'sq1',
        response: '极限是 0',
        selfCorrect: false,
        durationMs: expect.any(Number),
        confidence: 'sure'
      })
    );
  });

  it('clears the mark when the learner moves to the next question', async () => {
    const user = userEvent.setup();
    const twoQuestionSet: PracticeSet = {
      ...practiceSet,
      questions: [
        practiceSet.questions[0],
        { ...practiceSet.questions[0], id: 'q2', prompt: '第二题？' }
      ]
    };
    const onSubmitAnswer = vi.fn(async () => choiceResult(true));
    renderPane({ set: twoQuestionSet, onSubmitAnswer });

    await user.click(screen.getByRole('button', { name: '有把握' }));
    await user.click(screen.getByRole('button', { name: 'B. 1' }));
    await user.click(screen.getByRole('button', { name: '检查答案' }));
    await waitFor(() => expect(onSubmitAnswer).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole('button', { name: '下一题' }));
    expect(screen.getByRole('button', { name: '有把握' })).toHaveAttribute('aria-pressed', 'false');
  });
});

describe('provenance marking on practice sets', () => {
  const modelSet: PracticeSet = { ...practiceSet, source: 'model' };
  const reviewedModelSet: PracticeSet = {
    ...practiceSet,
    source: 'model',
    reviewedAt: '2026-11-21T10:00:00.000Z'
  };

  it('shows 待核对 and 我看过了 only for an unreviewed model set', () => {
    const view = renderPane({ set: modelSet, onReviewSet: vi.fn(async () => undefined) });

    expect(screen.getByText('待核对')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '确认已看过：极限基础' })).toHaveTextContent(
      '我看过了'
    );

    view.unmount();
    renderPane({ set: practiceSet, onReviewSet: vi.fn(async () => undefined) });
    expect(screen.queryByText('待核对')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '我看过了' })).not.toBeInTheDocument();
  });

  it('hides both marks once the set is reviewed', () => {
    renderPane({ set: reviewedModelSet, onReviewSet: vi.fn(async () => undefined) });
    expect(screen.queryByText('待核对')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /我看过了|记录中/ })).not.toBeInTheDocument();
  });

  it('records the review and the chip disappears when the parent updates', async () => {
    const user = userEvent.setup();
    const onReviewSet = vi.fn(async () => undefined);
    const view = renderPane({ set: modelSet, onReviewSet });

    await user.click(screen.getByRole('button', { name: '确认已看过：极限基础' }));
    expect(onReviewSet).toHaveBeenCalledTimes(1);
    expect(onReviewSet).toHaveBeenCalledWith('ps1');

    // The parent owns the record; re-rendering with the reviewed set hides it.
    view.unmount();
    renderPane({ set: reviewedModelSet, onReviewSet });
    expect(screen.queryByText('待核对')).not.toBeInTheDocument();
  });

  it('renders the chip without a handler when review is unavailable', () => {
    renderPane({ set: modelSet });
    expect(screen.getByText('待核对')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '我看过了' })).not.toBeInTheDocument();
  });
});

describe('one-question import from the mistake book', () => {
  it('turns a choice mistake into exactly one single-question set', async () => {
    const user = userEvent.setup();
    const choiceMistake = {
      ...mistake(1),
      prompt: '当 x→0 时 sin x / x 的极限是？',
      options: ['0', '1', '∞'],
      answer: 1,
      explanation: '重要极限。'
    };
    const onCreateSet = vi.fn(
      async (_input: CreatePracticeSetInput): Promise<PracticeSet> => ({
        ...practiceSet,
        id: 'ps-single',
        title: '单题 · 当 x→0 时 sin x / x 的极限是？'
      })
    );

    renderPane({ mistakes: [choiceMistake], sets: [practiceSet], onCreateSet });

    await user.click(
      screen.getByRole('button', { name: '转为练习：当 x→0 时 sin x / x 的极限是？' })
    );

    await waitFor(() => expect(onCreateSet).toHaveBeenCalledTimes(1));
    expect(onCreateSet).toHaveBeenCalledWith({
      workspaceId: 'kaoyan',
      title: '单题 · 当 x→0 时 sin x / x 的极限是？',
      subject: '数学',
      questions: [
        {
          prompt: '当 x→0 时 sin x / x 的极限是？',
          options: ['0', '1', '∞'],
          answer: 1,
          explanation: '重要极限。'
        }
      ]
    });
    expect(await screen.findByRole('status')).toHaveTextContent('已生成单题练习');
  });

  it('keeps a short mistake a short question and truncates a long title', async () => {
    const user = userEvent.setup();
    const prompt = '用自己的话完整说明第一个重要极限为什么成立并给出推导过程';
    const shortMistake = {
      ...mistake(2),
      kind: 'short' as const,
      prompt,
      options: [],
      answer: 0,
      referenceAnswer: 'x→0 时 sin x / x → 1。'
    };
    const onCreateSet = vi.fn(
      async (_input: CreatePracticeSetInput): Promise<PracticeSet> => practiceSet
    );

    renderPane({ mistakes: [shortMistake], onCreateSet });
    await user.click(screen.getByRole('button', { name: `转为练习：${prompt}` }));

    await waitFor(() => expect(onCreateSet).toHaveBeenCalledTimes(1));
    const input = onCreateSet.mock.calls[0]![0];
    expect(input.title).toBe(`单题 · ${prompt.slice(0, 24)}…`);
    expect(input.subject).toBe('考研');
    expect(input.questions).toEqual([
      {
        kind: 'short',
        prompt,
        referenceAnswer: 'x→0 时 sin x / x → 1。',
        explanation: ''
      }
    ]);
    // The mistake history is never rewritten by the import.
    expect(shortMistake.wrongCount).toBe(2);
    expect(shortMistake.status).toBe('active');
  });

  it('has no bulk-import surface next to the single-question action', () => {
    renderPane({ mistakes: [mistake(1)], onCreateSet: vi.fn(async () => practiceSet) });
    expect(screen.queryByRole('button', { name: /整课成卡|全部转为练习|批量/ })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^转为练习/ })).toHaveLength(1);
  });

  it('hides 转为练习 when no create handler is supplied', () => {
    renderPane({ mistakes: [mistake(1)] });
    expect(screen.queryByRole('button', { name: /转为练习/ })).not.toBeInTheDocument();
  });
});

describe('strict mastery surfaces', () => {
  it('states the strict clause in the mistake book only when strict is on', () => {
    const { rerender } = render(
      <MistakeBook mistakes={[mistake(1)]} workspaceId="kaoyan" onReview={() => undefined} />
    );
    expect(screen.queryByText('更严判定生效中：需要简答题复证')).not.toBeInTheDocument();

    rerender(
      <MistakeBook
        mistakes={[mistake(1)]}
        workspaceId="kaoyan"
        strict
        onReview={() => undefined}
      />
    );
    expect(screen.getByText('更严判定生效中：需要简答题复证')).toBeInTheDocument();
  });

  it('carries the strict clause into the copied sheet only when strict is on', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText }
    });

    const strictView = render(
      <MistakeBook mistakes={[mistake(1)]} workspaceId="kaoyan" strict onReview={() => undefined} />
    );
    await user.click(screen.getByRole('button', { name: '复制清单' }));
    expect(String(writeText.mock.calls[0]?.[0])).toContain('更严判定生效中：需要简答题复证');
    strictView.unmount();

    render(<MistakeBook mistakes={[mistake(1)]} workspaceId="kaoyan" onReview={() => undefined} />);
    await user.click(screen.getByRole('button', { name: '复制清单' }));
    expect(String(writeText.mock.calls[1]?.[0])).not.toContain('更严判定');
  });
});

// ---------------------------------------------------------------------------
// 整卷模拟（P2a）：练习集的一种作答方式。会话只在内存里，逐题提交照走
// submitAnswer/submitShortAnswer，整卷中不亮任何单题对错，结卷出摘要。
// ---------------------------------------------------------------------------

describe('whole-paper simulation (整卷模拟)', () => {
  const shortPaperQuestion = {
    id: 'sq2',
    kind: 'short' as const,
    prompt: '整卷简答：说明第一个重要极限。',
    options: [],
    answer: 0,
    referenceAnswer: 'x→0 时 sin x / x 的极限是 1。',
    explanation: '夹逼准则。'
  };
  const paperSet: PracticeSet = {
    id: 'ps-paper',
    workspaceId: 'kaoyan',
    title: '整卷练习',
    subject: '数学',
    questions: [practiceSet.questions[0], shortPaperQuestion]
  };
  const paperAttempts: PracticeAttempt[] = [
    {
      id: 'pa-old',
      workspaceId: 'kaoyan',
      setId: 'ps-paper',
      questionId: 'q1',
      choice: 1,
      correct: true,
      answeredAt: '2026-11-01T08:30:00.000Z'
    }
  ];

  function paperResult(correct: boolean, questionId = 'q1'): SubmitAnswerResult {
    return {
      questionId,
      setId: 'ps-paper',
      workspaceId: 'kaoyan',
      choice: 1,
      correct,
      answer: 1,
      explanation: '第一个重要极限。',
      attempt: {
        id: `pa-${questionId}`,
        workspaceId: 'kaoyan',
        setId: 'ps-paper',
        questionId,
        choice: 1,
        correct,
        answeredAt: '2026-11-27T09:00:00.000Z'
      },
      mistake: correct
        ? null
        : { ...mistake(1), questionId, setId: 'ps-paper', due: '2026-11-28' },
      due: correct ? undefined : '2026-11-28'
    };
  }

  /** Fake timers stall setTimeout, so timed tests click through act directly. */
  async function clickButton(name: string) {
    await act(async () => {
      screen.getByRole('button', { name }).click();
    });
  }

  /** Opens the config, optionally overrides the duration, and starts the paper. */
  async function startPaper(minutes?: string) {
    await clickButton('整卷模拟');
    if (minutes !== undefined) {
      const input = screen.getByLabelText('总时长（分钟）');
      await act(async () => {
        fireEvent.change(input, { target: { value: minutes } });
      });
    }
    await clickButton('确认开始');
  }

  it('offers 整卷模拟 on a set and defaults to clamp(题数×2, 5, 600)', async () => {
    const user = userEvent.setup();
    // 题数 1 → 5（下限）。
    const single = renderPane({ set: practiceSet });
    await user.click(screen.getByRole('button', { name: '整卷模拟' }));
    expect(screen.getByLabelText('总时长（分钟）')).toHaveValue(5);
    await user.click(screen.getByRole('button', { name: '取消' }));
    expect(screen.queryByLabelText('总时长（分钟）')).not.toBeInTheDocument();
    single.unmount();

    // 题数 3 → 6。
    const threeSet: PracticeSet = {
      ...practiceSet,
      questions: [
        practiceSet.questions[0],
        { ...practiceSet.questions[0], id: 'q2', prompt: '第二题' },
        { ...practiceSet.questions[0], id: 'q3', prompt: '第三题' }
      ]
    };
    const three = renderPane({ set: threeSet });
    await user.click(screen.getByRole('button', { name: '整卷模拟' }));
    expect(screen.getByLabelText('总时长（分钟）')).toHaveValue(6);
    three.unmount();

    // 题数 400 → 600（上限）。
    const bigSet: PracticeSet = {
      ...practiceSet,
      questions: Array.from({ length: 400 }, (_, index) => ({
        ...practiceSet.questions[0],
        id: `q${index + 1}`
      }))
    };
    const big = renderPane({ set: bigSet });
    await user.click(screen.getByRole('button', { name: '整卷模拟' }));
    expect(screen.getByLabelText('总时长（分钟）')).toHaveValue(600);
    big.unmount();
  });

  it('clamps out-of-range durations into 5–600 when starting', async () => {
    const user = userEvent.setup();
    renderPane({ set: practiceSet });
    await user.click(screen.getByRole('button', { name: '整卷模拟' }));
    const input = screen.getByLabelText('总时长（分钟）');
    await user.clear(input);
    await user.type(input, '0');
    await user.click(screen.getByRole('button', { name: '确认开始' }));
    // 0 分钟被钳回 5 分钟下限，整卷开始。
    expect(screen.getByRole('timer')).toHaveTextContent('05:00');

    await user.click(screen.getByRole('button', { name: '提前交卷' }));
    expect(screen.getByText(/^整卷完成：正确 0 \/ 1 题，未作答 1 题，用时/)).toBeInTheDocument();
    expect(screen.getByText('第 1 题 · 未作答')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '再练一次' }));
    await user.click(screen.getByRole('button', { name: '整卷模拟' }));
    const again = screen.getByLabelText('总时长（分钟）');
    await user.clear(again);
    await user.type(again, '1000');
    await user.click(screen.getByRole('button', { name: '确认开始' }));
    // 1000 分钟被钳回 600 分钟上限。
    expect(screen.getByRole('timer')).toHaveTextContent('600:00');
  });

  it('runs choice and short questions through the same submit handlers without per-question verdicts', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-11-27T09:00:00.000Z'));
      const onSubmitAnswer = vi.fn().mockResolvedValue(paperResult(false, 'q1'));
      const onSubmitShortAnswer = vi.fn().mockResolvedValue({
        ...paperResult(false, 'sq2'),
        choice: 0,
        answer: 0
      });
      renderPane({ set: paperSet, onSubmitAnswer, onSubmitShortAnswer });
      await startPaper();

      // Q1（选择）：提交照走 submitAnswer，对错不出现在任何地方。
      await clickButton('B. 1');
      await clickButton('检查答案');
      await act(async () => {});
      expect(onSubmitAnswer).toHaveBeenCalledWith({
        questionId: 'q1',
        choice: 1,
        durationMs: expect.any(Number)
      });
      expect(screen.queryByText('回答正确')).not.toBeInTheDocument();
      expect(screen.queryByText('回答错误')).not.toBeInTheDocument();
      expect(screen.queryByText(/已加入错题本/)).not.toBeInTheDocument();
      expect(screen.getByRole('status')).toHaveTextContent('已提交。');

      await clickButton('下一题');

      // Q2（简答）：提交/自评照走 submitShortAnswer；整卷只藏对错，不换管线。
      await act(async () => {
        fireEvent.change(screen.getByLabelText('用你自己的话回答'), {
          target: { value: '极限是 1' }
        });
      });
      await clickButton('提交');
      expect(screen.getByText('参考答案：x→0 时 sin x / x 的极限是 1。')).toBeInTheDocument();
      expect(onSubmitShortAnswer).not.toHaveBeenCalled();
      await clickButton('没答对');
      await act(async () => {});

      // 全部答完自动结卷，摘要与逐题口径不同：分母是全卷题数。
      expect(onSubmitShortAnswer).toHaveBeenCalledWith({
        questionId: 'sq2',
        response: '极限是 1',
        selfCorrect: false,
        durationMs: expect.any(Number)
      });
      expect(
        screen.getByText('整卷完成：正确 0 / 2 题，用时 0 秒。错题已记入错题本。')
      ).toBeInTheDocument();
      expect(screen.getByText('第 1 题 · 回答错误')).toBeInTheDocument();
      expect(screen.getByText('第 2 题 · 回答错误')).toBeInTheDocument();
      expect(screen.queryByRole('timer')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: '下一题' })).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('auto-submits at the deadline: 未作答 stays unrecorded and is marked in the summary', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-11-27T09:00:00.000Z'));
      const onSubmitAnswer = vi.fn().mockResolvedValue(paperResult(false, 'q1'));
      renderPane({
        set: paperSet,
        onSubmitAnswer,
        attempts: paperAttempts,
        mistakes: [mistake(1)]
      });
      // 可改：30 分钟的自定义时长被接受。
      await startPaper('30');
      expect(screen.getByRole('timer')).toHaveTextContent('30:00');

      // 错题本与答题历史都藏着——它们会泄露单题对错。
      expect(screen.queryByText(/错题本 ·/)).not.toBeInTheDocument();
      expect(screen.queryByText('答题历史')).not.toBeInTheDocument();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_000);
      });
      expect(screen.getByRole('timer')).toHaveTextContent('29:59');

      // 答错第 1 题（不出错题本提示），翻到第 2 题后不答。
      await clickButton('A. 0');
      await clickButton('检查答案');
      await act(async () => {});
      await clickButton('下一题');

      // 到时自动交卷：墙钟越过截止时刻，下一个 tick 结卷。
      await act(async () => {
        await vi.advanceTimersByTimeAsync(30 * 60_000);
      });

      expect(screen.getByText('时间到，自动交卷。')).toBeInTheDocument();
      expect(
        screen.getByText('整卷完成：正确 0 / 2 题，未作答 1 题，用时 30 分。错题已记入错题本。')
      ).toBeInTheDocument();
      expect(screen.getByText('第 1 题 · 回答错误')).toBeInTheDocument();
      expect(screen.getByText('第 2 题 · 未作答')).toBeInTheDocument();
      // 未作答题不记 attempt：只有第 1 题到过提交口。
      expect(onSubmitAnswer).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole('timer')).not.toBeInTheDocument();
      // 结卷后错题本与答题历史回来。
      expect(screen.getByText(/错题本 ·/)).toBeInTheDocument();
      expect(screen.getByText('答题历史')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('settles the countdown from the wall clock across a clock jump', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-11-27T09:00:00.000Z'));
      renderPane({ set: paperSet });
      await startPaper();
      expect(screen.getByRole('timer')).toHaveTextContent('05:00');

      // 模拟后台节流/系统睡眠：系统时间前进 3 分钟而 tick 一声未响，
      // 醒来后第一个 tick 按墙钟结算剩余时间，而不是按 tick 数递减。
      vi.setSystemTime(new Date('2026-11-27T09:03:00.000Z'));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_000);
      });
      expect(screen.getByRole('timer')).toHaveTextContent('01:59');

      // 一次跳过截止时刻 → 自动交卷，用时被钳到总时长。
      vi.setSystemTime(new Date('2026-11-27T09:10:00.000Z'));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_000);
      });
      expect(screen.getByText('时间到，自动交卷。')).toBeInTheDocument();
      expect(screen.getByText('整卷完成：正确 0 / 2 题，未作答 2 题，用时 5 分。')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('supports submitting early with the same summary shape', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-11-27T09:00:00.000Z'));
      const onSubmitAnswer = vi.fn().mockResolvedValue(paperResult(true, 'q1'));
      renderPane({ set: paperSet, onSubmitAnswer });
      await startPaper();

      await clickButton('B. 1');
      await clickButton('检查答案');
      await act(async () => {});
      await clickButton('提前交卷');

      expect(
        screen.getByText('整卷完成：正确 1 / 2 题，未作答 1 题，用时 0 秒。')
      ).toBeInTheDocument();
      expect(screen.queryByText('时间到，自动交卷。')).not.toBeInTheDocument();
      expect(screen.getByText('第 2 题 · 未作答')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('returns to normal per-question mode via 再练一次', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-11-27T09:00:00.000Z'));
      const onSubmitAnswer = vi.fn().mockResolvedValue(paperResult(true, 'q1'));
      renderPane({ set: paperSet, onSubmitAnswer });
      await startPaper();
      await clickButton('B. 1');
      await clickButton('检查答案');
      await act(async () => {});
      await clickButton('提前交卷');
      expect(screen.getByText(/^整卷完成：/)).toBeInTheDocument();

      await clickButton('再练一次');
      expect(screen.getByText('1 / 2')).toBeInTheDocument();
      expect(screen.queryByRole('timer')).not.toBeInTheDocument();
      expect(screen.queryByText(/^整卷完成：/)).not.toBeInTheDocument();

      // 普通模式重新亮对错——逐题行为与基线一致。
      await clickButton('B. 1');
      await clickButton('检查答案');
      await act(async () => {});
      expect(screen.getByText('回答正确')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('voids the paper session when the pane unmounts, keeping submissions recorded', async () => {
    const user = userEvent.setup({ delay: null });
    const onSubmitAnswer = vi.fn().mockResolvedValue(paperResult(true, 'q1'));
    const view = renderPane({ set: paperSet, onSubmitAnswer });
    await user.click(screen.getByRole('button', { name: '整卷模拟' }));
    await user.click(screen.getByRole('button', { name: '确认开始' }));
    await user.click(screen.getByRole('button', { name: 'B. 1' }));
    await user.click(screen.getByRole('button', { name: '检查答案' }));
    await act(async () => {});
    expect(onSubmitAnswer).toHaveBeenCalledTimes(1);

    // 离开页面 = 整卷作废：重挂载回到普通模式，没有倒计时也没有摘要。
    view.unmount();
    renderPane({ set: paperSet, onSubmitAnswer });
    expect(screen.getByText('1 / 2')).toBeInTheDocument();
    expect(screen.queryByRole('timer')).not.toBeInTheDocument();
    expect(screen.queryByText(/^整卷完成：/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '整卷模拟' })).toBeInTheDocument();
    // 已逐题落库的作答不丢——提交口的调用次数不会回退。
    expect(onSubmitAnswer).toHaveBeenCalledTimes(1);
  });

  it('voids the paper session when another set is selected mid-paper', async () => {
    const user = userEvent.setup();
    const otherSet: PracticeSet = { ...paperSet, id: 'ps-other', title: '另一套练习' };
    const baseProps = {
      workspace,
      notes: [],
      mistakes: [] as PracticeMistake[],
      onSubmitAnswer: vi.fn(async () => paperResult(true, 'q1')),
      onOpenChat: vi.fn(),
      onOpenNote: vi.fn()
    };
    const view = render(<LearningPane {...baseProps} set={paperSet} />);
    await user.click(screen.getByRole('button', { name: '整卷模拟' }));
    await user.click(screen.getByRole('button', { name: '确认开始' }));
    expect(screen.getByRole('timer')).toBeInTheDocument();

    view.rerender(<LearningPane {...baseProps} set={otherSet} />);

    expect(screen.queryByRole('timer')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '整卷模拟' })).toBeInTheDocument();
    expect(screen.getByText('另一套练习')).toBeInTheDocument();
  });
});

describe('answer timing (iter33 P1, 口径 B)', () => {
  const shortSet: PracticeSet = {
    id: 'ps-short',
    workspaceId: 'kaoyan',
    title: '简答练习',
    subject: '数学',
    questions: [
      {
        id: 'sq1',
        kind: 'short',
        prompt: '用自己的话说明第一个重要极限。',
        options: [],
        answer: 0,
        referenceAnswer: 'x→0 时 sin x / x 的极限是 1。',
        explanation: ''
      }
    ]
  };
  const twoChoiceSet: PracticeSet = {
    ...practiceSet,
    questions: [
      practiceSet.questions[0],
      { ...practiceSet.questions[0], id: 'q2', prompt: '第二题？' }
    ]
  };
  const paperChoiceSet: PracticeSet = {
    id: 'ps-paper',
    workspaceId: 'kaoyan',
    title: '整卷练习',
    subject: '数学',
    questions: [
      practiceSet.questions[0],
      { ...practiceSet.questions[0], id: 'q2', prompt: '第二题？' }
    ]
  };

  function okChoice(questionId: string): SubmitAnswerResult {
    return {
      questionId,
      setId: 'ps1',
      workspaceId: 'kaoyan',
      choice: 1,
      correct: true,
      answer: 1,
      explanation: '第一个重要极限。',
      attempt: {
        id: `pa-${questionId}`,
        workspaceId: 'kaoyan',
        setId: 'ps1',
        questionId,
        choice: 1,
        correct: true,
        answeredAt: '2026-11-27T09:00:00.000Z'
      },
      mistake: null
    };
  }

  function okShort(): SubmitAnswerResult {
    return {
      questionId: 'sq1',
      setId: 'ps-short',
      workspaceId: 'kaoyan',
      choice: 0,
      correct: true,
      answer: 0,
      explanation: '',
      attempt: {
        id: 'pa-short',
        workspaceId: 'kaoyan',
        setId: 'ps-short',
        questionId: 'sq1',
        choice: 0,
        response: '极限是 1',
        correct: true,
        answeredAt: '2026-11-27T09:00:00.000Z'
      },
      mistake: null
    };
  }

  /** Freeze Date.now so measured durations are exact; per-test advance() moves it. */
  let nowMs: number;
  beforeEach(() => {
    nowMs = Date.parse('2026-11-27T09:00:00.000');
    vi.spyOn(Date, 'now').mockImplementation(() => nowMs);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });
  function advance(ms: number) {
    nowMs += ms;
  }

  it('measures 呈现→提交 exactly and caps the client at 60 s (验收 6)', async () => {
    const user = userEvent.setup();
    const onSubmitAnswer = vi.fn(async (): Promise<SubmitAnswerResult> => okChoice('q1'));
    renderPane({ set: twoChoiceSet, onSubmitAnswer });

    await user.click(screen.getByRole('button', { name: 'B. 1' }));
    advance(8000);
    await user.click(screen.getByRole('button', { name: '检查答案' }));
    await waitFor(() => expect(onSubmitAnswer).toHaveBeenCalledTimes(1));
    expect(onSubmitAnswer).toHaveBeenCalledWith({ questionId: 'q1', choice: 1, durationMs: 8000 });

    // 下一题的时钟从零起算；70 秒后提交 → 客户端 60 秒封顶。
    await user.click(screen.getByRole('button', { name: '下一题' }));
    await user.click(screen.getByRole('button', { name: 'A. 0' }));
    advance(70_000);
    await user.click(screen.getByRole('button', { name: '检查答案' }));
    await waitFor(() => expect(onSubmitAnswer).toHaveBeenCalledTimes(2));
    expect(onSubmitAnswer).toHaveBeenLastCalledWith({
      questionId: 'q2',
      choice: 0,
      durationMs: 60_000
    });
  });

  it('runs the short clock to the self-assessment click (口径 B, item 67)', async () => {
    const user = userEvent.setup();
    const onSubmitShortAnswer = vi.fn(async (): Promise<SubmitAnswerResult> => okShort());
    renderPane({ set: shortSet, onSubmitShortAnswer });

    await user.type(screen.getByLabelText('用你自己的话回答'), '极限是 1');
    advance(5000);
    await user.click(screen.getByRole('button', { name: '提交' }));
    // 口径 B：reveal 不停表——读参考答案的 3 秒也计入，落盘点击才是终点。
    advance(3000);
    await user.click(screen.getByRole('button', { name: '答对了' }));

    await waitFor(() => expect(onSubmitShortAnswer).toHaveBeenCalledTimes(1));
    expect(onSubmitShortAnswer).toHaveBeenCalledWith({
      questionId: 'sq1',
      response: '极限是 1',
      selfCorrect: true,
      durationMs: 8000
    });
  });

  it('keeps the answering UI free of any per-question timer (验收 10)', async () => {
    const user = userEvent.setup();
    renderPane({ set: twoChoiceSet, onSubmitAnswer: vi.fn(async () => okChoice('q1')) });

    expect(screen.queryByRole('timer')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'B. 1' }));
    await user.click(screen.getByRole('button', { name: '检查答案' }));
    await waitFor(() => expect(screen.getByText('回答正确')).toBeInTheDocument());
    expect(screen.queryByRole('timer')).not.toBeInTheDocument();
    // 数据照记、压迫不给：只有整卷模拟的卷级倒计时用 role="timer"（既有整卷测试回归）。
  });

  it('records per-question durationMs in whole-paper mode, uncoupled from the paper budget (验收 11)', async () => {
    const user = userEvent.setup();
    const onSubmitAnswer = vi.fn(async (): Promise<SubmitAnswerResult> => okChoice('q1'));
    renderPane({ set: paperChoiceSet, onSubmitAnswer });

    await user.click(screen.getByRole('button', { name: '整卷模拟' }));
    const minutesInput = screen.getByLabelText('总时长（分钟）');
    await user.clear(minutesInput);
    await user.type(minutesInput, '10');
    await user.click(screen.getByRole('button', { name: '确认开始' }));
    // 卷级倒计时照常显示——iter32 P2a 行为不变，预算是 WholePaperSession 自己的字段。
    expect(screen.getByRole('timer')).toHaveTextContent('10:00');

    await user.click(screen.getByRole('button', { name: 'B. 1' }));
    advance(5000);
    await user.click(screen.getByRole('button', { name: '检查答案' }));
    await waitFor(() => expect(onSubmitAnswer).toHaveBeenCalledTimes(1));
    // 每题 attempt 按本规范带用时（5 秒），与 10 分钟的卷预算无关、不混用。
    expect(onSubmitAnswer).toHaveBeenCalledWith({ questionId: 'q1', choice: 1, durationMs: 5000 });
  });
});

describe('fluency stats (用时流畅度, iter33 P1)', () => {
  // 2026-11-27 是 11-23（周一）当周的周五。
  const today = new Date('2026-11-27T12:00:00');

  it('counts only the first same-day answer per question (验收 8)', () => {
    const attempts = [
      timedAttempt('pa1', '2026-11-27T09:00:00', { durationMs: 8000 }),
      timedAttempt('pa2', '2026-11-27T09:05:00', { durationMs: 4000 }),
      timedAttempt('pa3', '2026-11-27T09:10:00', { questionId: 'q2', durationMs: 6000 }),
      timedAttempt('pa4', '2026-11-27T09:15:00', { questionId: 'q3', durationMs: 9000 })
    ];
    const data = fluencyTrend(attempts, today);
    expect(data.sets).toHaveLength(1);
    const set = data.sets[0]!;
    // 同题同日两次作答（8s 对、4s 对）→ 统计只计第一次。
    expect(set.records.map((record) => record.attempt.id)).toEqual(['pa1', 'pa3', 'pa4']);
    expect(set.medianMs).toBe(8000);
    // 原始 attempt 全量保留——统计侧不丢数据。
    expect(attempts).toHaveLength(4);
  });

  it('dedups per local day, so the same question counts once per day', () => {
    const data = fluencyTrend(
      [
        timedAttempt('pa1', '2026-11-26T09:00:00', { durationMs: 8000 }),
        timedAttempt('pa2', '2026-11-27T09:00:00', { durationMs: 4000 }),
        timedAttempt('pa3', '2026-11-27T09:05:00', { questionId: 'q2', durationMs: 6000 }),
        timedAttempt('pa4', '2026-11-27T09:10:00', { questionId: 'q3', durationMs: 9000 })
      ],
      today
    );
    expect(data.sets[0]!.records.map((record) => record.attempt.id)).toEqual([
      'pa1',
      'pa2',
      'pa3',
      'pa4'
    ]);
  });

  it('grades 自动召回 / 对了但慢, wrong answers in neither tier (验收 9)', () => {
    const set = fluencyTrend(
      [
        timedAttempt('pa1', '2026-11-27T09:00:00', { durationMs: 8000 }),
        // 边界：恰好 >= AUTO_RECALL_MS 计「对了但慢」。
        timedAttempt('pa2', '2026-11-27T09:05:00', { questionId: 'q2', durationMs: AUTO_RECALL_MS }),
        timedAttempt('pa3', '2026-11-27T09:10:00', {
          questionId: 'q3',
          correct: false,
          durationMs: 5000
        }),
        timedAttempt('pa4', '2026-11-27T09:15:00', { questionId: 'q4', durationMs: 12000 })
      ],
      today
    ).sets[0]!;
    expect(set.autoRecall).toBe(1);
    expect(set.slowCorrect).toBe(2);
    expect(set.autoRecallShare).toBeCloseTo(1 / 3, 5);
    // 中位用时覆盖答错记录的用时：median(8000, 10000, 5000, 12000) = 9000。
    expect(set.medianMs).toBe(9000);
  });

  it('shows a set only from 3 valid records up (spec 默认 6)', () => {
    const thin = fluencyTrend(
      [
        timedAttempt('pa1', '2026-11-27T09:00:00', { durationMs: 8000 }),
        timedAttempt('pa2', '2026-11-27T09:05:00', { questionId: 'q2', durationMs: 6000 })
      ],
      today
    );
    expect(thin.hasData).toBe(false);
    expect(thin.sets).toEqual([]);

    const full = fluencyTrend(
      [
        timedAttempt('pb1', '2026-11-27T09:00:00', { durationMs: 8000 }),
        timedAttempt('pb2', '2026-11-27T09:05:00', { questionId: 'q2', durationMs: 6000 }),
        timedAttempt('pb3', '2026-11-27T09:10:00', { questionId: 'q3', durationMs: 9000 })
      ],
      today
    );
    expect(full.hasData).toBe(true);
    expect(full.sets[0]!.records).toHaveLength(3);
  });

  it('treats attempts without durationMs as absent, not errors (验收 7)', () => {
    const set = fluencyTrend(
      [
        // 无用时（旧记录/错题复习）：占自己的去重槽、不产生记录，也绝不报错。
        timedAttempt('pa1', '2026-11-27T09:00:00', { questionId: 'q4' }),
        timedAttempt('pa2', '2026-11-27T09:05:00', { durationMs: 8000 }),
        timedAttempt('pa3', '2026-11-27T09:10:00', { questionId: 'q2', durationMs: 6000 }),
        timedAttempt('pa4', '2026-11-27T09:15:00', { questionId: 'q3', durationMs: 9000 })
      ],
      today
    ).sets[0]!;
    expect(set.records.map((record) => record.attempt.id)).toEqual(['pa2', 'pa3', 'pa4']);
    expect(set.medianMs).toBe(8000);
  });

  it('a duration-less first-of-day answer holds the dedup slot (每日第一次口径)', () => {
    const set = fluencyTrend(
      [
        timedAttempt('pa1', '2026-11-27T09:00:00'),
        timedAttempt('pa2', '2026-11-27T09:05:00', { durationMs: 4000 }),
        timedAttempt('pa3', '2026-11-27T09:10:00', { questionId: 'q2', durationMs: 8000 }),
        timedAttempt('pa4', '2026-11-27T09:15:00', { questionId: 'q3', durationMs: 9000 }),
        timedAttempt('pa5', '2026-11-27T09:20:00', { questionId: 'q4', durationMs: 7000 })
      ],
      today
    ).sets[0]!;
    expect(set.records.map((record) => record.attempt.id)).toEqual(['pa3', 'pa4', 'pa5']);
  });

  it('buckets weekly medians onto the same Monday weeks as the accuracy trend', () => {
    // 2026-11-27（周五）当周周一是 11-23；11-19/11-20 属 11-16 当周；11-11 属 11-09 当周。
    const set = fluencyTrend(
      [
        timedAttempt('pa1', '2026-11-23T09:00:00', { durationMs: 8000 }),
        timedAttempt('pa2', '2026-11-24T09:00:00', { questionId: 'q2', durationMs: 16000 }),
        timedAttempt('pa3', '2026-11-20T09:00:00', { questionId: 'q3', durationMs: 60000 }),
        timedAttempt('pa4', '2026-11-19T09:00:00', { questionId: 'q4', durationMs: 2000 }),
        timedAttempt('pa5', '2026-11-11T09:00:00', { questionId: 'q5', durationMs: 1000 })
      ],
      today
    ).sets[0]!;
    expect(set.weekMedians).toHaveLength(8);
    expect(set.weekMedians[7]).toBe(12000);
    expect(set.weekMedians[6]).toBe(31000);
    expect(set.weekMedians[5]).toBe(1000);
    expect(set.weekMedians[0]).toBeNull();
  });
});

describe('FluencyTrend section (用时流畅度呈现, iter33 P1)', () => {
  const today = new Date('2026-11-27T12:00:00');

  it('shows per-set median trend and auto-recall share once the gate is met (验收 10)', () => {
    render(
      <FluencyTrend
        attempts={[
          timedAttempt('pa1', '2026-11-27T09:00:00', { durationMs: 8000 }),
          timedAttempt('pa2', '2026-11-27T09:05:00', { questionId: 'q2', durationMs: 16000 }),
          timedAttempt('pa3', '2026-11-27T09:10:00', {
            questionId: 'q3',
            correct: false,
            durationMs: 5000
          })
        ]}
        sets={[practiceSet]}
        today={today}
      />
    );

    expect(screen.getByRole('region', { name: '用时流畅度' })).toBeInTheDocument();
    expect(screen.getByText('极限基础')).toBeInTheDocument();
    expect(screen.getByText(/中位用时 8 秒/)).toBeInTheDocument();
    expect(screen.getByText(/自动召回 50%/)).toBeInTheDocument();
    // 每周的柱子以 60 秒封顶为满高，aria 直接可读。
    expect(screen.getByRole('img', { name: '中位用时 8 秒' })).toBeInTheDocument();
    expect(screen.getAllByRole('img', { name: '该周无有效用时记录' })).toHaveLength(7);
  });

  it('keeps sets below the record gate out and shows the empty state', () => {
    render(
      <FluencyTrend
        attempts={[
          timedAttempt('pa1', '2026-11-27T09:00:00', { durationMs: 8000 }),
          timedAttempt('pa2', '2026-11-27T09:05:00', { questionId: 'q2', durationMs: 6000 })
        ]}
        sets={[practiceSet]}
        today={today}
      />
    );

    expect(screen.queryByText('极限基础')).not.toBeInTheDocument();
    expect(screen.getByText(/还没有足够的用时记录/)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// iter34 P0：错因一行 / 顽疾标记 / 清空已掌握 / 从归档恢复
// ---------------------------------------------------------------------------

describe('iter34 P0 mistake book surfaces', () => {
  it('shows 错因 only when the record has one', () => {
    const { rerender } = render(
      <MistakeBook mistakes={[mistake(1)]} workspaceId="kaoyan" onReview={() => undefined} />
    );
    expect(screen.queryByText(/^错因：/)).not.toBeInTheDocument();

    rerender(
      <MistakeBook
        mistakes={[{ ...mistake(1), cause: '导数链没拆完' }]}
        workspaceId="kaoyan"
        onReview={() => undefined}
      />
    );
    expect(screen.getByText('错因：导数链没拆完')).toBeInTheDocument();
  });

  it('saves a 错因 through the inline editor, respecting 跳过', async () => {
    const user = userEvent.setup();
    const onSaveCause = vi.fn(async (entry: PracticeMistake, cause: string) => ({
      ...entry,
      cause
    }));
    render(
      <MistakeBook
        mistakes={[mistake(1)]}
        workspaceId="kaoyan"
        onSaveCause={onSaveCause}
        onReview={() => undefined}
      />
    );

    await user.click(screen.getByRole('button', { name: '补一句错因：错题 1' }));
    const input = screen.getByLabelText('错因：错题 1');
    expect(input).toHaveAttribute('placeholder', '哪个概念、为什么（例：导数链没拆完）');
    await user.type(input, '导数链没拆完');
    await user.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => expect(onSaveCause).toHaveBeenCalledTimes(1));
    expect(onSaveCause.mock.calls[0]![1]).toBe('导数链没拆完');

    // Re-opening, 跳过 closes without another save.
    await user.click(screen.getByRole('button', { name: '补一句错因：错题 1' }));
    await user.click(screen.getByRole('button', { name: '跳过' }));
    expect(onSaveCause).toHaveBeenCalledTimes(1);
  });

  it('renders 顽疾 only for wrongCount>=2 && correctStreak<2', () => {
    const { rerender } = render(
      <MistakeBook
        mistakes={[{ ...mistake(1), wrongCount: 2, correctStreak: 0 }]}
        workspaceId="kaoyan"
        onReview={() => undefined}
      />
    );
    expect(screen.getByText('顽疾')).toBeInTheDocument();

    rerender(
      <MistakeBook
        mistakes={[{ ...mistake(1), wrongCount: 2, correctStreak: 2 }]}
        workspaceId="kaoyan"
        onReview={() => undefined}
      />
    );
    expect(screen.queryByText('顽疾')).not.toBeInTheDocument();

    rerender(
      <MistakeBook
        mistakes={[{ ...mistake(1), wrongCount: 1, priority: 3 }]}
        workspaceId="kaoyan"
        onReview={() => undefined}
      />
    );
    expect(screen.queryByText('顽疾')).not.toBeInTheDocument();
  });

  it('offers 清空已掌握 and 从归档恢复 only when their handlers are supplied', () => {
    const { rerender } = render(
      <MistakeBook mistakes={[mistake(1)]} workspaceId="kaoyan" onReview={() => undefined} />
    );
    expect(screen.queryByRole('button', { name: /清空已掌握/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '从归档恢复' })).not.toBeInTheDocument();

    rerender(
      <MistakeBook
        mistakes={[mistake(1)]}
        workspaceId="kaoyan"
        onClearResolved={vi.fn(async () => undefined)}
        onListArchived={vi.fn(async () => [])}
        onRestore={vi.fn(async () => undefined)}
        onReview={() => undefined}
      />
    );
    expect(screen.getByRole('button', { name: '清空已掌握' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '从归档恢复' })).toBeInTheDocument();
  });

  it('lists archived records and restores one', async () => {
    const user = userEvent.setup();
    const archivedMistake: PracticeMistake = { ...mistake(9), status: 'resolved', archivedAt: '2026-11-05' };
    const onRestore = vi.fn(async () => undefined);
    render(
      <MistakeBook
        mistakes={[mistake(1)]}
        workspaceId="kaoyan"
        onListArchived={vi.fn(async () => [archivedMistake])}
        onRestore={onRestore}
        onClearResolved={vi.fn(async () => undefined)}
        onReview={() => undefined}
      />
    );

    await user.click(screen.getByRole('button', { name: '从归档恢复' }));
    expect(await screen.findByText('归档 · 1 道已掌握')).toBeInTheDocument();
    expect(screen.getByText('2026-11-05 归档 · 错 9 次')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '从归档恢复：错题 9' }));
    await waitFor(() => expect(onRestore).toHaveBeenCalledTimes(1));
    // The restored row leaves the picker.
    await waitFor(() => expect(screen.queryByText('归档 · 1 道已掌握')).not.toBeInTheDocument());
  });

  it('copies the sheet with the per-subject summary line', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText }
    });

    render(
      <MistakeBook
        mistakes={[mistake(1), mistake(2)]}
        workspaceId="kaoyan"
        subjects={{ pm1: '数学', pm2: '英语' }}
        onReview={() => undefined}
      />
    );
    await user.click(screen.getByRole('button', { name: '复制清单' }));
    const text = String(writeText.mock.calls[0]?.[0]);
    expect(text).toContain('\n数学 1 · 英语 1\n');
  });
});
