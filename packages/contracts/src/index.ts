// @app/contracts — the ONLY shared surface between web and daemon.
//
// Policy: plain TS interfaces for internal API DTOs; zod schemas only for untrusted external
// input (scraped content, plugin manifests, etc. — added in later phases). See PLAN.md §2.4.

export const CONTRACTS_PACKAGE = '@app/contracts';

export type { Health } from './api/health.js';
export type { Project } from './api/project.js';
