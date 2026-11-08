import type { ModelClient, ModelMessage, ModelUsage } from '../agent/model-client';
import type { Transcript } from './mimo';

export const NOTE_SYSTEM_PROMPT = [
  '你是一位严谨的课程笔记整理员。你会收到一段课程视频的转录（可能来自语音识别，存在错别字）。',
  '你的任务是把老师讲的内容整理成可复习的中文知识点笔记。',
  '',
  '硬性要求：',
  '1. 只根据转录内容整理，不补充转录里没有的知识，不猜测。',
  '2. 每个知识点标题后标注开始时间，格式 `[mm:ss]` 或 `[hh:mm:ss]`；时间取转录分片开头的标记。',
  '3. 听不清、前后矛盾或明显是 ASR 听错的地方，写进最后的「待确认」，不要擅自编造。',
  '4. 不要输出一级标题（`#`），不要用代码围栏包住整篇笔记，不要输出 mermaid。',
  '5. 英文术语、例句保留原文；老师强调的易错点、口诀、例句要保留。',
  '6. 输出纯 Markdown，结构如下：',
  '',
  '## 一句话总览',
  '（2–4 句话概括本讲主线）',
  '',
  '## 一、知识点标题 [00:00]',
  '（讲解、例句、易错点；可用列表和表格）',
  '',
  '## 二、……',
  '',
  '## 术语表',
  '| 术语 | 含义 / 用法 |',
  '|---|---|',
  '',
  '## 复习卡片',
  '- 问：……',
  '  答：……',
  '',
  '## 待确认',
  '1. （转录存疑处；没有就写“无”）'
].join('\n');

const DIRECT_TRANSCRIPT_LIMIT = 120_000;
const PART_TRANSCRIPT_LIMIT = 60_000;

export interface NoteSource {
  title: string;
  sourcePath: string;
  durationSeconds: number;
  transcript: Transcript;
}

export interface GeneratedNote {
  body: string;
  usage: ModelUsage;
}

function timestamp(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const pad = (value: number) => String(value).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(secs)}` : `${pad(minutes)}:${pad(secs)}`;
}

export function formatTranscript(chunks: Transcript['chunks']): string {
  return chunks
    .filter((chunk) => chunk.text.trim().length > 0)
    .map((chunk) => `[${timestamp(chunk.start)}] ${chunk.text.trim()}`)
    .join('\n');
}

function splitTranscript(chunks: Transcript['chunks']): string[] {
  const parts: string[] = [];
  let current: string[] = [];
  let length = 0;
  for (const chunk of chunks) {
    const line = `[${timestamp(chunk.start)}] ${chunk.text.trim()}`;
    if (!line) continue;
    if (length > 0 && length + line.length > PART_TRANSCRIPT_LIMIT) {
      parts.push(current.join('\n'));
      current = [];
      length = 0;
    }
    current.push(line);
    length += line.length + 1;
    // One unusually long chunk still has to be split so the request fits.
    while (length > PART_TRANSCRIPT_LIMIT) {
      const text = current.join('\n');
      const head = text.slice(0, PART_TRANSCRIPT_LIMIT);
      const tail = text.slice(PART_TRANSCRIPT_LIMIT);
      parts.push(head);
      current = [tail];
      length = tail.length;
    }
  }
  if (current.length > 0) parts.push(current.join('\n'));
  return parts.filter((part) => part.trim().length > 0);
}

function noteRequest(source: NoteSource, transcriptText: string): ModelMessage[] {
  return [
    { role: 'system', content: NOTE_SYSTEM_PROMPT },
    {
      role: 'user',
      content: [
        `课程：${source.title}`,
        `时长：${timestamp(source.durationSeconds)}`,
        `转录字数：${source.transcript.chars}`,
        '',
        '以下是带时间戳的转录：',
        '',
        transcriptText
      ].join('\n')
    }
  ];
}

function extractRequest(source: NoteSource, part: string, index: number, total: number): ModelMessage[] {
  return [
    {
      role: 'system',
      content: [
        '你在为一份课程笔记做分段素材提取。只根据给定转录整理，不补充外部知识，不猜测。',
        '输出简短的 Markdown 列表：每条知识点一行，保留开始时间 `[mm:ss]`、老师强调的例句和易错点。',
        '同时列出本段出现的术语和可能的 ASR 存疑处。不要写总览，不要复述原文。'
      ].join('\n')
    },
    {
      role: 'user',
      content: [
        `课程：${source.title}`,
        `片段：${index + 1}/${total}`,
        '',
        part
      ].join('\n')
    }
  ];
}

function mergeRequest(source: NoteSource, extracts: string[]): ModelMessage[] {
  return [
    { role: 'system', content: NOTE_SYSTEM_PROMPT },
    {
      role: 'user',
      content: [
        `课程：${source.title}`,
        `时长：${timestamp(source.durationSeconds)}`,
        '',
        '下面是同一讲按时间顺序提取的分段素材。请合并、去重，写成一份完整笔记：',
        '',
        extracts.map((part, index) => `### 素材 ${index + 1}\n${part}`).join('\n\n')
      ].join('\n')
    }
  ];
}

function stripFence(text: string): string {
  let body = text.trim().replace(/\r\n/g, '\n');
  const fenced = body.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/i);
  if (fenced) body = fenced[1]!.trim();
  // The prompt forbids a title, but models still add one now and then.
  body = body.replace(/^#\s+.*\n+/, '');
  return body.trim();
}

/** Runs one or more model calls, keeping long transcripts within the context. */
export async function generateNoteBody(
  modelClient: ModelClient,
  source: NoteSource
): Promise<GeneratedNote> {
  const usage: ModelUsage = { inputTokens: 0, outputTokens: 0 };
  const accumulate = (next: ModelUsage | undefined) => {
    usage.inputTokens += next?.inputTokens ?? 0;
    usage.outputTokens += next?.outputTokens ?? 0;
  };

  const direct = formatTranscript(source.transcript.chunks);
  if (direct.length <= DIRECT_TRANSCRIPT_LIMIT) {
    const response = await modelClient.complete({
      messages: noteRequest(source, direct),
      temperature: 0.2,
      maxTokens: 12_000
    });
    accumulate(response.usage);
    return { body: stripFence(response.text), usage };
  }

  const parts = splitTranscript(source.transcript.chunks);
  const extracts: string[] = [];
  for (let index = 0; index < parts.length; index += 1) {
    const response = await modelClient.complete({
      messages: extractRequest(source, parts[index]!, index, parts.length),
      temperature: 0.2,
      maxTokens: 6_000
    });
    accumulate(response.usage);
    const extract = stripFence(response.text);
    if (extract) extracts.push(extract);
  }
  if (extracts.length === 0) throw new Error('模型没有返回任何笔记素材。');

  const merged = await modelClient.complete({
    messages: mergeRequest(source, extracts),
    temperature: 0.2,
    maxTokens: 12_000
  });
  accumulate(merged.usage);
  return { body: stripFence(merged.text), usage };
}
