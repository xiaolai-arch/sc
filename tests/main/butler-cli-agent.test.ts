import type {
  CreateNoteInput,
  CreateTaskInput,
  CreateWorkspaceInput,
  MemoryItem,
  Reminder,
  SubmitReviewInput,
  UpdateWorkspaceNoteInput,
  UpdateWorkspaceTaskInput,
  Workspace,
  WorkspaceNote,
  WorkspaceService,
  WorkspaceSnapshot,
  WorkspaceTask
} from '../../src/shared/workspace';
import {
  CliAgentClient,
  type CliRunner
} from '../../src/main/agent/cli-agent-client';
import { ButlerServiceImpl } from '../../src/main/butler/butler-service';

const NOW = new Date(2026, 9, 31, 9, 30, 0);

const WORKSPACE: Workspace = {
  id: 'ws-exam',
  name: '考研',
  kind: 'exam',
  color: '#ef4444',
  goal: '2027 上岸',
  description: '考研复习'
};

/** In-memory workspace service; no vault and no network. */
class CliWorkspaceService implements WorkspaceService {
  readonly workspaces: Workspace[] = [{ ...WORKSPACE }];
  readonly tasks: WorkspaceTask[] = [
    {
      id: 't1',
      workspaceId: 'ws-exam',
      title: '极限刷题',
      subject: '数学',
      durationMin: 45,
      acceptance: '完成 10 题',
      status: 'pending'
    }
  ];
  readonly notes: WorkspaceNote[] = [];
  readonly memory: MemoryItem[] = [
    { id: 'm1', workspaceId: 'ws-exam', text: '晚上效率更高', source: '复盘' }
  ];

  async listWorkspaces(): Promise<Workspace[]> {
    return this.workspaces;
  }

  async createWorkspace(input: CreateWorkspaceInput): Promise<Workspace> {
    const workspace: Workspace = {
      ...input,
      id: `ws-${this.workspaces.length + 1}`,
      color: input.color ?? '#000000'
    };
    this.workspaces.push(workspace);
    return workspace;
  }

  async getWorkspaceSnapshot(workspaceId: string): Promise<WorkspaceSnapshot> {
    const workspace = this.workspaces.find((candidate) => candidate.id === workspaceId);
    if (!workspace) {
      throw new Error(`Workspace not found: ${workspaceId}`);
    }
    return {
      workspace,
      tasks: this.tasks.filter((task) => task.workspaceId === workspaceId),
      notes: this.notes.filter((note) => note.workspaceId === workspaceId),
      memory: this.memory.filter((item) => item.workspaceId === workspaceId),
      reminders: []
    };
  }

  async createTask(input: CreateTaskInput): Promise<WorkspaceTask> {
    const task: WorkspaceTask = {
      id: `t${this.tasks.length + 1}`,
      ...input,
      status: 'pending'
    };
    this.tasks.push(task);
    return task;
  }

  async updateWorkspaceTask(input: UpdateWorkspaceTaskInput): Promise<WorkspaceTask> {
    const task = this.tasks.find((candidate) => candidate.id === input.taskId);
    if (!task) {
      throw new Error(`Task not found: ${input.taskId}`);
    }
    task.status = input.status;
    if (input.actualMin !== undefined) {
      task.actualMin = input.actualMin;
    }
    return task;
  }

  async createNote(input: CreateNoteInput): Promise<WorkspaceNote> {
    const note: WorkspaceNote = {
      id: `n${this.notes.length + 1}`,
      workspaceId: input.workspaceId,
      title: input.title,
      subject: input.subject,
      tags: input.tags ?? [],
      updated: '2026-10-31',
      summary: input.summary ?? '',
      body: input.body,
      related: input.related ?? [],
      path: `notes/n${this.notes.length + 1}.md`
    };
    this.notes.push(note);
    return note;
  }

  async updateNote(input: UpdateWorkspaceNoteInput): Promise<WorkspaceNote> {
    const note = this.notes.find((candidate) => candidate.id === input.noteId);
    if (!note) {
      throw new Error(`Note not found: ${input.noteId}`);
    }
    return note;
  }

  async getMemory(workspaceId?: string): Promise<MemoryItem[]> {
    return workspaceId
      ? this.memory.filter((item) => item.workspaceId === workspaceId)
      : this.memory;
  }

  async getReminders(): Promise<Reminder[]> {
    return [];
  }

  async submitReview(_input: SubmitReviewInput): Promise<void> {
    // no-op for the fake
  }
}

type ScriptedOutput = string | { stdout: string; code: number };

function scriptedRunner(outputs: ScriptedOutput[]) {
  const prompts: string[] = [];
  let cursor = 0;
  const runner: CliRunner = async (_command, _args, input) => {
    prompts.push(input);
    const next = outputs[cursor];
    cursor += 1;
    if (next === undefined) {
      throw new Error('CLI runner received more calls than scripted.');
    }
    return typeof next === 'string'
      ? { stdout: next, stderr: '', code: 0 }
      : { stdout: next.stdout, stderr: '', code: next.code };
  };
  return {
    runner,
    prompts,
    get callCount() {
      return cursor;
    }
  };
}

function envelope(value: unknown): string {
  return `\`\`\`json\n${JSON.stringify(value)}\n\`\`\``;
}

