# Study Coach Web UI 原型（Apple Style）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 先在浏览器里做出可点击、可演示的 Study Coach M1 界面，严格遵循 Apple Style；数据层用 mock/localStorage，之后同一套 React 组件直接接入 Electron IPC。

**Architecture:** `web/` 是独立的 Vite 浏览器入口，安装一个实现 `StudyCoachApi` 的 mock 到 `window.studyCoach`。界面组件全部放在 `src/renderer/`，共享类型与校验放在 `src/shared/`。Electron 版继续使用同一个 renderer，只是把 mock 换成 preload 暴露的真实 IPC。Tailwind CSS v4 提供 Apple Style 的令牌与工具类。

**Tech Stack:** React 19 + Vite 8 + TypeScript（strict）+ Tailwind CSS v4 + Vitest 5 + Testing Library + jsdom + zod。

**Spec:** `/Users/Admin/orca/projects/OrcaProject/docs/superpowers/specs/2026-10-31-study-coach-design.md`

**Design references（用户提供，实施时必须阅读）:**
- `/Users/Admin/Downloads/apple-style-creative-brief.md`
- `/Users/Admin/Downloads/apple-style-design-spec.md`
- `/Users/Admin/Downloads/apple-style-hard-prompt.md`

**Scope:** 浏览器 UI 原型，覆盖 M1 的 Onboarding、今日计划、晚间复盘、设置四个界面。不实现真实 vault、模型调用、调度器、托盘；这些仍由原 M1 计划后续接入。原型中的 API Key 只保存在页面内存，不写入 localStorage，不发起任何网络请求。

## Global Constraints

- 所有 UI 文案中文；代码标识符英文。
- Apple Style：背景 `#f5f5f7`；主文字 `#1d1d1f` / 黑色；强调色 `#0071e3`；语义绿 `#34c759`；语义红 `#ff3b30`。
- 字体栈：`-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif`。
- 标题：`font-semibold tracking-tight text-black`；正文：`text-gray-600`；链接：`text-[#0071e3] hover:underline`。
- 每个按钮必须包含：`rounded-full font-medium transition-all duration-300`；主按钮 `bg-[#0071e3] text-white`；所有按钮 `active:scale-[0.98]`、`hover:opacity-80`、可见 focus ring、`min-h-11`。
- 每个卡片必须包含：`bg-white rounded-2xl shadow-sm`；卡片内边距 `p-8`（大屏可用 `md:p-12`）。
- 每个文本输入必须包含：`bg-[#f5f5f7] rounded-xl text-[#1d1d1f] focus:outline-none focus:ring-2 focus:ring-[#0071e3]/30 transition-all`；`min-h-11`。
- 禁止：渐变背景、`shadow-2xl`/`shadow-inner`、`border-2`/`border-4`、弹跳/回弹缓动、玻璃拟态作为默认表面、渐变文字、超过 1px 的侧边色条、嵌套卡片、彩色背景上的灰字、每个区块上方的小号大写 eyebrow 标签。
- 容器：`max-w-[980px] mx-auto px-6 md:px-8`；Onboarding 区块 `py-20 md:py-32`；应用内页 `py-12 md:py-20`；默认间距 `gap-8`。
- 交互过渡：`transition-all duration-300`；焦点环 `focus-visible:ring-4 focus-visible:ring-[#0071e3]/30 focus-visible:outline-none`；`motion-reduce:transition-none`。
- 无障碍：WCAG AA；正文对比度 ≥ 4.5:1；所有交互元素有可访问名称与可见焦点；触控目标 ≥ 44px；对话框支持 Escape 关闭并把焦点移到第一个输入。
- 本地优先：原型不发起网络请求；mock 数据只存 localStorage；API Key 只存内存。
- TypeScript strict；每个任务结束运行 `npm run typecheck && npm test` 并提交。
- 测试不联网；渲染测试使用 `// @vitest-environment jsdom`。

## Review Focus

1. **响应式溢出**：375px、768px、1280px 下页面不能横向滚动；任务卡按钮在窄屏换行而不是挤出容器。由 Task 3 的 `today` 测试与最终人工检查覆盖。
2. **焦点与键盘**：所有按钮/输入有可见焦点；复盘对话框 Escape 关闭、打开时焦点进入第一个 textarea。由 Task 3 的 `review` 测试覆盖。
3. **对比度**：正文在 `#f5f5f7` 和白色卡片上都达到 AA；不得用 `text-gray-400` 承载正文。由 Task 1 的样式测试与人工检查覆盖。
4. **API Key 不回显**：保存后输入框清空；原型不把 key 写入 localStorage。由 Task 4 的 `settings` 测试覆盖。
5. **样式禁令**：渲染出的组件不得包含 `bg-gradient-*`、`shadow-2xl`、`shadow-inner`、`border-2`、`border-4`。由 Task 1 的 `ui` 测试覆盖。

---

## Task 1: Tailwind、Apple 设计系统与浏览器入口

