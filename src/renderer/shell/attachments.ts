import type { ChatAttachment } from '../../shared/attachments';

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const TEXT_EXTENSIONS = /\.(md|markdown|txt|json|csv|log|yaml|yml|ts|tsx|js|jsx|py|html|css)$/i;
/** One file's payload limit; IPC rejects anything larger. */
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_TEXT_BYTES = 512 * 1024;

function base64OfDataUrl(dataUrl: string): string {
  const comma = dataUrl.indexOf(',');
  return comma >= 0 ? dataUrl.slice(comma + 1) : '';
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(reader.error ?? new Error('读取附件失败。'));
    reader.readAsDataURL(file);
  });
}

/**
 * Converts a picked file into the shape the main process understands. Images
 * the model can read travel as base64; text-like files are inlined; anything
 * else is refused instead of being silently dropped.
 */
export async function fileToAttachment(file: File): Promise<ChatAttachment | null> {
  const mediaType = file.type || '';
  const isImage = IMAGE_TYPES.has(mediaType);
  const isText = mediaType.startsWith('text/') || TEXT_EXTENSIONS.test(file.name);
  if (!isImage && !isText) return null;
  if (file.size > (isImage ? MAX_BYTES : MAX_TEXT_BYTES)) return null;

  try {
    if (isImage) {
      const dataUrl = await readAsDataUrl(file);
      const data = base64OfDataUrl(dataUrl);
      if (!data) return null;
      return { name: file.name, mediaType, size: file.size, kind: 'image', data };
    }
    return {
      name: file.name,
      mediaType: mediaType || 'text/plain',
      size: file.size,
      kind: 'text',
      data: await file.text()
    };
  } catch {
    // An unreadable file is refused like an unsupported one; the composer
    // reports the count instead of letting the rejection escape.
    return null;
  }
}

export function describeAttachment(attachment: { name: string; kind: string }): string {
  return attachment.kind === 'image' ? `图片 · ${attachment.name}` : attachment.name;
}