function makeService(workspace: CliWorkspaceService, runner: CliRunner): ButlerServiceImpl {
  return new ButlerServiceImpl({
    workspaceService: workspace,
    modelClient: new CliAgentClient({ kind: 'local-cli', agent: 'claude' }, { runner }),
    now: () => NOW,
    modelRetry: { delayMs: 0 }
  });
}

describe('ButlerServiceImpl with a local CLI agent', () => {
  test('executes a write_note tool call emitted by the CLI', async () => {
    const workspace = new CliWorkspaceService();
    const scripted = scriptedRunner([
      envelope({
        text: '我来记一下。',
        toolCalls: [
          {
            name: 'write_note',
            arguments: {
              title: '极限笔记',
              body: '等价无穷小替换',
              tags: ['数学']
            }
          }
        ]
      }),
      '已经记下来了。'
    ]);

    const result = await makeService(workspace, scripted.runner).send({
      workspaceId: 'ws-exam',
      message: '记一下等价无穷小'
    });

    expect(result).toEqual({
      text: '已经记下来了。',
      usage: { inputTokens: 0, outputTokens: 0 }
    });
    expect(workspace.notes).toHaveLength(1);
    expect(workspace.notes[0]).toMatchObject({
      workspaceId: 'ws-exam',
      title: '极限笔记',
      subject: '考研',
      tags: ['数学'],
      body: '等价无穷小替换'
    });

    expect(scripted.prompts).toHaveLength(2);
    expect(scripted.prompts[0]).toContain('## 工具调用协议');
    expect(scripted.prompts[0]).toContain('write_note');
    expect(scripted.prompts[1]).toContain('ASSISTANT TOOL CALLS:');
    expect(scripted.prompts[1]).toContain('TOOL RESULT (write_note):');
    expect(scripted.prompts[1]).toContain('"noteId":"n1"');
  });

  test('executes several tool calls from one CLI answer', async () => {
    const workspace = new CliWorkspaceService();
    const scripted = scriptedRunner([
      envelope({
        text: '',
        toolCalls: [
          { name: 'get_today_plan', arguments: {} },
          { name: 'update_task', arguments: { taskId: 't1', status: 'done', actualMin: 40 } }
        ]
      }),
      '任务已经标记完成。'
    ]);

    const result = await makeService(workspace, scripted.runner).send({
      workspaceId: 'ws-exam',
      message: '极限做完了'
    });

    expect(result.text).toBe('任务已经标记完成。');
    expect(workspace.tasks[0]).toMatchObject({ status: 'done', actualMin: 40 });
    expect(scripted.prompts[1]).toContain('TOOL RESULT (get_today_plan):');
    expect(scripted.prompts[1]).toContain('TOOL RESULT (update_task):');
  });

  test('reports an unknown CLI tool back to the agent and still returns text', async () => {
    const workspace = new CliWorkspaceService();
    const scripted = scriptedRunner([
      envelope({
        text: '',
        toolCalls: [{ name: 'delete_everything', arguments: {} }]
      }),
      '这个操作不可用。'
    ]);

    const result = await makeService(workspace, scripted.runner).send({
      workspaceId: 'ws-exam',
      message: '删掉所有东西'
    });

    expect(result.text).toBe('这个操作不可用。');
    expect(scripted.prompts[1]).toContain('未知工具');
    expect(scripted.prompts[1]).toContain('delete_everything');
    expect(workspace.notes).toHaveLength(0);
  });

  test('a tool input error degrades to a tool result without breaking the reply', async () => {
    const workspace = new CliWorkspaceService();
    const scripted = scriptedRunner([
      envelope({
        text: '',
        toolCalls: [{ name: 'write_note', arguments: { body: '只有正文' } }]
      }),
      '缺少标题，这次没有记下来。'
    ]);

    const result = await makeService(workspace, scripted.runner).send({
      workspaceId: 'ws-exam',
      message: '记一下'
    });

    expect(result.text).toBe('缺少标题，这次没有记下来。');
    expect(scripted.prompts[1]).toContain('缺少参数 title');
    expect(workspace.notes).toHaveLength(0);
  });

  test('malformed structured output falls back to plain CLI text', async () => {
    const workspace = new CliWorkspaceService();
    const raw = '我先查一下。\n```json\n{"text": "坏掉"\n```';
    const scripted = scriptedRunner([raw]);

    const result = await makeService(workspace, scripted.runner).send({
      workspaceId: 'ws-exam',
      message: '今天做什么？'
    });

    expect(result.text).toBe(raw);
    expect(result.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
    expect(scripted.callCount).toBe(1);
    expect(workspace.notes).toHaveLength(0);
    expect(workspace.tasks[0]?.status).toBe('pending');
  });

  test('a failed CLI process falls back to a template reply', async () => {
    const workspace = new CliWorkspaceService();
    const scripted = scriptedRunner([
      envelope({
        text: '',
        toolCalls: [{ name: 'get_today_plan', arguments: {} }]
      }),
      { stdout: '', code: 1 },
      { stdout: '', code: 1 }
    ]);

    const result = await makeService(workspace, scripted.runner).send({
      workspaceId: 'ws-exam',
      message: '今天做什么？'
    });

    expect(result.text).toContain('已自动重试 1 次');
    expect(result.text).toContain('考研');
    expect(scripted.callCount).toBe(3);
  });
});
