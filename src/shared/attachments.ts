/** Files the user attaches to one chat turn. */
export type AttachmentKind = 'image' | 'text';

/** Cap shared by the composer UI and the main-process prompt builder. */
export const MAX_ATTACHMENTS = 6;

/** A picked file travelling from the renderer to the main process. */
export type ChatAttachment = {
  name: string;
  mediaType: string;
  size: number;
  kind: AttachmentKind;
  /** Base64 payload (images) or UTF-8 text (text files), without a data: prefix. */
  data: string;
};

/** What stays with the persisted message so the bubble can show its files. */
export type MessageAttachment = {
  name: string;
  mediaType: string;
  size: number;
  kind: AttachmentKind;
};

/**
 * What the local agent may do in one conversation. `web` grants its native
 * search/fetch tools, `write` allows changing vault files, and `shell` allows
 * running commands. Read access is always on.
 */
export type AgentPermissions = {
  web: boolean;
  write: boolean;
  shell: boolean;
};

export const DEFAULT_AGENT_PERMISSIONS: AgentPermissions = {
  web: true,
  write: true,
  shell: false
};

/**
 * The three permission levels shown in the composer, mirroring the familiar
 * read-only / workspace-edits / full-access selector. Network search counts as
 * reading, so it stays on in every level.
 */
export type AgentPermissionMode = 'readonly' | 'workspace' | 'full';

export const AGENT_PERMISSION_MODES: ReadonlyArray<{
  mode: AgentPermissionMode;
  label: string;
  hint: string;
}> = [
  { mode: 'readonly', label: '仅可查看', hint: '可以读学习库和联网查询，不做任何改动' },
  { mode: 'workspace', label: '项目内修改', hint: '允许整理和写入学习库中的文件' },
  { mode: 'full', label: '完全权限', hint: '在项目之内额外允许运行终端命令' }
];

export function permissionsToMode(permissions: AgentPermissions): AgentPermissionMode {
  if (permissions.shell) return 'full';
  if (permissions.write) return 'workspace';
  return 'readonly';
}

export function modeToPermissions(mode: AgentPermissionMode): AgentPermissions {
  switch (mode) {
    case 'readonly':
      return { web: true, write: false, shell: false };
    case 'full':
      return { web: true, write: true, shell: true };
    default:
      return { ...DEFAULT_AGENT_PERMISSIONS };
  }
}

export function normalizePermissions(value: unknown): AgentPermissions {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ...DEFAULT_AGENT_PERMISSIONS };
  }
  const record = value as Record<string, unknown>;
  // Fail closed on a malformed persisted value: only an explicit `true` grants
  // write, and shell implies write because commands can edit files anyway.
  const shell = record['shell'] === true;
  return {
    web: record['web'] !== false,
    write: record['write'] === true || shell,
    shell
  };
}

/**
 * Validates a permission object arriving over IPC. Unlike the lenient
 * normalization used for stored files, a malformed payload must be rejected
 * rather than silently granting the default (write) level.
 */
export function isAgentPermissions(value: unknown): value is AgentPermissions {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record['web'] === 'boolean' &&
    typeof record['write'] === 'boolean' &&
    typeof record['shell'] === 'boolean'
  );
}