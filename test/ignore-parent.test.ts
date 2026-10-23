import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { LocalWorkspace } from '../third_party/dsh-devin-search/src/local.js';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
});

async function workspace(root: string): Promise<LocalWorkspace> {
  return LocalWorkspace.create(root, root, path => path, new AbortController().signal);
}

describe('nested gitignore parent', () => {
  it('still lists the parent after a nested rule was loaded', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'devin-ignore-'));
    dirs.push(dir);
    await mkdir(join(dir, 'third_party', 'nested'), { recursive: true });
    await mkdir(join(dir, 'src'));
    await writeFile(join(dir, 'third_party', 'nested', '.gitignore'), 'secret.ts\n');
    await writeFile(join(dir, 'third_party', 'nested', 'kept.ts'), 'export const kept = 1;\n');
    await writeFile(join(dir, 'src', 'a.ts'), 'export const target = 1;\n');
    const space = await workspace(dir);
    await space.execute({ op: 'tree', path: '/codebase/third_party/nested' });
    await expect(space.execute({ op: 'ls', path: '/codebase/third_party' })).resolves.toContain('/codebase/third_party/nested/');
    await expect(space.execute({ op: 'ls', path: '/codebase' })).resolves.toContain('/codebase/src/');
  });

  it('searches this repository root without throwing', async () => {
    const root = fileURLToPath(new URL('..', import.meta.url));
    const space = await workspace(root);
    await space.execute({ op: 'tree', path: '/codebase/third_party/dsh-devin-search' });
    await expect(space.execute({ op: 'ls', path: '/codebase' })).resolves.toContain('/codebase/src/');
    await expect(space.execute({ op: 'ls', path: '/codebase/third_party' })).resolves.toContain('/codebase/third_party/dsh-devin-search/');
  });
});
