# fix-promise-tag — remove the false 「不会主动问你」 badge

Branch: `xiaolai/fix-promise-tag` off master `ebfd0fd`.
Date written: 2026-11-28 (report path fixed by the brief).

## What was wrong

On 2026-11-22 the owner decided 「承诺跟人走，不跟项目走」 and iter39 deleted the
off-project filter from `readDueCommitment` (`src/main/context.ts:682-690` now has
no off filtering). A promise made inside a check-in-disabled project **is** asked
about at the morning check-in.

One UI string still claimed the opposite: the badge 「不会主动问你」 on an
off-project promise row, plus a test that pinned it.

## What changed (file:line)

### `src/renderer/shell/ProjectSections.tsx`

- Deleted the badge span (was `:1827-1831`), the `off` variable (was `:1816`) and
  the `checkInOff` set (was `:1714-1716`). The row now renders text → 原定/已过期 →
  the three actions, with nothing between.
- Removed `workspaces: Workspace[]` from `CommitmentsSectionProps` (`:1686`) and
  from the `CommitmentsSection` destructure (`:1701`). Grep confirmed the prop was
  used **only** to build `checkInOff`; there was no second use, so it is gone.
- `Workspace` is still imported by the file for other components (TasksPanel,
  NotesPanel, memory panel, etc.), so the import stays.
- Rewrote the component docstring (`:1694-1699`): the old tag rationale
  ("tagged so the user is not left wondering why it was never asked about") is
  gone; it now says a promise follows the person, not the project, and is listed
  and asked about the same way regardless of the project's check-in state.

### `src/renderer/shell/RemindersPage.tsx`

- Dropped `workspaces: Workspace[]` from `RemindersPageProps` (`:12`), from the
  destructure (`:28`) and from the `CommitmentsSection` render site (`:57`);
  dropped the now-unused `Workspace` type import. `workspaces` had no other use
  on this page.

### `src/renderer/shell/Workspace.tsx`

- Dropped `workspaces={workspaces}` from the `<RemindersPage>` call (`:2017`).

### `tests/renderer/reminders-commitments.test.tsx`

- Removed the `Workspace` import and the `workspaceOn` / `workspaceOff` fixtures;
  removed `workspaces` from the shared `base` props.
- Renamed and rewrote the test to pin the **new** truth:
  - old: `a promise of a check-in-off project is tagged 不会主动问你`
  - new: `a promise of a check-in-off project carries no special tag` (`:147`)
  - Asserts `queryByText('不会主动问你')` is null for **both** an off-project
    promise and a promise with no workspace, rendered in one tree; and that each
    row keeps its `原定 11-23` line plus all three actions (改期 / 放下 / 完成).
  - The old "tag is present" assertion is gone entirely.

No `web/mock-api` fixture passed `workspaces` to `CommitmentsSection`; no other
render site or test exists (grep of `CommitmentsSection` returns only the
component, `RemindersPage.tsx` and this one test).

## Remove vs reword — why "remove"

I implemented **remove**. A reworded badge (e.g. 「项目检查已关闭」) would import
project state onto a promise row where it no longer has any effect on whether the
promise is asked about, implying a relevance that does not exist. The component's
own docstring gave the badge's whole purpose — "so the user is not left wondering
why it was never asked about" — and that reason died with iter39: the check-in now
does ask. The project's check-in state already has its truthful home on the project
page.

## Survey — promises × project-off semantics (list only, nothing else changed)

1. **`src/main/butler/prompt.ts:46`** —「第二天晨检会问一次；用户答「做了」时用
   resolve_commitment…」and **`src/main/butler/tools.ts:929`** —「到期后晨检只问一次」。
   Post-iter39 these are true for off projects too (the promise line at
   `check-ins/prompt.ts:79-95` / `:550` is built from `getDueCommitment`, which no
   longer filters). **Agree: no change needed.** Both sentences describe promise
   timing, not project scope.

