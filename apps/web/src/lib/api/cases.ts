// Client for case lifecycle — lazy/explicit 立项 + promote (inbox → project corpus).
// openCase replaces the eager createCorpusProject (it requires a real title → no phantom).
// Consumed by useCases / PlanningDesk (A5/A7).

import type { MaterialCard, Project } from '@app/contracts';
import { DAEMON_URL } from './base';

/** Open a 案卷 (立项) with a real title — the explicit commit that creates the project dir. */
export async function openCase(title: string, angle?: string): Promise<Project> {
  const res = await fetch(`${DAEMON_URL}/api/cases`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(angle ? { title, angle } : { title }),
  });
  if (!res.ok) throw new Error(`open case failed: ${res.status}`);
  return (await res.json() as { project: Project }).project;
}

/** Promote (拣选) inbox items into a project's corpus. Returns the cards that landed. */
export async function promoteToCase(projectId: string, inboxIds: string[]): Promise<MaterialCard[]> {
  const res = await fetch(`${DAEMON_URL}/api/projects/${encodeURIComponent(projectId)}/materials/promote`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ inboxIds }),
  });
  if (!res.ok) throw new Error(`promote failed: ${res.status}`);
  return (await res.json() as { promoted: MaterialCard[] }).promoted;
}
