import { useState } from 'react';
import type { CreateNoteInput, Workspace, WorkspaceNote, WorkspaceTask } from '../../shared/workspace';
import type { ReviewRecord } from '../../shared/ipc';
import type { PracticeAttempt, PracticeSet } from '../../shared/practice';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Label } from '../ui/Label';
import { Textarea } from '../ui/Textarea';
import { BookOpenIcon, SearchIcon } from '../ui/icons';
import { cn } from '../ui/cn';
import { noteBlocks } from './noteBody';
import { shellPaneClass } from './TaskListPane';

type NoteListProps = {
  notes: WorkspaceNote[];
  workspaces: Workspace[];
  selectedNoteId: string | null;
  onSelectNote: (id: string) => void;
  showWorkspace: boolean;
};

export function NoteList({
  notes,
  workspaces,
  selectedNoteId,
  onSelectNote,
  showWorkspace
}: NoteListProps) {
  const [query, setQuery] = useState('');
  const visible = notes.filter((note) => {
    const workspace = workspaces.find((item) => item.id === note.workspaceId);
    const haystack = `${note.title} ${note.subject} ${note.tags.join(' ')} ${workspace?.name ?? ''}`.toLowerCase();
    return !query.trim() || haystack.includes(query.trim().toLowerCase());
  });

  return (
    <aside className={shellPaneClass}>
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-black/[0.06] px-4">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-medium text-black">记录</span>
          <span className="rounded-full bg-black/[0.05] px-1.5 py-0.5 text-[10px] text-gray-500">
            {notes.length}
          </span>
        </div>
      </div>
      <div className="shrink-0 px-3 py-3">
        <div className="flex h-8 items-center gap-2 rounded-md bg-[#f5f5f7] px-2.5 text-gray-500">
          <SearchIcon className="h-3.5 w-3.5" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索笔记、标签"
            aria-label="搜索笔记"
            className="min-w-0 flex-1 bg-transparent text-[12px] text-[#1d1d1f] outline-none placeholder:text-gray-500"
          />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        {visible.length === 0 ? (
          <p className="px-3 py-2 text-[12px] text-gray-500">没有匹配的记录。</p>
        ) : (
          visible.map((note) => {
            const workspace = workspaces.find((item) => item.id === note.workspaceId);
            return (
              <button
                key={note.id}
                type="button"
                onClick={() => onSelectNote(note.id)}
                aria-current={selectedNoteId === note.id ? 'true' : undefined}
                className={cn(
                  'flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors duration-150',
                  selectedNoteId === note.id ? 'bg-[#f0f0f2]' : 'hover:bg-[#f7f7f8]'
                )}
              >
                <BookOpenIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gray-400" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] text-black">{note.title}</span>
                  <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-gray-500">
                    {showWorkspace && workspace ? (
                      <>
                        <span>{workspace.name}</span>
                        <span>·</span>
                      </>
                    ) : null}
                    <span>{note.subject}</span>
                    <span>·</span>
                    <span>{note.updated}</span>
                  </span>
                </span>
              </button>
            );
          })
        )}
      </div>
    </aside>
  );
}

type NotePaneProps = {
  note: WorkspaceNote | null;
  notes: WorkspaceNote[];
  workspaces: Workspace[];
  workspaceId: string | null;
  tasks: WorkspaceTask[];
  practiceSets: PracticeSet[];
  practiceAttempts: PracticeAttempt[];
  reviews: ReviewRecord[];
  onSelectNote: (id: string) => void;
  onOpenChat: () => void;
  onCreateNote: (input: CreateNoteInput) => Promise<WorkspaceNote>;
};

