// Write the composed system prompt to a temp file so it can be passed to the CLI by path
// (--append-system-prompt-file) instead of inline argv — dodges the Windows command-line limit.
// Returns the path plus an idempotent best-effort cleanup.

import { writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';

export interface SystemPromptFile {
  path: string;
  cleanup: () => void;
}

export async function writeTempSystemPrompt(content: string, dir: string = tmpdir()): Promise<SystemPromptFile> {
  const path = join(dir, `hsw-sysprompt-${randomBytes(8).toString('hex')}.md`);
  await writeFile(path, content, 'utf8');
  let cleaned = false;
  return {
    path,
    cleanup: () => {
      if (cleaned) return;
      cleaned = true;
      void rm(path, { force: true });
    },
  };
}
