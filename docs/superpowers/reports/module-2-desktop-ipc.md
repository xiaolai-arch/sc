# Module 2 — desktop-services-ipc report

Base: `82e7612` (`feat/personal-butler-data`), branch `module-2-desktop-ipc`.

## Commits

| Commit | Summary |
| --- | --- |
| `bbc1c3a` | feat(main): add JSON state store and settings service |
| `3b67b75` | feat(main): wire workspace and butler IPC with preload bridge |

## What was implemented

- `src/main/state-store.ts`: JSON-backed `AppState` store with in-memory mode (`filePath: null`), serialized `update()` calls, atomic temp-file + rename writes, 0600 file mode, and corrupt-file fallback to defaults.
- `src/main/settings/defaults.ts`: defaults for vault path, Anthropic provider, notifications, budget and launch-at-login.
- `src/main/settings/settings-service.ts`: read/deep-merge/validate settings (provider shape, `HH:MM` times, non-negative integer budgets, vault path).
- `src/main/settings/secret-store.ts`: `InMemorySecretStore` for tests and `SafeStorageSecretStore` using Electron `safeStorage` ciphertext in a dedicated 0600 file. `getApiKey()` is main-process only and is not exposed over IPC.
- `src/main/context.ts`: composes state, settings, secrets, `createWorkspaceService(vaultRoot)` and `createButlerService(vaultRoot)` (factory placeholders are only called, not implemented), and implements the legacy bootstrap/onboarding/settings/today-plan API.
- `src/main/ipc.ts`: 19 channels, parameter validation, sanitized error serialization/secret redaction, and `createStudyCoachBridge()` used by preload.
- `src/preload/index.ts`: exposes the bridge with `ipcRenderer.invoke` only.
- `src/main/index.ts`: creates the context from `userData` + `Documents/StudyCoachVault`, registers IPC, then creates the window; startup errors are logged only as a sanitized message.

## IPC channels

| Channel |
| --- |
| `study-coach:bootstrap:get` |
| `study-coach:bootstrap:complete-onboarding` |
| `study-coach:settings:get` |
| `study-coach:settings:update` |
| `study-coach:settings:set-api-key` |
| `study-coach:today-plan:get` |
| `study-coach:today-plan:generate` |
| `study-coach:today-plan:update-task` |
| `study-coach:workspaces:list` |
| `study-coach:workspaces:create` |
| `study-coach:workspaces:snapshot` |
| `study-coach:workspaces:create-task` |
| `study-coach:workspaces:update-task` |
| `study-coach:workspaces:create-note` |
| `study-coach:workspaces:update-note` |
| `study-coach:workspaces:memory` |
| `study-coach:reminders:list` |
| `study-coach:review:submit` |
| `study-coach:butler:send` |

## Verification

```
$ npx vitest run tests/main/ipc-*.test.ts tests/main/settings-*.test.ts
 Test Files  5 passed (5)
      Tests  19 passed (19)

$ npm run typecheck
(no errors)

$ npm test
 Test Files  18 passed (18)
      Tests  70 passed (70)

$ npm run build
main, preload and renderer bundles built successfully
```

Coverage added: channel registration/routing, handler parameter rejection, service error serialization, secret redaction, API-key non-echo (settings/bootstrap/state file), preload channel names and argument forwarding, settings defaults and nested persistence, safeStorage ciphertext-at-rest, and bootstrap/onboarding/today-plan persistence across context restarts.

## Risks / follow-ups

- `createWorkspaceService` and `createButlerService` remain placeholders, so production startup will reject until Modules 1 and 3 land (intentional per the module plan; tests inject fakes).
- Changing `settings.vaultPath` at runtime does not rebuild the already-created workspace/butler services. Module 5's final context wiring should either restart the context or recreate services on vault change.
- The template today-plan generator in `context.ts` is intentionally minimal and should be replaced by the butler/planner integration in Module 5.
- `SafeStorageSecretStore.hasApiKey()` reports file presence/size; if OS encryption later becomes unavailable, bootstrap may still report a key until a read is attempted.
- Error redaction covers `sk-…` and `Bearer …` shapes; custom provider keys with other prefixes should not be interpolated into errors by callers.
