/**
 * engine-pi（spec P2）：PiEngine 适配器目录。Pi 类型零泄漏边界（验收 14）——
 * src 里只允许本目录 import `@earendil-works/pi-agent-core` 及其同版本家族包。
 */
export {
  PiEngine,
  loadPiAgentCore,
  setCachedPiAgentCore,
  PI_STUB_MODEL
} from './pi-engine';
export type { PiAgentCoreModule, PiEngineOptions, PiToolSource } from './pi-engine';
export { scriptedPiModel } from './pi-fake-model';
export type { ScriptedPiRound, ScriptedPiRoundData, ScriptedPiToolCall } from './pi-fake-model';
