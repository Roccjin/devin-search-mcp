import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** True when this module is the process entry, including a symlink to the built file. */
export function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(entry);
  } catch {
    return false;
  }
}
