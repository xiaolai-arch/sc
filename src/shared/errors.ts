// Electron wraps a rejected ipcRenderer.invoke as
// `Error invoking remote method '<channel>': Error: <message>`.
// The channel is noise for users; the message is what matters.
const IPC_WRAPPER = /^Error invoking remote method '[^']*': (?:Error: )?/;

/** Turns a thrown value into a user-facing message without transport noise. */
export function friendlyErrorMessage(
  cause: unknown,
  fallback = '操作失败，请重试。'
): string {
  if (!(cause instanceof Error)) return fallback;
  const message = cause.message.replace(IPC_WRAPPER, '').trim();
  return message || fallback;
}
