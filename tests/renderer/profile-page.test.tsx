// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProfilePage } from '../../src/renderer/shell/ProfilePage';
import {
  pushProfileHistory,
  type CreateProfileEntryInput,
  type DeleteProfileEntryInput,
  type ProfileEntry,
  type UpdateProfileEntryInput
} from '../../src/shared/profile';

function entry(overrides: Partial<ProfileEntry> = {}): ProfileEntry {
  return {
    id: 'p1',
    category: 'constraints',
    text: '工作日每天只能安排 1 小时',
    source: 'user',
    confidence: 'confirmed',
    status: 'active',
    origin: '手动添加',
    // Midday UTC so the local MM-DD rendering is stable in any timezone.
    createdAt: '2026-11-01T12:00:00.000Z',
    updatedAt: '2026-11-10T12:00:00.000Z',
    ...overrides
  };
}

/** In-memory profile API covering exactly the calls the page makes. */
function stubApi(initial: ProfileEntry[]) {
  let items = initial;
  let seq = 100;
  return {
    listProfile: async () => structuredClone(items),
    createProfileEntry: async (input: CreateProfileEntryInput) => {
      const timestamp = '2026-11-15T12:00:00.000Z';
      const created: ProfileEntry = {
        id: `p${seq}`,
        category: input.category,
        text: input.text,
        source: input.source ?? 'user',
        confidence: input.confidence ?? 'confirmed',
        status: 'active',
        origin: input.origin ?? '手动添加',
        createdAt: timestamp,
        updatedAt: timestamp
      };
      seq += 1;
      items = [...items, created];
      return structuredClone(created);
    },
    updateProfileEntry: async (input: UpdateProfileEntryInput) => {
      const current = items.find((item) => item.id === input.id);
      if (!current) throw new Error('档案条目不存在。');
      const timestamp = '2026-11-16T12:00:00.000Z';
      const textChanged = input.text !== undefined && input.text !== current.text;
      const next: ProfileEntry = {
        ...current,
        ...(input.category !== undefined ? { category: input.category } : {}),
        ...(input.text !== undefined ? { text: input.text } : {}),
        ...(input.confidence !== undefined ? { confidence: input.confidence } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(textChanged
          ? {
              history: pushProfileHistory(current.history, {
                text: current.text,
                origin: current.origin,
                source: current.source,
                replacedAt: timestamp
              })
            }
          : {}),
        updatedAt: timestamp
      };
      items = items.map((item) => (item.id === input.id ? next : item));
      return structuredClone(next);
    },
    deleteProfileEntry: async (input: DeleteProfileEntryInput) => {
      items = items.filter((item) => item.id !== input.id);
    }
  } as never;
}

function setup(initial: ProfileEntry[]) {
  localStorage.clear();
  window.studyCoach = stubApi(initial);
  render(<ProfilePage onOpenSidebar={vi.fn()} />);
}

test('shows the history toggle only for entries that were edited', async () => {
  setup([
    entry({
      history: [
        {
          text: '工作日每天只能安排 2 小时',
          origin: '手动添加',
          source: 'user',
          replacedAt: '2026-11-05T12:00:00.000Z'
        }
      ]
    }),
    entry({ id: 'p2', text: '数学基础不错', category: 'abilities' })
  ]);

  expect(await screen.findByText('工作日每天只能安排 1 小时')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '曾被修改 1 次' })).toBeInTheDocument();
  // Collapsed by default: the replaced value stays hidden until expanded.
  expect(screen.queryByText('原：工作日每天只能安排 2 小时')).not.toBeInTheDocument();
  // The never-edited entry shows no toggle at all.
  expect(screen.getByText('数学基础不错')).toBeInTheDocument();
  expect(screen.getAllByRole('button', { name: /曾被修改/ })).toHaveLength(1);
});

test('expanding the history shows the old text, origin and replaced date', async () => {
  setup([
    entry({
      history: [
        {
          text: '工作日每天只能安排 2 小时',
          origin: '对话 2026-11-05',
          source: 'user',
          replacedAt: '2026-11-05T12:00:00.000Z'
        }
      ]
    })
  ]);

  await userEvent.click(await screen.findByRole('button', { name: '曾被修改 1 次' }));

  expect(screen.getByText('原：工作日每天只能安排 2 小时')).toBeInTheDocument();
  expect(screen.getByText('11-05 替换')).toBeInTheDocument();
  expect(screen.getByText('对话 2026-11-05')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '收起修改历史' })).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: '收起修改历史' }));
  expect(screen.queryByText('原：工作日每天只能安排 2 小时')).not.toBeInTheDocument();
});

test('editing an entry adds its history and shows the toggle after the save', async () => {
  setup([entry()]);

  await userEvent.click(await screen.findByRole('button', { name: '修改' }));
  const input = screen.getByLabelText('修改资料');
  await userEvent.clear(input);
  await userEvent.type(input, '工作日每天只能安排 2 小时');
  await userEvent.click(screen.getByRole('button', { name: '保存' }));

  expect(await screen.findByText('工作日每天只能安排 2 小时')).toBeInTheDocument();
  await userEvent.click(await screen.findByRole('button', { name: '曾被修改 1 次' }));
  expect(screen.getByText('原：工作日每天只能安排 1 小时')).toBeInTheDocument();
});

test('multiple replacements count up and list newest first', async () => {
  setup([
    entry({
      history: [
        {
          text: '词汇 2000',
          origin: '对话 2026-11-05',
          source: 'user',
          replacedAt: '2026-11-09T12:00:00.000Z'
        },
        {
          text: '词汇 1000',
          origin: '手动添加',
          source: 'user',
          replacedAt: '2026-11-03T12:00:00.000Z'
        }
      ]
    })
  ]);

  await userEvent.click(await screen.findByRole('button', { name: '曾被修改 2 次' }));

  const oldValues = screen.getAllByText(/^原：/);
  expect(oldValues).toHaveLength(2);
  expect(oldValues[0]).toHaveTextContent('原：词汇 2000');
  expect(oldValues[1]).toHaveTextContent('原：词汇 1000');
  expect(screen.getByText('11-09 替换')).toBeInTheDocument();
  expect(screen.getByText('11-03 替换')).toBeInTheDocument();
});
