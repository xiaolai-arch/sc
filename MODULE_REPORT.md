# Module 1 — agent-tools report

## What changed

- `CliAgentClient` now advertises the available tool JSON schemas and the
  fenced-JSON tool protocol in the prompt (only when `request.tools` is
  present). Follow-up rounds serialize assistant tool calls and tool results
  so a one-shot CLI sees the whole tool loop.
- `parseCliResponse` extracts the last fenced JSON block, validates the
  `{ "text", "toolCalls" }` envelope, preserves supplied call ids (generating
  `cli-call-<n>` when missing), and maps tool calls to
  `ModelResponse.toolCalls`. A malformed block, a non-envelope block, or plain
  text falls back to the raw answer text with no tool calls.
- The codex path still runs `extractCodexAnswer` first, so banner/token
  transcripts are parsed before the structured block is extracted.
- `ButlerServiceImpl` needed no production changes: its existing loop already
  sends tool definitions, executes `get_today_plan` / `write_note` /
  `update_task` / `get_memory`, and converts tool or CLI failures into text.
  The new integration tests verify that behavior through a real
  `CliAgentClient` + `CliRunner`.

## Commits

- `c12475f` feat(agent): add structured tool protocol for local CLI agents
- `71a203d` test(butler): cover CLI tool execution and failure degradation

## Verification

| Command | Result |
| --- | --- |
| `npx vitest run tests/main/cli-agent-client.test.ts` | 21 passed |
| `npx vitest run tests/main/butler-cli-agent.test.ts` | 6 passed |
| `npm test` | 32 files / 204 tests passed |
| `npm run typecheck` | clean (`tsconfig.node.json` + `tsconfig.web.json`) |

No network is used in tests: every CLI test injects `CliRunner`, and the
butler integration tests use an in-memory `WorkspaceService` fake.

## Behavior notes

- Only the **last** fenced block is authoritative. If it fails to parse, the
  answer degrades to plain text rather than executing an earlier draft; this
  avoids replaying stale tool calls against the vault.
- Tool call ids supplied by the agent are kept; otherwise ids are generated
  per response.
- When no tools are supplied (for example a read-only butler with no workspace
  service), the protocol section is omitted from the prompt.
- Tool results are rendered as `TOOL RESULT (<name>):` sections, and assistant
  turns as `ASSISTANT TOOL CALLS:` JSON, keeping the CLI conversation
  self-describing across one-shot invocations.

## Risks

- CLI agents receive the tool protocol by prompt, not through a native tool
  API. A non-compliant local model may answer in prose or emit a malformed
  block; this is handled by the plain-text fallback, but tool-use reliability
  depends on the local model.
- `extractCodexAnswer`'s fallback path (no `tokens used` marker) keeps only the
  last non-empty line. A structured block printed without the token summary
  would not parse. This is pre-existing codex behavior and was left unchanged.
- Tool arguments are forwarded to the existing butler validators. Unknown
  tools and invalid arguments become `{ ok: false }` tool results and a
  follow-up model turn; if that turn fails, the butler returns a template
  reply.
- The implementation assumes tool schemas are JSON-serializable (they are
  static objects in `src/main/butler/tools.ts`).

## Scope

Only `src/main/agent/cli-agent-client.ts`, `tests/main/cli-agent-client.test.ts`,
and `tests/main/butler-cli-agent.test.ts` changed. No edits to
`src/shared/ipc.ts`, `src/main/context.ts`, `src/main/ipc.ts`,
`src/renderer/**`, or other module directories. No merge or push was done.
