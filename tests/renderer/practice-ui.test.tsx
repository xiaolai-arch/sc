// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {
  CreatePracticeSetInput,
  PracticeAttempt,
  PracticeMistake,
  PracticeSet
} from '../../src/shared/practice';
import type { Workspace } from '../../src/shared/workspace';
import { LearningPane } from '../../src/renderer/shell/LearningPane';
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
      }
    ];

    const view = renderPane({ set: practiceSet, attempts });

    expect(screen.getByText('答题历史')).toBeInTheDocument();
    expect(screen.getByText('2026-11-01 08:30')).toBeInTheDocument();
    expect(screen.getByText('2026-11-02 09:15')).toBeInTheDocument();
    expect(screen.getByText('回答正确')).toBeInTheDocument();
    expect(screen.getByText('回答错误')).toBeInTheDocument();
    expect(screen.getAllByText(practiceSet.questions[0].prompt)).toHaveLength(3);

    view.unmount();

    renderPane({ attempts: [] });
    expect(screen.queryByText('答题历史')).not.toBeInTheDocument();
  });
});
