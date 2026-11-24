import type { BackupCopied } from './ipc';

/**
 * The 「换机」 third line, in both delivery versions. The settings page (P3 is
 * live) and the first-run restore entry must quote the same constant instead
 * of copying the string — three surfaces quoting two drifting variants is
 * exactly how 评审阻断 3 happened. Which line a surface shows is decided by
 * whether the restore adopted settings, not by where it is rendered.
 */

/** P3 版：备份里的设置会一起还原（全新机器采纳了 `state.json` 时）。 */
export const MIGRATION_STEP_LINE_SETTINGS_ADOPTED =
  '恢复会带回项目、记录、对话和用量；新机器上没有设置时，备份里的设置会一起还原，API Key 需要重新填写（它从未进入备份）。';

/** P2 版：恢复不改动设置（备份无可用 `state.json`，或本机已有 `state.json`）。 */
export const MIGRATION_STEP_LINE_SETTINGS_UNCHANGED =
  '恢复会带回项目、记录、对话和用量；恢复不改动设置，换机后设置和 API Key 需要重新填写（API Key 从未进入备份）。';

/**
 * The nouns one backup/restore actually carried, from the `copied`/`restored`
 * booleans; sources that did not exist are simply left out. vault holds both
 * the projects and the records, so it maps to two nouns.
 */
export function backupCopiedParts(copied: BackupCopied): string[] {
  return [
    ...(copied.vault ? ['项目', '记录'] : []),
    ...(copied.conversations ? ['对话'] : []),
    ...(copied.state ? ['设置'] : []),
    ...(copied.usage ? ['用量'] : [])
  ];
}

/**
 * The export toast's second line, built from what this backup actually carried
 * (`BackupResult.copied`).
 */
export function backupCopiedLabel(copied: BackupCopied): string | null {
  const parts = backupCopiedParts(copied);
  return parts.length > 0 ? `包含：${parts.join('、')}` : null;
}
