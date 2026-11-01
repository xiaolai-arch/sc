# v1 Module 7 — packaging-e2e report

## Status

Complete. Added local macOS packaging, a Playwright Electron e2e suite
(onboarding → today plan → butler chat), GitHub Actions CI, MIT `LICENSE`, and
developer/build/smoke-test documentation. No merge or push was performed.

## What changed

### Packaging

- `electron-builder.yml`
  - macOS arm64 targets: `dir` (fast local verification), `zip`, `dmg`.
  - `appId`, product name, `out/**/*` + `package.json` + `LICENSE` files,
    asar, hardened runtime, deterministic artifact names.
  - Signing is left to electron-builder auto-discovery: no certificate means
    an unsigned build; setting `CSC_LINK`/`CSC_KEY_PASSWORD` or `CSC_NAME`
    enables signing without changing the config.
- `package.json`
  - Added `@playwright/test` and `electron-builder` devDependencies.
  - Added `typecheck:e2e`, `test:e2e`, `test:e2e:debug`, `package`, `dist`
    scripts. No dependency or source-behavior changes.
- `LICENSE` — MIT (matches `package.json`).

### Minimal production hook

- `src/main/index.ts`: reads optional `STUDY_COACH_USER_DATA_DIR` and calls
  `app.setPath('userData', ...)` before `app.whenReady()`. When the variable is
  absent, behavior is unchanged. This lets e2e/dev runs use a throwaway
  `state.json`/secret store and temporary vault instead of the user's real
  profile. It is the only production-code change in this module.

### E2E

- `e2e/desktop.spec.ts` drives the built Electron app through `_electron`:
  1. onboarding creates a workspace;
  2. 今日安排 adds a task and shows it in the task table;
  3. 管家 chat receives the local task context and a fake-model reply;
  4. `state.json` is marked onboarded and the task markdown exists in the
     temporary vault after the flow.
- `e2e/fixtures/fake-codex.mjs` is a local fake `codex exec` command. It reads
  stdin, answers deterministically, and never accesses the network. The fake
  model is selected through the pre-seeded local-cli provider in
  `e2e/support/launch.ts`.
- `e2e/support/launch.ts` creates a temp `userData` + vault, strips
  `*_API_KEY` / `*_TOKEN` / `*_SECRET` / `*_PASSWORD` environment variables
  from the child process, launches Electron, and cleans up.
- `e2e/playwright.config.ts` uses one worker, retries once in CI, and retains
  traces on failure.
- `e2e/tsconfig.json` typechecks the suite separately so the app's existing
  `tsconfig` ownership stays untouched.

### CI

- `.github/workflows/ci.yml`
  - `verify` on `ubuntu-latest`: `npm ci` → `npm run typecheck` →
    `npm run typecheck:e2e` → `npm test` → `npm run build`.
  - `e2e` on `macos-latest`, needs `verify`: `npm ci` →
    `npm run test:e2e`; uploads `test-results/e2e` on failure.
  - No secrets, no real provider, no signing certificates.

### Documentation

- `README.md`: product overview, dev commands, test commands, packaging,
  main/preload/renderer architecture, IPC data flow, vault layout, and a
  real-provider/local-CLI smoke-test section. The smoke-test section explains
  that keys are entered through Settings and stored via Electron
  `safeStorage`, never in vault/test/log/config artifacts.

## Commits

- `adf4812` — `build: add unsigned macOS packaging and isolated userData hook`
- `bb0007d` — `test(e2e): drive onboarding, today plan and butler chat in real Electron`
- `9bbaa11` — `ci: add ubuntu verification and macOS Electron e2e`
- `2181953` — `docs: document architecture, testing, packaging and real-model smoke tests`
- final docs commit — this report

## Verification

All commands were run locally on macOS arm64 (Node 26.0.0):

| Command | Result |
| --- | --- |
| `npm run typecheck` | passed (`tsconfig.node.json` + `tsconfig.web.json`) |
| `npm run typecheck:e2e` | passed |
| `npm test` | 37 files / 264 tests passed |
| `npm run build` | passed (`out/main`, `out/preload`, `out/renderer`) |
| `npm run test:e2e` | 1/1 Playwright Electron test passed |
| `npx electron-builder --dir` | passed; unsigned `dist/mac-arm64/Study Coach.app` |
| `npx electron-builder --mac` | passed; arm64 `dmg` + `zip` produced |

The e2e run used the checked-in fake CLI, no network, and no API keys. The
package check confirmed production dependencies (`@ai-sdk/*`, etc.) are present
inside `app.asar`.

## Risks / follow-ups

- The e2e selectors use accessible roles/labels and visible Chinese UI copy
  because the renderer is outside this module's ownership. The later
  `ui-wiring` / `legacy-cleanup` modules should update the e2e if visible text
  or onboarding structure changes; stable `data-testid` attributes would make
  this cheaper.
- The e2e pre-seeds `state.json` with the provider/vault path. If
  `JsonStateStore`'s on-disk schema changes, `e2e/support/launch.ts` must be
  updated accordingly.
- The CI e2e job depends on a macOS GUI session on `macos-latest`. If the
  runner image stops allowing Electron window creation, switch that job to
  Ubuntu + `xvfb-run` and keep `--no-sandbox` (already passed on Linux).
- The packaged app is unsigned and unmounted from distribution/notarization.
  Local Gatekeeper may require an explicit open; signing credentials remain an
  opt-in environment concern.
- The fake CLI tests the app's CLI model path, but not real `codex`/`claude`
  output or a real HTTP provider. Those are documented as manual smoke tests
  only, keeping tests offline and secret-free.
- No application icon is supplied, so packaging logs use Electron's default
  icon. Icon/branding work is outside this module.
- `npm audit` reports moderate advisories in the electron-builder dependency
  tree; no runtime dependency was added for the app itself.

## Scope

Only packaging/e2e/CI/documentation files changed, plus the single
`STUDY_COACH_USER_DATA_DIR` hook in `src/main/index.ts`. No renderer,
planning/practice/memory/search/butler/agent module logic, or their tests were
modified.
