// @app/desktop — Electron shell.
//
// Placeholder. P0-5 adds main.ts that spawns the daemon as a child process, waits for health, and
// loads the web URL (tearing the daemon down on quit). NOTE: the Electron window + Windows
// path/ConPTY/atomic-write behavior must be verified on a real Windows 11 machine — not in the
// cloud Linux session. See docs/windows-compat.md and docs/issues-phase-0-1.md.

export const DESKTOP_PACKAGE = '@app/desktop';
