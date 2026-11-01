import type { CreateLongPlanInput, LongPlanKnowledge } from '../../shared/plans';
import type { Workspace } from '../../shared/workspace';

const MAX_GOAL_LENGTH = 300;
const MAX_NOTES_LENGTH = 800;
const MAX_REFERENCES_LENGTH = 4_000;

export const LONG_PLAN_SYSTEM_PROMPT = `你是阿咲的长期规划助手。你要根据用户的目标、总周数、每周可投入时间和起始日期，制定一份分阶段的长期计划。
规则：
- 只输出一个 JSON 对象，不要 Markdown、解释或代码围栏。
- 总共正好 {weeks} 周；分成 2-4 个连续阶段，每个阶段包含若干周。
- 每个阶段有 title（如“阶段一：建立基础”）、subtitle（一句话说明重点）、goal。
- 每周有 title（如“第 1 周：理解核心概念”）、goal，以及正好 7 个 day。
- 每个 day 有 tasks（2-4 条具体、可执行的短任务）和 output（当天可验收的产出）。
- 每周有 3-6 条 checks，是可以自检的验收项。
- 不需要写日期，系统会按起始日期自动排；但 day 的顺序必须是从本周第 1 天到第 7 天。
- 按每周投入的小时数控制任务量，留出复盘和补进度的缓冲；不要排满 7 天高强度任务。
- 使用中文，结合用户补充的背景；不要编造用户没有提供的经历或资料。
- 如果提供了「参考资料」，按资料的实际范围和顺序安排，不要加入资料没有覆盖的领域。
- 如果提供了「联网调研事实」，优先据此安排工具、版本和验收项，不要写出事实里没有的结论。
- 如果提供了「已掌握」主题，不要从头安排这些内容，最多安排一次复习检查；「正在学」的主题从当前进度继续，不要重讲基础。
格式：{"title":"计划标题","phases":[{"title":"阶段一：建立基础","subtitle":"重点","goal":"阶段目标","weeks":[{"title":"第 1 周：主题","goal":"本周目标","days":[{"tasks":["任务"],"output":"产出"}],"checks":["验收项"]}]}]}`;

export interface LongPlanPrompt {
  system: string;
  user: string;
}

export interface LongPlanPromptInput {
  input: CreateLongPlanInput;
  workspace: Workspace;
  /** Verified facts from the research pass, when it found any. */
  researchFacts?: string[];
  /** Active knowledge topics the user already has. */
  knownTopics?: LongPlanKnowledge[];
}

function clip(value: string, maxLength: number): string {
  const trimmed = value.trim();
  return trimmed.length > maxLength ? `${trimmed.slice(0, maxLength)}…` : trimmed;
}

export function buildLongPlanPrompt({
  input,
  workspace,
  researchFacts,
  knownTopics
}: LongPlanPromptInput): LongPlanPrompt {
  const mastered = (knownTopics ?? [])
    .filter((topic) => topic.status === 'mastered')
    .map((topic) => topic.name);
  const learning = (knownTopics ?? [])
    .filter((topic) => topic.status === 'learning')
    .map((topic) => topic.name);
  const lines = [
    `工作区：${workspace.name}（${workspace.kind}）`,
    workspace.goal.trim() ? `工作区目标：${clip(workspace.goal, MAX_GOAL_LENGTH)}` : null,
    workspace.description.trim()
      ? `工作区说明：${clip(workspace.description, MAX_NOTES_LENGTH)}`
      : null,
    `这次的目标：${clip(input.goal, MAX_GOAL_LENGTH)}`,
    `总周数：${input.weeks}`,
    `每周投入：约 ${input.weeklyHours ?? 10} 小时`,
    `起始日期：${input.startDate ?? '由系统决定'}`,
    input.notes?.trim() ? `补充背景：${clip(input.notes, MAX_NOTES_LENGTH)}` : null,
    input.references?.trim()
      ? `参考资料（请以此为准）：\n${clip(input.references, MAX_REFERENCES_LENGTH)}`
      : null,
    researchFacts?.length
      ? `联网调研事实（已核实，请优先采用）：\n${researchFacts
          .map((fact) => `- ${fact}`)
          .join('\n')}`
      : null,
    mastered.length ? `已掌握：${mastered.join('、')}` : null,
    learning.length ? `正在学：${learning.join('、')}` : null,
    mastered.length || learning.length
      ? '不要从头安排已掌握的主题，正在学的主题从当前进度继续。'
      : null,
    `请按以上时长制定 ${input.weeks} 周的完整计划，只输出 JSON。`
  ];
  return {
    system: LONG_PLAN_SYSTEM_PROMPT.replace('{weeks}', String(input.weeks)),
    user: lines.filter((line): line is string => line !== null).join('\n')
  };
}
