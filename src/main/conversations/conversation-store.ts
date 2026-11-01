import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  Conversation,
  ConversationMessage,
  ConversationStep,
  ConversationSummary,
  CreateConversationInput
} from '../../shared/conversations';

const DEFAULT_TITLE = '新对话';
const TITLE_LIMIT = 24;
const PREVIEW_LIMIT = 80;
const SAFE_ID = /^[A-Za-z0-9_-]+$/;
const GREETING_TEXTS = new Set(['你好', 'hi', 'hello', '在吗', '嗨', '嗯', 'ok']);

export interface ConversationStoreOptions {
  now?: () => Date;
  randomId?: () => string;
}

function assertSafeId(id: string): string {
  if (!SAFE_ID.test(id)) throw new Error(`Invalid conversation id: ${id}`);
  return id;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function truncate(value: string, limit: number): string {
  return Array.from(value.trim()).slice(0, limit).join('');
}

function titleFromText(text: string): string | undefined {
  // Titles come from the first message with substance: greetings, punctuation
  // and emoji-only messages stay on the default title until something useful.
  const normalized = text
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]/gu, '');
  if (normalized.length === 0 || GREETING_TEXTS.has(normalized)) return undefined;
  const title = truncate(text, TITLE_LIMIT);
  return title.length > 0 ? title : undefined;
}

function compareSummaries(a: ConversationSummary, b: ConversationSummary): number {
  const pinned = Number(Boolean(b.pinned)) - Number(Boolean(a.pinned));
  if (pinned !== 0) return pinned;
  return b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id);
}

function normalizeStep(value: unknown): ConversationStep | null {
  if (!isRecord(value)) return null;
  const id = typeof value['id'] === 'string' ? value['id'] : '';
  const name = typeof value['name'] === 'string' ? value['name'] : '';
  const label = typeof value['label'] === 'string' ? value['label'] : '';
  const status = value['status'];
  if (
    !id ||
    !name ||
    !label ||
    (status !== 'running' && status !== 'done' && status !== 'failed')
  ) {
    return null;
  }
  const detail = typeof value['detail'] === 'string' ? value['detail'] : undefined;
  return { id, name, label, status, ...(detail ? { detail } : {}) };
}

function normalizeMessage(value: unknown): ConversationMessage | null {
  if (!isRecord(value)) return null;
  const id = typeof value['id'] === 'string' ? value['id'] : '';
  const role = value['role'];
  const text = typeof value['text'] === 'string' ? value['text'] : '';
  const createdAt = typeof value['createdAt'] === 'string' ? value['createdAt'] : '';
  if (!id || !createdAt || (role !== 'user' && role !== 'assistant')) return null;

  const steps = Array.isArray(value['steps'])
    ? value['steps']
        .map(normalizeStep)
        .filter((step): step is ConversationStep => step !== null)
    : [];
  const source =
    value['source'] === 'user' || value['source'] === 'butler' || value['source'] === 'check-in'
      ? value['source']
      : undefined;
  const trigger =
    value['trigger'] === 'morning' ||
    value['trigger'] === 'evening' ||
    value['trigger'] === 'weekly' ||
    value['trigger'] === 'custom'
      ? value['trigger']
      : undefined;

  return {
    id,
    role,
    text,
    createdAt,
    ...(steps.length > 0 ? { steps } : {}),
    ...(source ? { source } : {}),
    ...(trigger ? { trigger } : {})
  };
}

function normalizeConversation(value: unknown): Conversation | null {
  if (!isRecord(value)) return null;
  const id = typeof value['id'] === 'string' ? value['id'] : '';
  const title = typeof value['title'] === 'string' ? value['title'] : '';
  const createdAt = typeof value['createdAt'] === 'string' ? value['createdAt'] : '';
  const updatedAt = typeof value['updatedAt'] === 'string' ? value['updatedAt'] : createdAt;
  if (!id || !title || !createdAt || !Array.isArray(value['messages'])) return null;

  const kind = value['kind'] === 'check-in' ? 'check-in' : 'chat';
  const workspaceId =
    typeof value['workspaceId'] === 'string' && value['workspaceId'].trim().length > 0
      ? value['workspaceId']
      : undefined;
  const messages = value['messages']
    .map(normalizeMessage)
    .filter((message): message is ConversationMessage => message !== null);

  return {
    id,
    title,
    kind,
    ...(workspaceId ? { workspaceId } : {}),
    ...(value['pinned'] === true ? { pinned: true } : {}),
    createdAt,
    updatedAt,
    messages
  };
}

function toSummary(conversation: Conversation): ConversationSummary {
  const last = conversation.messages[conversation.messages.length - 1];
  return {
    id: conversation.id,
    title: conversation.title,
    kind: conversation.kind,
    ...(conversation.workspaceId ? { workspaceId: conversation.workspaceId } : {}),
    ...(conversation.pinned ? { pinned: true } : {}),
    updatedAt: conversation.updatedAt,
    preview: last ? truncate(last.text, PREVIEW_LIMIT) : ''
  };
}

/**
 * Local-first conversation persistence. One JSON file per conversation keeps
 * writes small and lets list() ignore a single corrupt file.
 */
export class ConversationStore {
  private readonly directory: string;
  private readonly now: () => Date;
  private readonly randomId: () => string;
  private queue: Promise<void> = Promise.resolve();
  private tempCounter = 0;

  constructor(directory: string, options: ConversationStoreOptions = {}) {
    this.directory = directory;
    this.now = options.now ?? (() => new Date());
    this.randomId = options.randomId ?? (() => randomUUID());
  }

