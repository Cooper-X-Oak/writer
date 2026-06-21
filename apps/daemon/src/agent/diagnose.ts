// Map a DetectResult to an actionable AgentDiagnosis for the first-run guide. Each non-ready
// state carries a concrete next step (install / reinstall / update / log in).

import type { RuntimeAgentDef, DetectResult } from '@app/agent-defs';
import type { AgentDiagnosis } from '@app/contracts';

export function buildDiagnosis(def: RuntimeAgentDef, result: DetectResult): AgentDiagnosis {
  const base = {
    agentId: def.id,
    agentName: def.name,
    state: result.state,
    ready: result.state === 'READY',
    version: result.version,
    detail: result.detail,
  };

  switch (result.state) {
    case 'READY':
      return { ...base, title: `${def.name}${result.version ? ` ${result.version}` : ''} is ready` };
    case 'NOT_INSTALLED':
      return {
        ...base,
        title: `${def.name} is not installed`,
        fix: { label: `Install ${def.name}`, href: def.installUrl },
      };
    case 'VERSION_PROBE_FAILED':
      return {
        ...base,
        title: `${def.name} was found but failed to run`,
        fix: { label: `Reinstall ${def.name}`, href: def.installUrl },
      };
    case 'TOO_OLD':
      return {
        ...base,
        title: `${def.name} is too old${def.minVersion ? ` (needs ≥ ${def.minVersion})` : ''}`,
        fix: { label: `Update ${def.name}`, href: def.installUrl },
      };
    case 'NOT_LOGGED_IN':
      return {
        ...base,
        title: `${def.name} is not logged in`,
        fix: { label: `Log in to ${def.name}`, command: `${def.bin} login`, href: def.docsUrl ?? def.installUrl },
      };
    default:
      return { ...base, title: `${def.name}: unknown state` };
  }
}
