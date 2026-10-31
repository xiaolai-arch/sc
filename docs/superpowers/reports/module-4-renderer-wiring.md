# Module 4 — renderer-wiring report

## Scope delivered

- Added `useWorkspaceData` (`src/renderer/shell/useWorkspaceData.ts`), which loads and mutates data only through `window.studyCoach`: `listWorkspaces`, `getWorkspaceSnapshot`, `createTask`, `updateWorkspaceTask`, `createNote`, `updateNote`, `getMemory`, `getReminders`, and `send`.
- `Workspace.tsx` no longer imports `demoData`; it renders from the hook, keeps all six surfaces (管家 / 计划 / 记录 / 学习 / 复盘 / 设置), and keeps the three-pane Apple-style shell.
- Added loading, load-error, action-error, and retry states.
- Added UI for creating tasks (计划 pane) and creating notes (记录 pane); both go through the API and update the rendered data.
- Wired the butler composer to `send`; the returned text is rendered as the assistant message.
- Extended `web/mock-api.ts` to implement the new workspace API using the existing `demoData` as seed. It now seeds workspaces/tasks/notes/memory/reminders, supports task/note creation and updates, persists to localStorage, and returns canned butler replies (including creating a note for “记一下…” messages).
- Added `noteBody.ts` to render the contract’s markdown-ish note body (paragraphs, `##` headings, bullet lists) without bringing demo-only block types into the shared contract.

## Commits

- `1e510d9` feat: add workspace data hook and browser mock API
- `c10cf48` feat: wire workspace surfaces to the data API

## Verification

### Targeted tests

```text
npx vitest run tests/renderer/workspace*.test.tsx tests/web/mock-api.test.ts

 Test Files  2 passed (2)
      Tests  19 passed (19)
```

Coverage added: switching workspace from API snapshots, creating a task, creating a note, sending a butler message through the mock API, load-error retry, mock workspace/snapshot seeding, task create/update, note create/update persistence, and canned chat replies.

### Typecheck and browser build

```text
npm run typecheck && npm run build:web

> tsc --noEmit -p tsconfig.node.json && tsc --noEmit -p tsconfig.web.json
> vite build --config vite.web.config.mts

✓ 143 modules transformed.
out/web/index.html                   0.39 kB │ gzip:   0.26 kB
out/web/assets/index-CkRTqeFQ.css   25.42 kB │ gzip:   5.56 kB
out/web/assets/index-CHbruiF_.js   401.51 kB │ gzip: 118.26 kB
✓ built in 162ms
```

### Full suite

```text
npm test

 Test Files  13 passed (13)
      Tests  60 passed (60)
```

The existing 6 workspace tests and the App integration test remain green. A browser smoke check of the web prototype (onboarding → 管家 → 计划 → 记录) also rendered correctly with the new forms.

## Risks / follow-ups

- `useWorkspaceData` loads every workspace snapshot on mount and reloads after every butler send so tool side effects are visible. That is fine for a local vault of this size, but a large vault may want per-workspace lazy loading.
- Practice sets and the review streak remain demo-only because the shared contract has no API for them. They are still imported as presentation-only content by the hook.
- Creating a task while “全部工作区” is selected writes to the first workspace (`kaoyan`). A future pass could add an explicit workspace picker in the form.
- Note creation is exposed in the UI; `updateNote` is wired in the hook but has no editor UI yet (not required by this module).
- The note reader supports paragraphs, `##` headings, and bullet lists. Other markdown constructs fall back to plain paragraphs.
- The mock persists workspace data under the existing `study-coach:prototype:v1` key without a version bump; older stored states are merged with seeded workspace data.
- Real butler note-taking must use the agent’s `write_note` tool for “记一下…” messages; the mock implements that side effect inside `send` so the prototype flow stays intact.