**Files:**
- Modify: `package.json`, `electron.vite.config.ts`, `tsconfig.node.json`, `tsconfig.web.json`, `src/renderer/styles.css`
- Create: `vite.web.config.ts`, `web/index.html`, `web/main.tsx`, `src/renderer/ui/cn.ts`, `src/renderer/ui/Button.tsx`, `src/renderer/ui/Card.tsx`, `src/renderer/ui/Input.tsx`, `src/renderer/ui/Textarea.tsx`, `src/renderer/ui/Select.tsx`, `src/renderer/ui/Label.tsx`, `src/renderer/ui/Badge.tsx`, `src/renderer/ui/Progress.tsx`, `src/renderer/ui/PageShell.tsx`, `src/renderer/ui/Dialog.tsx`, `src/renderer/ui/EmptyState.tsx`, `src/renderer/ui/icons.tsx`
- Test: `tests/web/ui.test.tsx`

**Interfaces:**
- `cn(...values: Array<string | false | null | undefined>): string` — 过滤空值并用空格连接。
- `Button`：`React.ComponentPropsWithoutRef<'button'> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; size?: 'md' | 'sm' }`。默认 `variant='primary'`、`size='md'`。
- `Card`：`React.ComponentPropsWithoutRef<'div'>`；基础类 `bg-white rounded-2xl shadow-sm`。
- `Input`、`Textarea`、`Select`：`React.ComponentPropsWithoutRef<'input' | 'textarea' | 'select'>`；基础输入类见 Global Constraints。
- `Label`：`React.ComponentPropsWithoutRef<'label'>`；类 `block text-sm font-medium text-gray-600 mb-2`。
- `Badge`：`{ tone?: 'gray' | 'blue' | 'green' | 'red'; children: React.ReactNode }`。
- `Progress`：`{ value: number; max: number; label?: string }`；`role="progressbar"` + `aria-valuenow/min/max`。
- `PageShell`：`React.ComponentPropsWithoutRef<'div'>`；类 `min-h-screen bg-[#f5f5f7] text-[#1d1d1f] font-sans`。
- `Dialog`：`{ open: boolean; onClose: () => void; title: string; children: React.ReactNode }`；遮罩 `bg-black/20`，卡片 `bg-white rounded-2xl shadow-sm w-full max-w-lg p-8`；Escape 关闭；打开时聚焦第一个可聚焦元素。
- `EmptyState`：`{ title: string; description?: string; action?: React.ReactNode }`。
- 图标：`CheckIcon`、`PlayIcon`、`SkipIcon`、`ClockIcon`、`CalendarIcon`、`SettingsIcon`、`ChevronRightIcon`，均为内联 SVG，`aria-hidden="true"`，`stroke="currentColor"`，`strokeWidth={1.5}`。
- npm scripts：`dev:web`（`vite --config vite.web.config.ts`）、`build:web`（`vite build --config vite.web.config.ts`）、`preview:web`（`vite preview --config vite.web.config.ts`）。

- [ ] **Step 1: 写失败测试**

```tsx
// tests/web/ui.test.tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { Badge } from '../../src/renderer/ui/Badge';
import { Button } from '../../src/renderer/ui/Button';
import { Card } from '../../src/renderer/ui/Card';
import { Input } from '../../src/renderer/ui/Input';
import { Progress } from '../../src/renderer/ui/Progress';

const forbidden = ['bg-gradient-to-r', 'bg-gradient-to-br', 'shadow-2xl', 'shadow-inner', 'border-2', 'border-4'];

function expectNoForbidden(element: HTMLElement) {
  for (const token of forbidden) expect(element.className).not.toContain(token);
}

test('primary button carries the Apple Style button tokens', () => {
  render(<Button>开始</Button>);
  const button = screen.getByRole('button', { name: '开始' });
  for (const token of ['rounded-full', 'font-medium', 'transition-all', 'duration-300', 'bg-[#0071e3]', 'text-white', 'active:scale-[0.98]', 'hover:opacity-80']) {
    expect(button.className).toContain(token);
  }
  expectNoForbidden(button);
});

test('card, input and progress use the required tokens', () => {
  render(
    <Card>
      <Input aria-label="模型名称" defaultValue="claude-sonnet-5-5" />
      <Progress value={1} max={2} label="今日进度" />
    </Card>
  );
  const card = screen.getByTestId('card');
  for (const token of ['bg-white', 'rounded-2xl', 'shadow-sm']) expect(card.className).toContain(token);
  expectNoForbidden(card);
  const input = screen.getByLabelText('模型名称');
  for (const token of ['bg-[#f5f5f7]', 'rounded-xl', 'text-[#1d1d1f]', 'focus:outline-none', 'focus:ring-2', 'focus:ring-[#0071e3]/30', 'transition-all']) {
    expect(input.className).toContain(token);
  }
  expectNoForbidden(input);
  const progress = screen.getByRole('progressbar', { name: '今日进度' });
  expect(progress).toHaveAttribute('aria-valuenow', '1');
  expect(progress).toHaveAttribute('aria-valuemax', '2');
});

test('badge variants stay inside the restrained palette', () => {
  render(<Badge tone="green">已完成</Badge>);
  const badge = screen.getByText('已完成');
  expect(badge.className).toContain('rounded-full');
  expect(badge.className).toContain('bg-[#34c759]/10');
  expect(badge.className).toContain('text-[#1d1d1f]');
  expectNoForbidden(badge);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/web/ui.test.tsx`
Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现 Tailwind 与组件**

