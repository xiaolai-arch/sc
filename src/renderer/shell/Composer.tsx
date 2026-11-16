import { useEffect, useRef, useState, type ComponentType } from 'react';
import {
  CheckIcon,
  ChevronDownIcon,
  PaperclipIcon,
  SendIcon,
  ShieldAlertIcon,
  ShieldCheckIcon,
  ShieldPenIcon
} from '../ui/icons';
import { cn } from '../ui/cn';
import { fileToAttachment, describeAttachment } from './attachments';
import {
  AGENT_PERMISSION_MODES,
  MAX_ATTACHMENTS,
  modeToPermissions,
  permissionsToMode,
  type AgentPermissionMode,
  type AgentPermissions,
  type ChatAttachment
} from '../../shared/attachments';

type ComposerProps = {
  modelLabel: string;
  text: string;
  onTextChange: (text: string) => void;
  /** Returning `false` keeps the draft (e.g. the user cancelled sending). */
  onSend: (text: string) => void | boolean | Promise<void | boolean>;
  disabled?: boolean;
  onStop?: () => void;
  editing?: boolean;
  onCancelEdit?: () => void;
  onOpenModelPicker?: () => void;
  /** Files staged for the next message. */
  attachments?: ChatAttachment[];
  onAttachmentsChange?: (attachments: ChatAttachment[]) => void;
  /** What the local agent may do in this conversation. */
  permissions?: AgentPermissions;
  onPermissionsChange?: (permissions: AgentPermissions) => void;
  /** Centered hero variant used by the empty conversation screen. */
  hero?: boolean;
};

const chipClass =
  'flex max-w-full items-center gap-1 rounded-full bg-black/[0.05] px-2 py-1 text-[11px] text-gray-600 dark:bg-white/[0.08] dark:text-[#c7c7cc]';

const MODE_ICONS: Record<AgentPermissionMode, ComponentType<{ className?: string }>> = {
  readonly: ShieldCheckIcon,
  workspace: ShieldPenIcon,
  full: ShieldAlertIcon
};

function modeOf(permissions: AgentPermissions): AgentPermissionMode {
  return permissionsToMode(permissions);
}

