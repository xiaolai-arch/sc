import { useState } from 'react';
import { Button } from '../ui/Button';
import { BookOpenIcon, SearchIcon } from '../ui/icons';
import { cn } from '../ui/cn';
import type { Workspace, WorkspaceNote } from './demoData';
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
  onSelectNote: (id: string) => void;
  onOpenChat: () => void;
};

export function NotePane({ note, notes, workspaces, onSelectNote, onOpenChat }: NotePaneProps) {
  if (!note) {
    return (
      <div className="flex h-full flex-1 items-center justify-center bg-white text-[13px] text-gray-500">
        选择一条记录。
      </div>
    );
  }

  const workspace = workspaces.find((item) => item.id === note.workspaceId);
  const related = note.related
    .map((id) => notes.find((item) => item.id === id))
    .filter((item): item is WorkspaceNote => Boolean(item));

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col bg-white">
      <header className="flex h-11 shrink-0 items-center justify-between gap-3 border-b border-black/[0.06] px-4 md:px-5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-[13px] font-medium text-black">记录</span>
          <span className="text-[11px] text-gray-400">/</span>
          <span className="truncate text-[11px] text-gray-500">{note.title}</span>
        </div>
        <Button size="sm" variant="secondary" onClick={onOpenChat}>
          问管家
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6 md:px-6">
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
          <p className="mt-4 rounded-xl border border-black/[0.06] bg-[#fafafa] px-3 py-2 text-[12px] leading-5 text-gray-600">
            {note.summary}
          </p>

          <div className="mt-6 space-y-4">
            {note.blocks.map((block, index) => {
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
      </div>
    </div>
  );
}