安装依赖：

```bash
npm i -D tailwindcss @tailwindcss/vite
```

`electron.vite.config.ts` 的 renderer 加上 `tailwindcss()` 插件；`vite.web.config.ts`：

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  root: 'web',
  plugins: [react(), tailwindcss()],
  server: { fs: { allow: ['..'] } },
  build: { outDir: '../out/web', emptyOutDir: true }
});
```

`src/renderer/styles.css` 用 `@import "tailwindcss";`，并显式声明扫描范围（Vite root 是 `web/`，不显式声明会漏掉 `src/`）：

```css
@import "tailwindcss";
@source "../";
@source "../../web";

@theme {
  --font-sans: -apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
}

:root {
  color-scheme: light;
  font-family: var(--font-sans);
  -webkit-font-smoothing: antialiased;
}

body {
  margin: 0;
  background: #f5f5f7;
  color: #1d1d1f;
}
```

`web/index.html` 与 `web/main.tsx` 复制 renderer 的最小入口；`main.tsx` import `../src/renderer/styles.css` 并渲染 `<App />`。`web/main.tsx` 暂时不安装 mock；Task 2 再补。

组件实现要点：
- `Button` 的 `className` 用 `cn(base, variants[variant], sizes[size], className)`；`base` 包含所有必选 token、`inline-flex items-center justify-center gap-2`、`min-h-11`、`motion-reduce:transition-none`、`disabled:opacity-40 disabled:pointer-events-none`。
- `Card` 接受 `data-testid`，默认 `data-testid="card"` 仅在测试里传入；不要在组件里硬编码 testid。测试中显式 `<Card data-testid="card">`。
- `Input`/`Textarea`/`Select` 合并基础输入类；`Select` 额外 `appearance-none` 并用右侧 chevron 背景？不要额外装饰，保留原生 select 外观即可，但类一致。
- `Badge` 的 tone：gray `bg-[#f5f5f7] text-gray-600`；blue `bg-[#0071e3]/10 text-[#0071e3]`；green `bg-[#34c759]/10 text-[#1d1d1f]`；red `bg-[#ff3b30]/10 text-[#1d1d1f]`。文字始终深色，避免彩色底上的灰字。
- `Dialog` 用固定定位遮罩 + 卡片，不用原生 `<dialog>`（jsdom 的 `showModal` 不可靠）。打开时用 `useEffect` 聚焦容器内第一个 `input, textarea, select, button`；监听 `keydown` 的 Escape；关闭时恢复焦点到 `document.activeElement` 之前的元素。
- `icons.tsx` 每个图标接受 `className?: string`，默认 `h-5 w-5`。

`tsconfig.node.json` 的 `include` 加 `vite.web.config.ts`；`tsconfig.web.json` 的 `include` 加 `web/**/*`、`tests/web/**/*`。

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/web/ui.test.tsx && npm run typecheck && npm run build:web`
Expected: 全部 PASS；`out/web/index.html` 生成。

- [ ] **Step 5: 提交**

```bash
git add package.json package-lock.json electron.vite.config.ts vite.web.config.ts tsconfig.node.json tsconfig.web.json web src/renderer/styles.css src/renderer/ui tests/web/ui.test.tsx
git commit -m "feat: add apple style design system and web entry"
```

---

## Task 2: 共享 API、mock 数据、App 外壳与 Onboarding

**Files:**
- Create: `src/shared/ipc.ts`, `src/shared/profile.ts`, `src/renderer/global.d.ts`, `web/mock-api.ts`, `src/renderer/onboarding/Onboarding.tsx`, `src/renderer/ui/Nav.tsx`
- Modify: `web/main.tsx`, `src/renderer/App.tsx`, `src/renderer/styles.css`（如需要）
- Test: `tests/shared/profile.test.ts`, `tests/web/mock-api.test.ts`, `tests/renderer/onboarding.test.tsx`

**Interfaces:**
- `Bootstrap { needsOnboarding: boolean; today: string; hasApiKey: boolean }`
- `UpdateTaskInput { taskId: string; status: TaskStatus; actualMin?: number }`
- `StudyCoachApi`：`getBootstrap()`、`completeOnboarding(profile)`、`getSettings()`、`updateSettings(patch)`、`setApiKey(key)`、`getTodayPlan()`、`generateTodayPlan()`、`updateTask(input)`、`submitReview(input)`（完整签名见下）。
- `validateExamProfile(input: unknown): ExamProfile`：zod；错误 message 包含字段路径（`dailyMinutes`、`subjects` 等）。
- `createMockApi(storage?: Storage): StudyCoachApi`；`DEMO_PROFILE: ExamProfile`；`DEMO_PLAN: () => DailyPlan`。
- `Onboarding({ onComplete }: { onComplete?: () => void })`。
- `Nav({ view, onChange }: { view: 'today' | 'settings'; onChange: (view: 'today' | 'settings') => void })`。

`src/shared/ipc.ts`：

```ts
import type { AppSettings, DailyPlan, ExamProfile, ReviewAnswers, TaskStatus } from './types';

export interface Bootstrap { needsOnboarding: boolean; today: string; hasApiKey: boolean; }
export interface UpdateTaskInput { taskId: string; status: TaskStatus; actualMin?: number; }

export interface StudyCoachApi {
  getBootstrap(): Promise<Bootstrap>;
  completeOnboarding(profile: ExamProfile): Promise<void>;
  getSettings(): Promise<AppSettings>;
  updateSettings(patch: Partial<AppSettings>): Promise<AppSettings>;
  setApiKey(key: string): Promise<void>;
  getTodayPlan(): Promise<DailyPlan | null>;
  generateTodayPlan(): Promise<DailyPlan>;
  updateTask(input: UpdateTaskInput): Promise<DailyPlan>;
  submitReview(input: { date: string; answers: ReviewAnswers }): Promise<void>;
}
```

`src/renderer/global.d.ts`：

```ts
import type { StudyCoachApi } from '../shared/ipc';

declare global {
  interface Window {
    studyCoach?: StudyCoachApi;
    studyCoachPrototype?: { reset(): void };
  }
}
export {};
```

- [ ] **Step 1: 写失败测试**

```ts
// tests/shared/profile.test.ts
import { validateExamProfile } from '../../src/shared/profile';

const valid = {
  examDate: '2027-12-18',
  subjects: [{ name: '数学' }, { name: '英语' }],
  dailyMinutes: 300,
  currentLevel: '基础一般'
};

test('accepts a valid profile', () => {
  expect(validateExamProfile(valid)).toEqual(valid);
});

test('reports field paths for invalid input', () => {
  expect(() => validateExamProfile({ ...valid, dailyMinutes: 10 })).toThrow(/dailyMinutes/);
  expect(() => validateExamProfile({ ...valid, subjects: [] })).toThrow(/subjects/);
  expect(() => validateExamProfile({ ...valid, examDate: '2027/12/18' })).toThrow(/examDate/);
});
```

```ts
// tests/web/mock-api.test.ts
import { createMockApi, DEMO_PROFILE } from '../../web/mock-api';

test('starts in onboarding and completes it with a demo plan', async () => {
  localStorage.clear();
  const api = createMockApi(localStorage);
  expect((await api.getBootstrap()).needsOnboarding).toBe(true);
  await api.completeOnboarding(DEMO_PROFILE);
  const bootstrap = await api.getBootstrap();
  expect(bootstrap.needsOnboarding).toBe(false);
  const plan = await api.getTodayPlan();
  expect(plan?.tasks.length).toBeGreaterThan(0);
});

test('updates a task and keeps settings', async () => {
  localStorage.clear();
  const api = createMockApi(localStorage);
  await api.completeOnboarding(DEMO_PROFILE);
  const plan = await api.getTodayPlan();
  const updated = await api.updateTask({ taskId: plan!.tasks[0].id, status: 'done' });
  expect(updated.tasks.find((t) => t.id === plan!.tasks[0].id)?.status).toBe('done');
  const settings = await api.getSettings();
  expect(settings.budget.proactiveSessionsPerDay).toBe(4);
});
```

```tsx
// tests/renderer/onboarding.test.tsx
// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Onboarding } from '../../src/renderer/onboarding/Onboarding';

test('submits a valid exam profile', async () => {
  const complete = vi.fn().mockResolvedValue(undefined);
  window.studyCoach = { completeOnboarding: complete } as never;
  render(<Onboarding />);
  fireEvent.change(screen.getByLabelText('考试日期'), { target: { value: '2027-12-18' } });
  await userEvent.type(screen.getByLabelText('考试科目（逗号分隔）'), '数学一,英语一,政治');
  await userEvent.clear(screen.getByLabelText('每天可用分钟数'));
  await userEvent.type(screen.getByLabelText('每天可用分钟数'), '300');
  await userEvent.click(screen.getByRole('button', { name: '生成我的学习计划' }));
  expect(complete).toHaveBeenCalledWith(expect.objectContaining({ dailyMinutes: 300, examDate: '2027-12-18' }));
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/shared/profile.test.ts tests/web/mock-api.test.ts tests/renderer/onboarding.test.tsx`
Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现**

`validateExamProfile` 用 zod；中文错误消息：
- `examDate`：`/^\d{4}-\d{2}-\d{2}$/`，message `请选择有效的考试日期`
- `subjects`：至少 1 项，message `至少选择一门考试科目`
- `dailyMinutes`：整数 30–720，message `每天可用分钟数需在 30–720 之间`
- `currentLevel`：非空，message `请选择当前水平`
- 校验失败抛 `Error`，message 为 `issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')`。

`web/mock-api.ts`：
- 存储键 `study-coach:prototype:v1`；状态 `{ profile, settings, plan, reviews }`。
- `settings` 默认：`vaultPath: '浏览器原型（内存）'`、`provider: { kind: 'anthropic', model: 'claude-sonnet-5-5' }`、`notifications: { enabled: true, morning: '08:00', evening: '21:30', dndStart: '23:00', dndEnd: '07:30' }`、`budget: { proactiveSessionsPerDay: 4, dailyTokens: 200000 }`、`launchAtLogin: false`。
- `apiKey` 用闭包变量，**不写入 storage**；`hasApiKey` 返回 `apiKey !== null`。
- `completeOnboarding`：`validateExamProfile` → 存 profile → 若没有今日计划则写入 `DEMO_PLAN()`。
- `generateTodayPlan`：写入并返回 `DEMO_PLAN()`（`generatedBy: 'agent'`）。
- `updateTask`：找 task，更新 `status`/`actualMin`，持久化，返回 plan。
- `submitReview`：写入 `reviews[date]`，持久化。
- `createMockApi` 每次从 storage 读取；没有 storage 时用内存对象。
- `DEMO_PROFILE`：`examDate: '2027-12-18'`、`subjects: [{name:'数学'}, {name:'英语'}, {name:'政治'}]`、`dailyMinutes: 300`、`currentLevel: '基础一般'`、`targetSchool: '示例大学'`、`targetMajor: '计算机'`。
- `DEMO_PLAN`：3 个任务（数学 45 分钟、英语 30 分钟、政治 30 分钟），`id: 't1' | 't2' | 't3'`，`status: 'pending'`。
- `web/main.tsx`：若 `!window.studyCoach`，`window.studyCoach = createMockApi(window.localStorage)`；`window.studyCoachPrototype = { reset: () => { localStorage.removeItem(KEY); location.reload(); } }`。

`Onboarding`：
- 浅灰背景，`PageShell`；主容器 `max-w-[980px] mx-auto px-6 md:px-8 py-20 md:py-32`。
- 页面顶部左侧放 `Study Coach` 品牌字标（`span`，`text-xl font-semibold tracking-tight text-black`），与主容器同宽；不要做成小号大写 eyebrow 标签。
- 居中的 `<h2>` `text-4xl md:text-5xl lg:text-6xl font-semibold tracking-tight text-black`，文案 `把考研，变成每天的下一步。`；副标题 `text-base md:text-lg text-gray-600 max-w-xl mx-auto`，文案 `告诉我你的目标，Study Coach 会安排每天的任务，你只需要执行。`
- 表单卡片 `Card className="mt-12 md:mt-16 max-w-2xl mx-auto p-8 md:p-12"`。
- 字段：考试日期（date，默认 `2027-12-18`）、目标院校（可选）、目标专业（可选）、考试科目（逗号分隔）、每天可用分钟数（number，默认 300）、当前水平（select：基础薄弱/基础一般/基础较好，默认基础一般）。
- 标签文本必须精确包含：`考试日期`、`考试科目（逗号分隔）`、`每天可用分钟数`。
- 提交按钮 `生成我的学习计划`（primary）；次按钮 `先看看示例`（ghost，type=button）用 `DEMO_PROFILE` 调 `completeOnboarding`，成功后 `onComplete?.()`。
- 提交时把科目字符串按 `/[,，、]/` 分割、trim、过滤空值，映射为 `{ name }`；调 `validateExamProfile`；失败显示红色 `text-[#ff3b30]` 错误块；成功后调 `completeOnboarding` 再 `onComplete?.()`。
- 表单错误用 `role="alert"`。

`App`：
- 始终渲染 `<h1 className="sr-only">Study Coach</h1>`（保留 Task 1 测试）。
- 挂载时调 `window.studyCoach?.getBootstrap()`；不存在或失败时退化为 `{ needsOnboarding: true, today: formatLocalDate(new Date()), hasApiKey: false }`。
- `bootstrap === null` 时显示 `PageShell` + `正在准备…`。
- `needsOnboarding` 时渲染 `<Onboarding onComplete={refresh} />`。
- 否则渲染 `PageShell` + `Nav` + 主区域；主区域暂时显示占位卡 `今日计划即将到来。`（Task 3 替换）。
- `view` 状态：`'today' | 'settings'`，默认 `'today'`；Task 2 的 `Nav` 只渲染“今日”，Task 4 再加“设置”。

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/shared/profile.test.ts tests/web/mock-api.test.ts tests/renderer/onboarding.test.tsx tests/renderer/App.test.tsx && npm run typecheck`
Expected: 全部 PASS。

- [ ] **Step 5: 提交**

```bash
git add src/shared/ipc.ts src/shared/profile.ts src/renderer/global.d.ts web src/renderer/App.tsx src/renderer/onboarding src/renderer/ui/Nav.tsx tests/shared/profile.test.ts tests/web/mock-api.test.ts tests/renderer/onboarding.test.tsx
git commit -m "feat: add web mock api and apple style onboarding"
```

---

## Task 3: 今日页、计时器与晚间复盘

**Files:**
- Create: `src/renderer/today/TodayPage.tsx`, `src/renderer/today/TaskCard.tsx`, `src/renderer/today/Timer.tsx`, `src/renderer/today/timer-logic.ts`, `src/renderer/review/ReviewDialog.tsx`
- Modify: `src/renderer/App.tsx`
- Test: `tests/renderer/today.test.tsx`, `tests/renderer/timer.test.ts`, `tests/renderer/review.test.tsx`

**Interfaces:**
- `TodayPage({ hasApiKey?: boolean; onOpenSettings?: () => void })`；`hasApiKey` 默认 `true`。
- `TaskCard({ task, onUpdate }: { task: StudyTask; onUpdate: (input: UpdateTaskInput) => Promise<void> })`。
- `Timer({ startedAt, onFinish }: { startedAt: Date; onFinish: (minutes: number) => void })`。
- `elapsedMinutes(start: Date, end: Date): number`。
- `ReviewDialog({ date, onClose }: { date: string; onClose: () => void })`。

- [ ] **Step 1: 写失败测试**

```tsx
// tests/renderer/today.test.tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TodayPage } from '../../src/renderer/today/TodayPage';

const plan = {
  date: '2026-10-31', generatedBy: 'agent' as const,
  tasks: [
    { id: 't1', title: '极限与连续', subject: '数学', durationMin: 45, materialRefs: [], acceptance: '完成 10 题', status: 'pending' as const },
    { id: 't2', title: '阅读理解', subject: '英语', durationMin: 30, materialRefs: [], acceptance: '精读 1 篇', status: 'pending' as const }
  ]
};

test('renders tasks and completes one', async () => {
  const updateTask = vi.fn().mockResolvedValue({ ...plan, tasks: [{ ...plan.tasks[0], status: 'done' }, plan.tasks[1]] });
  window.studyCoach = { getTodayPlan: vi.fn().mockResolvedValue(plan), updateTask } as never;
  render(<TodayPage />);
  expect(await screen.findByText('极限与连续')).toBeInTheDocument();
  expect(screen.getByText('完成 10 题')).toBeInTheDocument();
  await userEvent.click(screen.getAllByRole('button', { name: '完成' })[0]);
  expect(updateTask).toHaveBeenCalledWith({ taskId: 't1', status: 'done' });
  expect(await screen.findByText('1 / 2 完成')).toBeInTheDocument();
});

test('shows a generate button when there is no plan', async () => {
  const generate = vi.fn().mockResolvedValue(plan);
  window.studyCoach = { getTodayPlan: vi.fn().mockResolvedValue(null), generateTodayPlan: generate } as never;
  render(<TodayPage />);
  await userEvent.click(await screen.findByRole('button', { name: '生成今日计划' }));
  expect(generate).toHaveBeenCalled();
});
```

```ts
// tests/renderer/timer.test.ts
import { elapsedMinutes } from '../../src/renderer/today/timer-logic';

test('counts whole minutes and never goes negative', () => {
  expect(elapsedMinutes(new Date('2026-10-31T10:00:00'), new Date('2026-10-31T10:25:30'))).toBe(25);
  expect(elapsedMinutes(new Date('2026-10-31T10:10:00'), new Date('2026-10-31T10:00:00'))).toBe(0);
});
```

```tsx
// tests/renderer/review.test.tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReviewDialog } from '../../src/renderer/review/ReviewDialog';
import { TodayPage } from '../../src/renderer/today/TodayPage';

test('submits review answers', async () => {
  const submit = vi.fn().mockResolvedValue(undefined);
  window.studyCoach = { submitReview: submit } as never;
  render(<ReviewDialog date="2026-10-31" onClose={() => {}} />);
  await userEvent.type(screen.getByLabelText('今天完成了什么？'), '数学');
  await userEvent.type(screen.getByLabelText('卡在哪里？'), '极限');
  await userEvent.type(screen.getByLabelText('明天想怎么调整？'), '先复习');
  await userEvent.click(screen.getByRole('button', { name: '保存复盘' }));
  expect(submit).toHaveBeenCalledWith({ date: '2026-10-31', answers: { completed: '数学', stuck: '极限', tomorrow: '先复习' } });
});

test('opens the review dialog from the today page', async () => {
  window.studyCoach = {
    getTodayPlan: vi.fn().mockResolvedValue({ date: '2026-10-31', generatedBy: 'template', tasks: [] }),
    submitReview: vi.fn()
  } as never;
  render(<TodayPage />);
  await userEvent.click(await screen.findByRole('button', { name: '复盘' }));
  expect(screen.getByLabelText('今天完成了什么？')).toBeInTheDocument();
});

test('focuses the first field and closes on escape', async () => {
  const onClose = vi.fn();
  render(<ReviewDialog date="2026-10-31" onClose={onClose} />);
  expect(screen.getByLabelText('今天完成了什么？')).toHaveFocus();
  await userEvent.keyboard('{Escape}');
  expect(onClose).toHaveBeenCalled();
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/renderer/today.test.tsx tests/renderer/timer.test.ts tests/renderer/review.test.tsx`
Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现**

`TodayPage`：
- 挂载时 `getTodayPlan`；失败显示错误块 + 重试按钮。
- 顶部：日期（`formatLocalDate` 从 `src/shared/date` 或 plan.date 格式化），`<h2>` `今天，按计划走就好。`；右侧 `复盘` primary 按钮。
- `!hasApiKey` 时显示一张 `Card`：`未配置模型，当前使用模板计划。` + `去设置` 链接按钮（调用 `onOpenSettings`）。
- 有任务：主栏任务卡列表（`grid gap-8 md:grid-cols-[1fr_280px]`，侧栏 sticky 进度卡）。进度卡显示 `X / Y 完成`、Progress、总分钟数。
- 无计划：`EmptyState` 标题 `今天还没有计划`，按钮 `生成今日计划`。
- 计划存在但 `tasks` 为空：仍显示头部和 `复盘` 按钮，主区域显示空状态 `今天没有安排任务`。
- `updateTask` 成功后用返回值替换 plan；失败显示错误。

`TaskCard`：
- 卡片 `Card`，`p-8`。
- 顶部 Badge（subject）+ 建议时长；标题 `text-xl md:text-2xl font-semibold tracking-tight text-black`；验收标准 `text-gray-600`。
- pending：`开始`（secondary）、`完成`（primary）、`跳过`（ghost）；`完成` 按钮调 `onUpdate({ taskId, status: 'done' })`。
- in-progress：显示 `Timer` + `完成`（primary，带 actualMin）+ `跳过`（ghost）。
- done：Badge `已完成`（green）+ 标题 `line-through text-gray-500`；skipped：Badge `已跳过`（gray）。
- 按钮容器 `flex flex-wrap gap-2`，窄屏不溢出。

`Timer`：
- `useEffect` 每秒更新 `now`；显示 `已计时 X 分钟`；按钮 `结束并完成`；卸载清理 interval。
- `elapsedMinutes`：`Math.max(0, Math.floor((end.getTime() - start.getTime()) / 60000))`。

`ReviewDialog`：
- 用 Task 1 的 `Dialog`，标题 `晚间复盘`，副标题日期。
- 三个 textarea，标签精确：`今天完成了什么？`、`卡在哪里？`、`明天想怎么调整？`。
- `保存复盘` primary；`跳过` ghost；`取消` ghost。
- 保存：`submitReview({ date, answers: { completed, stuck, tomorrow } })`；成功 `onClose()`；失败红色错误。
- 跳过：`submitReview({ date, answers: { skipped: true, completed: '', stuck: '', tomorrow: '' } })` 后 `onClose()`。
- 打开时焦点进入第一个 textarea；Escape 关闭；`role="dialog" aria-modal="true" aria-labelledby`。

`App`：
- 把占位主区域替换为 `<TodayPage hasApiKey={bootstrap.hasApiKey} onOpenSettings={() => setView('settings')} />`。
- `view === 'settings'` 时暂时显示占位卡 `设置页即将到来。`；Task 4 替换。
- `Nav` 同时显示“今日”和“设置”。

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/renderer/today.test.tsx tests/renderer/timer.test.ts tests/renderer/review.test.tsx && npm run typecheck`
Expected: 全部 PASS。

- [ ] **Step 5: 提交**

```bash
git add src/renderer/today src/renderer/review src/renderer/App.tsx src/renderer/ui/Nav.tsx tests/renderer/today.test.tsx tests/renderer/timer.test.ts tests/renderer/review.test.tsx
git commit -m "feat: add today page timer and evening review"
```

---

## Task 4: 设置页、应用导航、README 与视觉验收

**Files:**
- Create: `src/renderer/settings/SettingsPage.tsx`
- Modify: `src/renderer/App.tsx`, `README.md`
- Test: `tests/renderer/settings.test.tsx`

**Interfaces:**
- `SettingsPage({ onClose }: { onClose: () => void })`。
- 使用 `StudyCoachApi` 的 `getSettings`、`updateSettings`、`setApiKey`。

- [ ] **Step 1: 写失败测试**

```tsx
// tests/renderer/settings.test.tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SettingsPage } from '../../src/renderer/settings/SettingsPage';

const settings = {
  vaultPath: '/tmp/vault',
  provider: { kind: 'anthropic' as const, model: 'claude-sonnet-5-5' },
  notifications: { enabled: true, morning: '08:00', evening: '21:30', dndStart: '23:00', dndEnd: '07:30' },
  budget: { proactiveSessionsPerDay: 4, dailyTokens: 200000 },
  launchAtLogin: true
};

test('saves provider model and api key without echoing the key', async () => {
  const update = vi.fn().mockResolvedValue(settings);
  const setKey = vi.fn().mockResolvedValue(undefined);
  window.studyCoach = {
    getSettings: vi.fn().mockResolvedValue(settings),
    updateSettings: update,
    setApiKey: setKey
  } as never;
  render(<SettingsPage onClose={() => {}} />);
  expect(await screen.findByLabelText('模型名称')).toHaveValue('claude-sonnet-5-5');
  await userEvent.clear(screen.getByLabelText('模型名称'));
  await userEvent.type(screen.getByLabelText('模型名称'), 'claude-opus-5-5');
  await userEvent.type(screen.getByLabelText('API Key'), 'sk-test');
  await userEvent.click(screen.getByRole('button', { name: '保存设置' }));
  expect(update).toHaveBeenCalledWith(expect.objectContaining({ provider: expect.objectContaining({ model: 'claude-opus-5-5' }) }));
  expect(setKey).toHaveBeenCalledWith('sk-test');
  expect(screen.getByLabelText('API Key')).toHaveValue('');
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/renderer/settings.test.tsx`
Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现**

`SettingsPage`：
- 挂载时 `getSettings`；加载中显示 `PageShell` + `正在加载设置…`；失败显示错误 + 重试。
- 页面标题 `<h2>` `设置`，副标题 `管理模型、预算与提醒。`。
- 卡片分组（每张 `Card`，不要嵌套卡片）：
  1. 模型：提供商 select（Anthropic / OpenAI 兼容 / Ollama）、模型名称、Base URL（仅 openai-compatible/ollama 显示，Ollama 默认 `http://127.0.0.1:11434/v1`）、API Key（password，占位符 `已保存则留空`）、说明文字 `原型模式下，API Key 只保存在当前页面内存，不会写入浏览器存储或发送到服务器。`
  2. 预算：每日主动会话次数（number）、每日 token 上限（number）。
  3. 通知：启用提醒 checkbox、早间时间、晚间时间、免打扰开始/结束（time）。
  4. 启动：开机自启 checkbox。
- 标签精确：`模型名称`、`API Key`、`每日主动会话次数`、`每日 token 上限`、`早间时间`、`晚间时间`、`免打扰开始`、`免打扰结束`、`开机自启`。
- `保存设置` primary；保存时先 `updateSettings({ provider, budget, notifications, launchAtLogin })`，若 API Key 非空再 `setApiKey(key)`；成功后清空 key、`role="status"` 显示 `已保存`。
- 若 `window.studyCoachPrototype` 存在，底部显示 `清除原型数据并重新开始`（ghost/danger），点击 `confirm` 后调用 `reset()`。
- `App`：`view === 'settings'` 时渲染 `<SettingsPage onClose={() => { setView('today'); void refresh(); }} />`；`Nav` 的“设置”按钮可切换。
- `README.md` 增加“Web 原型”段落：`npm run dev:web` 打开 `http://localhost:5173`；说明 mock 数据、API Key 仅内存、与 Electron 共用 renderer。

- [ ] **Step 4: 运行测试、构建与视觉验收**

Run: `npx vitest run tests/renderer/settings.test.tsx && npm run typecheck && npm test && npm run build:web`
Expected: 全部 PASS；`out/web/index.html` 生成。

启动 `npm run dev:web`，在浏览器检查：
- 375px / 768px / 1280px 无横向滚动。
- Onboarding → 先看看示例 → 今日页 → 完成一个任务 → 复盘 → 设置，全流程可点击。
- 所有按钮有圆角、hover/active/focus 状态；正文对比度足够；无渐变、无重阴影、无嵌套卡片。
- 设置页保存后 API Key 输入为空。
- 浏览器控制台无 React 警告或未捕获错误。

- [ ] **Step 5: 提交**

```bash
git add src/renderer/settings src/renderer/App.tsx README.md tests/renderer/settings.test.tsx
git commit -m "feat: add settings page and web prototype polish"
```

---

## Self-Review

**Spec coverage:**
- Onboarding（原 M1 Task 7）→ Task 2。
- 今日计划与任务状态（原 M1 Task 10）→ Task 3。
- 晚间复盘（原 M1 Task 11）→ Task 3。
- 设置（原 M1 Task 8.5）→ Task 4。
- Apple Style（三份设计文件）→ Task 1 的令牌、组件与 Task 2–Task 4 的页面。
- 本地优先/无网络 → mock API 不发请求；API Key 仅内存。

**Type consistency:** `StudyCoachApi` 的九个方法与 Task 2 mock、Task 3/Task 4 组件调用一致；`UpdateTaskInput` 与 `updateTask` 一致；`Bootstrap` 与 App 一致；`ExamProfile`/`AppSettings`/`DailyPlan`/`ReviewAnswers` 复用 Task 2 已实现的 `src/shared/types.ts`。

**Review Focus 对应测试:** 对比度/样式禁令 → Task 1 `ui.test.tsx`；焦点/Escape → Task 3 `review.test.tsx` 与 Dialog 实现；API Key 不回显 → Task 4 `settings.test.tsx`；响应式 → Task 4 人工检查；任务按钮换行 → Task 3 组件类 `flex-wrap`。

**已知后续工作:** 真实 Electron IPC、vault、模型调用、调度器、托盘仍按原 M1 计划执行；Task 1–Task 4 的组件和 `StudyCoachApi` 将直接复用，不重写。
