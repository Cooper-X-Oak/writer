// Agent first-run diagnosis — surfaced to the web so the user gets a precise, actionable guide
// when their coding-agent CLI is missing/misconfigured (PLAN.md §3, CRITICAL risk).

export type AgentDetectState =
  | 'NOT_INSTALLED'
  | 'VERSION_PROBE_FAILED'
  | 'TOO_OLD'
  | 'NOT_LOGGED_IN'
  | 'READY';

export interface AgentFix {
  /** Button/CTA label, e.g. "Install Claude Code". */
  label: string;
  /** Documentation/download link. */
  href?: string;
  /** A shell command the user can copy, e.g. "claude login". */
  command?: string;
}

export interface AgentDiagnosis {
  agentId: string;
  agentName: string;
  state: AgentDetectState;
  ready: boolean;
  version?: string;
  /** Human headline for the state. */
  title: string;
  detail?: string;
  /** Actionable next step (absent when ready). */
  fix?: AgentFix;
}