  async list(): Promise<ConversationSummary[]> {
    await this.queue;
    return (await this.collectConversations()).map(toSummary).sort(compareSummaries);
  }

  async search(query: string): Promise<ConversationSummary[]> {
    await this.queue;
    const needle = query.trim().toLowerCase();
    const conversations = await this.collectConversations();
    const matched = needle
      ? conversations.filter(
          (conversation) =>
            conversation.title.toLowerCase().includes(needle) ||
            conversation.messages.some((message) =>
              message.text.toLowerCase().includes(needle)
            )
        )
      : conversations;
    return matched.map(toSummary).sort(compareSummaries);
  }

  async get(id: string): Promise<Conversation | null> {
    await this.queue;
    return this.readFile(assertSafeId(id));
  }

  async create(input: CreateConversationInput = {}): Promise<Conversation> {
    return this.runExclusive(async () => {
      const timestamp = this.now().toISOString();
      const id = assertSafeId(this.randomId());
      const title = input.title?.trim() ? truncate(input.title, TITLE_LIMIT) : DEFAULT_TITLE;
      const conversation: Conversation = {
        id,
        title,
        kind: input.kind ?? 'chat',
        ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
        createdAt: timestamp,
        updatedAt: timestamp,
        messages: []
      };
      await this.writeFile(conversation);
      return clone(conversation);
    });
  }

  async appendMessage(id: string, message: ConversationMessage): Promise<Conversation> {
    return this.runExclusive(async () => {
      const conversation = await this.readFile(assertSafeId(id));
      if (conversation === null) throw new Error(`Conversation not found: ${id}`);
      const nextMessage = clone(message);
      conversation.messages.push(nextMessage);
      conversation.updatedAt = this.now().toISOString();
      if (conversation.title === DEFAULT_TITLE && nextMessage.role === 'user') {
        const title = titleFromText(nextMessage.text);
        if (title) conversation.title = title;
      }
      await this.writeFile(conversation);
      return clone(conversation);
    });
  }

  async update(
    id: string,
    mutator: (conversation: Conversation) => Conversation
  ): Promise<Conversation> {
    return this.runExclusive(async () => {
      const current = await this.readFile(assertSafeId(id));
      if (current === null) throw new Error(`Conversation not found: ${id}`);
      const next = mutator(clone(current));
      next.id = current.id;
      next.createdAt = current.createdAt;
      next.updatedAt = this.now().toISOString();
      await this.writeFile(next);
      return clone(next);
    });
  }

  async delete(id: string): Promise<void> {
    return this.runExclusive(async () => {
      await rm(this.filePath(assertSafeId(id)), { force: true });
    });
  }

  async rename(id: string, title: string): Promise<Conversation> {
    return this.runExclusive(async () => {
      const conversation = await this.readFile(assertSafeId(id));
      if (conversation === null) throw new Error(`Conversation not found: ${id}`);
      const trimmed = title.trim();
      if (trimmed.length === 0) throw new Error('对话标题不能为空。');
      conversation.title = truncate(trimmed, TITLE_LIMIT);
      conversation.updatedAt = this.now().toISOString();
      await this.writeFile(conversation);
      return clone(conversation);
    });
  }

  async setPinned(id: string, pinned: boolean): Promise<Conversation> {
    return this.runExclusive(async () => {
      const conversation = await this.readFile(assertSafeId(id));
      if (conversation === null) throw new Error(`Conversation not found: ${id}`);
      if (pinned) conversation.pinned = true;
      else delete conversation.pinned;
      await this.writeFile(conversation);
      return clone(conversation);
    });
  }

  async truncateMessages(id: string, keepCount: number): Promise<Conversation> {
    if (!Number.isInteger(keepCount) || keepCount < 0) {
      throw new Error('保留消息数无效。');
    }
    return this.runExclusive(async () => {
      const conversation = await this.readFile(assertSafeId(id));
      if (conversation === null) throw new Error(`Conversation not found: ${id}`);
      if (keepCount >= conversation.messages.length) return clone(conversation);
      conversation.messages = conversation.messages.slice(0, keepCount);
      conversation.updatedAt = this.now().toISOString();
      await this.writeFile(conversation);
      return clone(conversation);
    });
  }

  async linkWorkspace(id: string, workspaceId: string): Promise<Conversation> {
    return this.update(id, (conversation) => ({ ...conversation, workspaceId }));
  }

  private filePath(id: string): string {
    return join(this.directory, `${id}.json`);
  }

  private async collectConversations(): Promise<Conversation[]> {
    const entries = await readdir(this.directory, { withFileTypes: true }).catch(() => []);
    const conversations: Conversation[] = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const conversation = await this.readFile(entry.name.slice(0, -5));
      if (conversation === null || conversation.messages.length === 0) continue;
      conversations.push(conversation);
    }
    return conversations;
  }

  private async readFile(id: string): Promise<Conversation | null> {
    try {
      const safeId = assertSafeId(id);
      const raw = await readFile(this.filePath(safeId), 'utf8');
      return normalizeConversation(JSON.parse(raw));
    } catch {
      return null;
    }
  }

  private async writeFile(conversation: Conversation): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    const path = this.filePath(conversation.id);
    this.tempCounter += 1;
    const temp = `${path}.${process.pid}.${this.tempCounter}.tmp`;
    try {
      await writeFile(temp, `${JSON.stringify(conversation, null, 2)}\n`, {
        encoding: 'utf8',
        mode: 0o600
      });
      await rename(temp, path);
    } catch (error) {
      await rm(temp, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  private runExclusive<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }
}
