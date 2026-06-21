// @app/daemon — privileged local background process (Express 5 + /api/*).
//
// Placeholder. P0-3 adds the server and GET /api/health → { status, version }. Later phases add
// the agent runner (pipes), collect layer, store, workspace watcher, media, export, and MCP server.
// See docs/issues-phase-0-1.md and ../../PLAN.md.

export const DAEMON_PACKAGE = '@app/daemon';