2. **Notification center** — `src/shared/notifications.ts:137-151` lists every open
   due promise regardless of `workspaceId`; `NotificationCenter.tsx` copy is
   「答应了…·回对话里回应」/「答应今天做到」. No check-in/project claim.
   **Confirmed clean.**

3. **Weekly review** — `context.ts:589-667` `readWeeklyHonest` filters **tasks /
   attempts / mistakes** by `checkIn !== 'off'` (`:591`), but the accountability
   promise clause is built from `commitments.list()` **unfiltered** (`:644`) and
   `weekly-honest.ts:156-181` emits a generic 「你说过要做「…」…」 line with no
   project/check-in claim. So the weekly review already treats promises as
   person-scoped. The `readWeeklyOverview` off-filter (`:549`) covers tasks
   numbers only, not promises. **Confirmed clean** — and note it is already
   consistent with the post-iter39 rule.

4. **Reminders page copy** — the section subtitles (「你说过的、还开着的事。这里能改
   日期，也能放下。」/「这是你答应的事，不是任务。」) and the reminder notes carry
   no check-in claim. **Confirmed clean.**

5. **Project page copy** — `ProjectSections.tsx:2329`「仅暂停主动检查，不影响你设的
   提醒。」is truthful. **My read: leave it as-is.** Argument for not mentioning
   promises: it sits under the 「主动检查」 heading and describes what turning
   check-ins off does to *proactive checking*; promises are not a check-in setting
   and adding a promise sentence there would re-import exactly the category
   confusion this batch removes. (Argument the other way — one could add
   「承诺仍会在晨检里问你」 for completeness — but that would make a general
   settings blurb enumerate a feature, and the promise's own row is already
   honest by having no tag at all.)

6. **Stale sentences found elsewhere (listed, NOT changed)**:
   - `CHANGELOG.md:80` —「…的项目，承诺照常列出，标注「不会主动问你」。」 This is the
     released 1.3.0 note; brief forbids touching CHANGELOG. Historical text.
   - `docs/superpowers/specs/2026-11-22-visible-commitments-and-availability.md:86`
     — describes the tag as the intended behaviour. Historical spec; left alone.
   - `docs/superpowers/reports/2026-11-22-iter30-commitments.md:31` — the iter30
     delivery report that introduced the tag. Historical record; left alone.

## Gates (run for real, output verbatim)

### `npm run typecheck` — exit 0

```
> study-coach@1.3.0 typecheck
> tsc --noEmit -p tsconfig.node.json && tsc --noEmit -p tsconfig.web.json
```

### `npm run typecheck:e2e` — exit 0

```
> study-coach@1.3.0 typecheck:e2e
> tsc --noEmit -p e2e/tsconfig.json
```

### `npx vitest run --maxWorkers=4`

```
 RUN  v5.0.5 C:/Users/34191/orca/workspaces/sc/fix-promise-tag

 Test Files  217 passed | 1 skipped (218)
      Tests  2392 passed | 3 skipped (2395)
   Start at  02:09:40
   Duration  85.16s (tests 60%, environment 20%, setup 9%, import 8%, transform 3%, worker 1%)
```

(The first run failed 1 test — the new test rendered two sections in sequence and
`getByText('原定 11-23')` matched twice. Fixed by rendering both entries in one
tree and asserting `getAllByText(...).toHaveLength(2)`. Solo file re-run: 8/8 pass.)

### `npm run build` — exit 0 (tail)

```
✓ built in 19ms
...
out/renderer/assets/index-DiwQwm_H.js                 429.53 kB
out/renderer/assets/react-dom-BOxPwYkh.js             530.47 kB

✓ built in 268ms
```

### `npm run test:e2e`

```
  26 passed (1.4m)
```

Includes `e2e/iter30-commitments.spec.ts` (lists / resurfaces / reschedules / 放下).

## Final HEAD

- Feature commit: `2a8a402` — fix(commitments): drop false 「不会主动问你」 badge on off-project promises
- Report commit: the commit immediately following it on `xiaolai/fix-promise-tag`
  (this report file). `git log -3 --oneline` shows both above master `ebfd0fd`.
