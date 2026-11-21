// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
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
import { pickOption } from './select-option';

type PaneProps = Parameters<typeof LearningPane>[0];

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
      selfCorrect: true
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
        selfCorrect: false
      })
    );
    expect(await screen.findByText('回答错误')).toBeInTheDocument();
    expect(screen.getByText('已加入错题本，2026-11-02 复习。')).toBeInTheDocument();
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
      throw new Error('工作区不存在');
    });

    renderPane({ mistakes: mistakes(), onExportMistakeSheet });
    await user.click(screen.getByRole('button', { name: '导出复习单' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('工作区不存在');
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
      expect(onSubmitAnswer).toHaveBeenCalledWith({ questionId: 'q1', choice: 1 })
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
    expect(onSubmitAnswer).toHaveBeenCalledWith({ questionId: 'q1', choice: 1 });
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