export function Composer({
  modelLabel,
  text,
  onTextChange,
  onSend,
  disabled = false,
  onStop,
  editing = false,
  onCancelEdit,
  onOpenModelPicker,
  attachments = [],
  onAttachmentsChange,
  permissions,
  onPermissionsChange,
  hero = false
}: ComposerProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const permissionsRef = useRef<HTMLDivElement | null>(null);
  // Latest staged files/draft, so an async pick or send never writes state from
  // the values captured when it started.
  const attachmentsRef = useRef(attachments);
  const textRef = useRef(text);
  const [permissionsOpen, setPermissionsOpen] = useState(false);
  const [attachError, setAttachError] = useState<string | null>(null);

  useEffect(() => {
    attachmentsRef.current = attachments;
  }, [attachments]);

  useEffect(() => {
    textRef.current = text;
  }, [text]);

  // A popover that stays open after clicking elsewhere covers the messages.
  useEffect(() => {
    if (!permissionsOpen) return undefined;
    function onPointerDown(event: MouseEvent) {
      if (!permissionsRef.current?.contains(event.target as Node)) setPermissionsOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setPermissionsOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [permissionsOpen]);

  async function pickFiles(files: File[]) {
    if (!onAttachmentsChange) return;
    const room = Math.max(0, MAX_ATTACHMENTS - attachmentsRef.current.length);
    const picked = files.slice(0, room);
    if (picked.length === 0) return;
    const converted = await Promise.all(picked.map((file) => fileToAttachment(file)));
    const added = converted.filter(
      (attachment): attachment is ChatAttachment => attachment !== null
    );
    const refused = picked.length - added.length;
    setAttachError(
      refused > 0
        ? '部分文件类型或大小暂不支持（图片支持 PNG/JPEG/WebP，文本支持 .md/.txt 等）。'
        : null
    );
    if (added.length > 0) {
      onAttachmentsChange(
        [...attachmentsRef.current, ...added].slice(0, MAX_ATTACHMENTS)
      );
    }
  }

  function selectPermissionMode(mode: AgentPermissionMode) {
    if (!onPermissionsChange) return;
    onPermissionsChange(modeToPermissions(mode));
    setPermissionsOpen(false);
  }

  async function send() {
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    setAttachError(null);
    // Clear before awaiting: the box is the user's draft, and anything typed
    // while the message is stored must not be wiped when the call resolves.
    onTextChange('');
    // The prop may not re-render synchronously (and tests keep it fixed), so
    // record the cleared draft here; typing updates it through the effect.
    textRef.current = '';
    let accepted: void | boolean;
    try {
      accepted = await onSend(trimmed);
    } catch {
      // A thrown send is a failed send; the caller already reported it.
      accepted = false;
    }
    // The message never reached the conversation, so put the draft back — but
    // never overwrite text the user typed while the send was in flight.
    if (accepted === false && textRef.current.trim() === '') onTextChange(trimmed);
  }

  const currentMode = permissions ? modeOf(permissions) : null;
  const ModeIcon = currentMode ? MODE_ICONS[currentMode] : null;

  return (
    <div className={hero ? 'w-full' : 'shrink-0 px-4 pb-4 pt-2 md:px-6'}>
      <div className="mx-auto w-full max-w-[760px] rounded-2xl bg-white p-3 shadow-sm dark:bg-[#1c1c1e]">
        {editing ? (
          <div className="mb-2 flex items-center justify-between rounded-xl bg-[#0071e3]/5 px-3 py-1.5 text-[12px] text-gray-500 dark:bg-[#0a84ff]/10 dark:text-[#a1a1a6]">
            <span>正在编辑已发送的消息</span>
            {onCancelEdit ? (
              <button
                type="button"
                onClick={onCancelEdit}
                className="rounded-full px-2 py-1 font-medium text-[#0071e3] transition-all duration-300 hover:opacity-80 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30 motion-reduce:transition-none motion-reduce:active:scale-100 dark:text-[#4da3ff]"
              >
                取消编辑
              </button>
            ) : null}
          </div>
        ) : null}
        {attachments.length > 0 ? (
          <div className="mb-2 flex flex-wrap items-center gap-1.5 px-1">
            {attachments.map((attachment, index) => (
              <span key={`${attachment.name}-${index}`} className={chipClass}>
                {attachment.kind === 'image' ? (
                  <span className="shrink-0 text-[10px] text-gray-400 dark:text-[#8e8e93]">
                    IMG
                  </span>
                ) : null}
                <span className="truncate">{describeAttachment(attachment)}</span>
                <button
                  type="button"
                  aria-label={`移除附件 ${attachment.name}`}
                  onClick={() => {
                    setAttachError(null);
                    onAttachmentsChange?.(attachments.filter((_, i) => i !== index));
                  }}
                  className="shrink-0 rounded-full p-0.5 text-gray-400 transition-all duration-300 hover:text-black active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30 motion-reduce:transition-none dark:text-[#8e8e93] dark:hover:text-[#f5f5f7]"
                >
                  ×
                </button>
              </span>
            ))}
            {attachError ? (
              <span className="w-full px-1 text-[11px] text-[#ff9f0a]">{attachError}</span>
            ) : null}
          </div>
        ) : attachError ? (
          <div className="mb-2 px-1 text-[11px] text-[#ff9f0a]">{attachError}</div>
        ) : null}
        <textarea
          value={text}
          onChange={(event) => onTextChange(event.target.value)}
          onKeyDown={(event) => {
            // Enter confirms an IME candidate while composing; sending then
            // would submit half-composed text.
            if (event.nativeEvent.isComposing || event.keyCode === 229) return;
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              send();
            }
          }}
          rows={2}
          placeholder="向阿咲提问，或说「记一下…」"
          aria-label="向阿咲提问"
          className="min-h-[48px] max-h-36 w-full resize-none bg-transparent px-1 py-1 text-[14px] leading-6 text-[#1d1d1f] outline-none placeholder:text-gray-500 dark:text-[#f5f5f7]"
        />
        <div className="mt-2 flex items-center gap-2">
          {onAttachmentsChange ? (
            <div className="flex shrink-0 items-center gap-1">
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                aria-label="选择附件"
                onChange={(event) => {
                  // `files` is live: resetting the input would empty it in
                  // place, so copy it first.
                  const files = Array.from(event.target.files ?? []);
                  event.target.value = '';
                  void pickFiles(files);
                }}
              />
              <button
                type="button"
                aria-label={attachments.length >= MAX_ATTACHMENTS ? '附件已达上限' : '添加附件'}
                title="添加图片或文本附件"
                disabled={disabled || attachments.length >= MAX_ATTACHMENTS}
                onClick={() => fileInputRef.current?.click()}
                className="flex h-8 w-8 items-center justify-center rounded-full text-gray-500 transition-all duration-300 hover:bg-black/[0.04] hover:text-black active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30 motion-reduce:transition-none dark:text-[#8e8e93] dark:hover:bg-white/[0.06] dark:hover:text-[#f5f5f7]"
              >
                <PaperclipIcon className="h-4 w-4" />
              </button>
              {attachments.length > 0 ? (
                <span className="text-[11px] tabular-nums text-gray-400 dark:text-[#8e8e93]">
                  {attachments.length}/{MAX_ATTACHMENTS}
                </span>
              ) : null}
            </div>
          ) : null}
          {permissions && onPermissionsChange ? (
            <div ref={permissionsRef} className="relative shrink-0">
              <button
                type="button"
                aria-label="对话权限"
                aria-expanded={permissionsOpen}
                onClick={() => setPermissionsOpen((open) => !open)}
                className="flex max-w-[10rem] items-center gap-1.5 rounded-full px-2 py-1 text-[12px] font-medium text-gray-500 transition-all duration-300 hover:bg-black/[0.04] hover:text-black active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30 motion-reduce:transition-none dark:text-[#8e8e93] dark:hover:bg-white/[0.06] dark:hover:text-[#f5f5f7]"
              >
                {ModeIcon ? <ModeIcon className="h-3.5 w-3.5 shrink-0" /> : null}
                <span className="truncate">
                  {AGENT_PERMISSION_MODES.find((entry) => entry.mode === currentMode)?.label}
                </span>
                <ChevronDownIcon
                  className={cn(
                    'h-3 w-3 shrink-0 transition-transform duration-300 motion-reduce:transition-none',
                    permissionsOpen && 'rotate-180'
                  )}
                />
              </button>
              {permissionsOpen ? (
                <div
                  role="dialog"
                  aria-label="对话权限设置"
                  className="absolute bottom-full left-0 z-20 mb-2 w-72 rounded-xl border border-black/[0.06] bg-white p-1.5 shadow-lg dark:border-white/[0.08] dark:bg-[#2c2c2e]"
                >
                  {AGENT_PERMISSION_MODES.map(({ mode, label, hint }) => {
                    const Icon = MODE_ICONS[mode];
                    const active = mode === currentMode;
                    return (
                      <button
                        key={mode}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        onClick={() => selectPermissionMode(mode)}
                        className={cn(
                          'flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-all duration-300 hover:bg-black/[0.04] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30 motion-reduce:transition-none dark:hover:bg-white/[0.06]',
                          active && 'bg-black/[0.04] dark:bg-white/[0.06]'
                        )}
                      >
                        <Icon className="h-4 w-4 shrink-0 text-gray-500 dark:text-[#8e8e93]" />
                        <span className="min-w-0 flex-1">
                          <span className="block text-[13px] font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">
                            {label}
                          </span>
                          <span className="block text-[11px] leading-4 text-gray-500 dark:text-[#8e8e93]">
                            {hint}
                          </span>
                        </span>
                        {active ? (
                          <CheckIcon className="h-4 w-4 shrink-0 text-[#0071e3] dark:text-[#4da3ff]" />
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>
          ) : null}
          <div className="ml-auto flex min-w-0 items-center gap-3">
            {onOpenModelPicker ? (
              <button
                type="button"
                aria-label="设置本对话模型"
                onClick={onOpenModelPicker}
                className="hidden min-w-0 items-center gap-1.5 rounded-full px-2 py-1 text-[12px] font-medium text-gray-500 transition-all duration-300 hover:bg-black/[0.04] hover:opacity-80 hover:text-black active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30 motion-reduce:transition-none motion-reduce:active:scale-100 dark:text-[#8e8e93] dark:hover:bg-white/[0.06] dark:hover:text-[#f5f5f7] sm:flex"
              >
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#34c759]" />
                <span className="truncate">{modelLabel}</span>
              </button>
            ) : (
              <span className="hidden min-w-0 items-center gap-1.5 text-[12px] text-gray-500 dark:text-[#8e8e93] sm:flex">
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#34c759]" />
                <span className="truncate">{modelLabel}</span>
              </span>
            )}
            {disabled && onStop ? (
              <button
                type="button"
                aria-label="停止生成"
                onClick={onStop}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-[#1d1d1f] text-white transition-all duration-300 ease-[cubic-bezier(0.25,0.1,0.25,1)] hover:opacity-80 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30 motion-reduce:transition-none motion-reduce:active:scale-100 dark:bg-[#242426]"
              >
                <span aria-hidden="true" className="h-3 w-3 rounded-[2px] bg-white" />
              </button>
            ) : (
              <button
                type="button"
                aria-label="发送"
                disabled={!text.trim() || disabled}
                onClick={send}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-[#0071e3] text-white transition-all duration-300 ease-[cubic-bezier(0.25,0.1,0.25,1)] hover:opacity-80 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30 motion-reduce:transition-none motion-reduce:active:scale-100"
              >
                <SendIcon className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
