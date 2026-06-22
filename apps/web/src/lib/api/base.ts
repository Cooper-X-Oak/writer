export const DAEMON_URL = process.env.NEXT_PUBLIC_DAEMON_URL ?? 'http://127.0.0.1:4319';

/** Base URL the preview iframe uses to resolve a project's relative image srcs. */
export function projectImageBase(id: string): string {
  return `${DAEMON_URL}/api/projects/${encodeURIComponent(id)}/`;
}