export function NotePane({
  note,
  notes,
  workspaces,
  workspaceId,
  tasks,
  practiceSets,
  practiceAttempts,
  reviews,
  onSelectNote,
  onOpenChat,
  onCreateNote
}: NotePaneProps) {
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const targetWorkspace =
    workspaces.find((workspace) => workspace.id === (workspaceId ?? note?.workspaceId)) ??
    workspaces[0] ??
    null;

  async function submitNote() {
    if (!targetWorkspace) {
      setError('还没有工作区，暂时不能新建记录。');
      return;
    }
    if (!title.trim()) {
      setError('请先填写记录标题。');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const created = await onCreateNote({
        workspaceId: targetWorkspace.id,
        title: title.trim(),
        subject: subject.trim() || targetWorkspace.name,
        tags: ['随手记'],
        summary: body.trim().slice(0, 80),
        body: body.trim()
      });
      setTitle('');
      setSubject('');
      setBody('');
      setCreating(false);
      onSelectNote(created.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '新建记录失败，请重试。');
    } finally {
      setBusy(false);
    }
  }

  const workspace = note ? workspaces.find((item) => item.id === note.workspaceId) : null;
  const related = note
    ? note.related
        .map((id) => notes.find((item) => item.id === id))
        .filter((item): item is WorkspaceNote => Boolean(item))
    : [];

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col bg-white">
      <header className="flex h-11 shrink-0 items-center justify-between gap-3 border-b border-black/[0.06] px-4 md:px-5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-[13px] font-medium text-black">记录</span>
          <span className="text-[11px] text-gray-400">/</span>
          <span className="truncate text-[11px] text-gray-500">
            {creating ? '新建记录' : (note?.title ?? '选择一条记录')}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              setCreating(true);
              setError(null);
            }}
          >
            新建记录
          </Button>
          <Button size="sm" variant="secondary" onClick={onOpenChat}>
            问管家
          </Button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6 md:px-6">
        <div className="mx-auto mb-5 w-full max-w-[720px]">
          <div className="rounded-xl border border-black/[0.06] bg-[#fafafa] p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[13px] font-medium text-black">最近活动</p>
              <span className="text-[11px] text-gray-500">
                {tasks.length} 个任务 · {practiceAttempts.length} 次练习 · {reviews.length} 条复盘
              </span>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <div>
                <p className="text-[11px] font-medium text-gray-500">任务</p>
                <ul className="mt-1.5 space-y-1 text-[12px] leading-5 text-gray-600">
                  {tasks.length === 0 ? (
                    <li className="text-gray-400">还没有任务</li>
                  ) : (
                    tasks.slice(0, 3).map((task) => (
                      <li key={task.id} className="truncate">
                        {task.status === 'done' ? '✓ ' : ''}
                        {task.title}
                      </li>
                    ))
                  )}
                </ul>
              </div>
              <div>
                <p className="text-[11px] font-medium text-gray-500">练习</p>
                <ul className="mt-1.5 space-y-1 text-[12px] leading-5 text-gray-600">
                  {practiceAttempts.length === 0 ? (
                    <li className="text-gray-400">还没有练习</li>
                  ) : (
                    [...practiceAttempts]
                      .slice(-3)
                      .reverse()
                      .map((attempt) => {
                        const set = practiceSets.find((item) => item.id === attempt.setId);
                        return (
                          <li key={attempt.id} className="truncate">
                            {set?.title ?? '练习'} · {attempt.correct ? '答对' : '答错'}
                          </li>
                        );
                      })
                  )}
                </ul>
              </div>
              <div>
                <p className="text-[11px] font-medium text-gray-500">复盘</p>
                <ul className="mt-1.5 space-y-1 text-[12px] leading-5 text-gray-600">
                  {reviews.length === 0 ? (
                    <li className="text-gray-400">还没有复盘</li>
                  ) : (
                    reviews.slice(0, 3).map((review) => (
                      <li key={`${review.date}-${review.submittedAt}`} className="truncate">
                        {review.date}
                        {review.skipped ? ' · 已跳过' : ''}
                      </li>
                    ))
                  )}
                </ul>
              </div>
            </div>
          </div>
        </div>
        {creating ? (
          <form
            className="mx-auto w-full max-w-[720px] space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              void submitNote();
            }}
          >
            <div className="rounded-xl border border-black/[0.06] bg-[#fafafa] p-4">
              <p className="text-[13px] font-medium text-black">新建记录</p>
              <p className="mt-1 text-[11px] text-gray-500">
                会写入「{targetWorkspace?.name ?? '当前工作区'}」，之后可以在复盘里回顾。
              </p>
              <div className="mt-4 space-y-3">
                <div>
                  <Label htmlFor="pane-note-title">标题</Label>
                  <Input
                    id="pane-note-title"
                    aria-label="记录标题"
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    placeholder="例如：今天的错题整理"
                  />
                </div>
                <div>
                  <Label htmlFor="pane-note-subject">科目（可选）</Label>
                  <Input
                    id="pane-note-subject"
                    aria-label="记录科目"
                    value={subject}
                    onChange={(event) => setSubject(event.target.value)}
                    placeholder={targetWorkspace?.name ?? '学习'}
                  />
                </div>
                <div>
                  <Label htmlFor="pane-note-body">正文</Label>
                  <Textarea
                    id="pane-note-body"
                    aria-label="记录正文"
                    value={body}
                    onChange={(event) => setBody(event.target.value)}
                    placeholder="写下今天学到什么、卡在哪里。"
                  />
                </div>
              </div>
              {error ? (
                <p role="alert" className="mt-3 text-[12px] text-[#d70015]">
                  {error}
                </p>
              ) : null}
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <Button type="submit" size="sm" disabled={busy}>
                  {busy ? '正在保存…' : '保存记录'}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => {
                    setCreating(false);
                    setError(null);
                  }}
                >
                  取消
                </Button>
              </div>
            </div>
          </form>
        ) : note ? (
          <article className="mx-auto w-full max-w-[720px]">
            <p className="flex flex-wrap items-center gap-1.5 text-[11px] text-gray-500">
              {workspace ? (
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: workspace.color }} />
                  {workspace.name}
                </span>
              ) : null}
              <span>·</span>
              <span>{note.subject}</span>
              <span>·</span>
              <span>{note.updated}</span>
              <span>·</span>
              <span>本地 markdown</span>
            </p>
            <h1 className="mt-3 text-[22px] font-semibold tracking-tight text-black">{note.title}</h1>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {note.tags.map((tag) => (
                <span key={tag} className="rounded-full bg-[#f5f5f7] px-2 py-0.5 text-[11px] text-gray-600">
                  #{tag}
                </span>
              ))}
            </div>
            {note.summary ? (
              <p className="mt-4 rounded-xl border border-black/[0.06] bg-[#fafafa] px-3 py-2 text-[12px] leading-5 text-gray-600">
                {note.summary}
              </p>
            ) : null}

            <div className="mt-6 space-y-4">
              {noteBlocks(note.body).map((block, index) => {
                if (block.kind === 'h2') {
                  return (
                    <h2 key={index} className="pt-2 text-[15px] font-semibold tracking-tight text-black">
                      {block.text}
                    </h2>
                  );
                }
                if (block.kind === 'ul') {
                  return (
                    <ul key={index} className="list-disc space-y-1.5 pl-5 text-[13px] leading-6 text-gray-600">
                      {block.items.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  );
                }
                return (
                  <p key={index} className="text-[13px] leading-6 text-gray-600">
                    {block.text}
                  </p>
                );
              })}
            </div>

            {related.length > 0 ? (
              <div className="mt-8 border-t border-black/[0.06] pt-4">
                <p className="text-[11px] font-medium text-gray-500">关联笔记</p>
                <div className="mt-2 space-y-1">
                  {related.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => onSelectNote(item.id)}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] text-[#0071e3] transition-colors duration-150 hover:bg-[#f7f7f8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30"
                    >
                      <BookOpenIcon className="h-3.5 w-3.5" />
                      {item.title}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </article>
        ) : (
          <div className="mx-auto flex w-full max-w-[720px] flex-col items-center justify-center py-16 text-center">
            <p className="text-[13px] text-gray-500">选择一条记录，或者新建一条。</p>
            <Button className="mt-4" size="sm" onClick={() => setCreating(true)}>
              新建记录
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
