// @app/agent-defs — RuntimeAgentDef type + concrete CLI adapters + first-run detection.
// See docs/agent-layer.md.

export type { RuntimeAgentDef, RuntimeModelOption, RuntimeBuildContext } from './types.js';
export { RuntimePromptBudgetError } from './types.js';
export { claudeCode, isRootProcess } from './defs/claude-code.js';
export { detectAgent, parseSemver, defaultResolveBin } from './detect.js';
export type { DetectState, DetectResult, DetectDeps, RunFn, RunResult } from './detect.js';
export { quoteWinArg, buildWinCmdInvocation } from './win-spawn.js';
export type { WinCmdInvocation } from './win-spawn.js';
