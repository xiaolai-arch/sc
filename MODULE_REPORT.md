# Module 3 — practice-service

**Base:** `feat/v1-completion` @ `1071b13`
**Scope:** `src/main/practice/**`, `src/shared/practice.ts`, `tests/main/practice-*.test.ts`
**Status:** complete — targeted tests, full `npm test` and `npm run typecheck` are green.

## What was implemented

Vault-backed `PracticeService` (`createPracticeService(root, { now? })`) with the
requested API plus two convenience methods:

| Method | Behaviour |
| --- | --- |
| `listSets(workspaceId)` | Sets under `workspaces/<id>/practice/sets/*.md`, sorted by title. |
| `getSet(id)` | One set, or `null` when missing. |
| `createSet(input)` | Validates questions/options/answer range/unique ids and persists a new set. |
| `submitAnswer({ questionId, choice })` | Scores the answer, appends an attempt, creates/updates the mistake record, returns answer + explanation + attempt + mistake. |
| `getMistakes(workspaceId)` | Active mistakes, highest priority then earliest due. |
| `getDue(workspaceId, date)` | Active mistakes with `due <= date`. |
| `listAttempts(workspaceId)` | Persisted attempt history, oldest first. |

### Vault layout (Obsidian-readable)

```
workspaces/<id>/practice/
  sets/<setId>.md            # type: qa, kind: practice-set, questions[] in frontmatter
  attempts/YYYY-MM-DD.md     # type: log, kind: practice-attempts, entries[]
  mistakes.md                # type: qa, kind: practice-mistakes, entries[]
```

Frontmatter is the machine-readable source of truth; every file also renders a
human-friendly markdown body (question options + answer/解析, attempt log, 错题本).
Reads always hit disk, so Obsidian edits and fresh service instances see the
latest state. Writes use the existing `createMutex` + temp-file/atomic-rename
helpers.

### Spaced repetition

- Wrong answer: mistake enters/updates 错题本; `wrongCount` increments and the
  interval advances `1 → 3 → 7 → 7` days; `due = answered date + interval`;
  `priority = min(3, priority + 1)`; correct streak resets.
- Correct answer with an existing mistake: priority decreases by 1 and
  `correctStreak` increments; two consecutive correct answers mark the mistake
  `resolved` (history retained, excluded from `getMistakes`/`getDue`).
- Correct answer without a mistake creates no mistake record.
- Clock is injectable (`now`) so due-date behaviour is deterministic in tests.

### Seed data

`src/main/practice/seed.ts` mirrors the renderer prototype's 考研/英语 demo sets
(极限基础, 马原易错, 长难句) with answers and explanations. No network or model
call is involved. Seeds are written only when the workspace directory already
exists and its `practice/sets/` directory is absent, so WorkspaceService remains
the owner of vault/workspace creation and user edits/deletions are not recreated.

### Path safety

`workspaceId`, `setId` and `questionId` go through `assertSafeSegment`; `date`
through `assertIsoDate`. Tests cover `../`, absolute-ish traversal, dots,
whitespace and backslashes for every entry point, and confirm written files stay
under `workspaces/<id>/practice/`.

## Commits

| Commit | Summary |
| --- | --- |
| `99e9dcf` | `feat(practice): add vault-backed practice service` |
| `3513aa1` | `test(practice): cover scoring, spaced repetition, persistence and path safety` |
| _(docs)_ | `docs(practice): add module report` |

## Verification

```text
npx vitest run tests/main/practice-service.test.ts tests/main/practice-security.test.ts
  Test Files  2 passed (2)
  Tests       18 passed (18)

npm test
  Test Files  33 passed (33)
  Tests       199 passed (199)

npm run typecheck
  tsc --noEmit -p tsconfig.node.json && tsc --noEmit -p tsconfig.web.json   (pass)
```

`npm install` was required in the worktree (no `node_modules` initially);
`package.json` / `package-lock.json` were unchanged.

## Risks / notes for Wave 2

- Not wired to `StudyCoachApi`, IPC, context or the renderer — per module
  constraints this is Wave 2's job. The service is instantiated with just the
  vault root and an optional clock.
- `submitAnswer` resolves a question id by scanning all workspaces. Question ids
  are therefore expected to be unique across the vault (seed ids are; `createSet`
  enforces uniqueness only within a set). If ids later need to be globally
  guaranteed, pass `workspaceId`/`setId` through IPC and use them directly.
- Mistake priority/scheduling semantics (priority 0–3, resolve after 2 correct)
  are documented on `PracticeMistake`; adjust thresholds here if the product
  wants a different review cadence.
- Due dates use the local calendar (`formatLocalDate`), matching the rest of the
  app's task/review dates rather than UTC dates.
