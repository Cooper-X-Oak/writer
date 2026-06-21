// Project — a workspace directory. Stub for P0-2; fleshed out alongside the store/workspace
// layers (P2). Internal API surface → plain TS interface.

export interface Project {
  id: string;
  /** Absolute path to the workspace directory (short-hashed on Windows — see docs/windows-compat.md). */
  dir: string;
  title: string;
  /** ISO-8601 timestamp. */
  createdAt: string;
}
