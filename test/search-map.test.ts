import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { formatCodeSearch } from '../src/format.js';
import { identityPath } from '../src/runtime.js';
import { codeSearch } from '../third_party/dsh-devin-search/src/code-search.js';
import type { Completion } from '../third_party/dsh-devin-search/src/completion.js';
import { LIMITS, LocalWorkspace } from '../third_party/dsh-devin-search/src/local.js';
import { toolMarker } from '../third_party/dsh-devin-search/src/protocol.js';

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
});

async function fixture(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'devin-map-'));
  dirs.push(dir);
  await mkdir(join(dir, 'src'));
  await writeFile(join(dir, 'src', 'a.ts'), 'export const alpha = 1;\n');
  await writeFile(join(dir, 'src', 'b.ts'), 'export const beta = 2;\n');
  return dir;
}

describe('repository map and literal ripgrep', () => {
  it('repairs a trailing comma and an unquoted key, and still rejects a truncated call', () => {
    expect(toolMarker('[TOOL_CALLS]restricted_exec{"command1":{"op":"ls",}}'))
      .toEqual({ name: 'restricted_exec', args: { command1: { op: 'ls' } } });
    expect(toolMarker('[TOOL_CALLS]restricted_exec{command1:{op:"ls"}}'))
      .toEqual({ name: 'restricted_exec', args: { command1: { op: 'ls' } } });
    expect(toolMarker('[TOOL_CALLS]restricted_exec{"keep":"a,}b"}'))
      .toEqual({ name: 'restricted_exec', args: { keep: 'a,}b' } });
    expect(() => toolMarker('[TOOL_CALLS]restricted_exec{"command1":')).toThrow('JSON');
  });

  it('does not expand a crowded directory in the repository map', async () => {
    const dir = await fixture();
    await mkdir(join(dir, 'crowded'));
    await Promise.all(Array.from({ length: 60 }, (_, i) => writeFile(join(dir, 'crowded', `f${i}.ts`), 'x')));
    let map = '';
    const completion: Completion = {
      async complete(_system, messages) {
        map = messages.map(message => message.content).join('\n');
        return '[TOOL_CALLS]ANSWER{"files":[]}';
      },
    };
    const result = await codeSearch(
      { search_term: 'where is alpha', search_folder_absolute_uri: dir, tree_depth: 3 },
      dir,
      identityPath,
      completion,
      new AbortController().signal,
      1,
    );
    expect(result.status).toBe('success');
    expect(map).toContain('/codebase/crowded/');
    expect(map).toContain('entries not expanded');
    expect(map).not.toContain('crowded/f0.ts');
    expect(result.meta?.treeDepth).toBe(3);
  });

  it('skips an excluded directory and keeps rg literal', async () => {
    const dir = await fixture();
    await mkdir(join(dir, 'vendor-extra'));
    await writeFile(join(dir, 'vendor-extra', 'hidden.ts'), 'export const hiddenNeedle = 1;\n');
    await writeFile(join(dir, 'hostile.txt'), `${'(a+)+$ '}${'a'.repeat(80)}\n`);
    const seen: string[] = [];
    let step = 0;
    const completion: Completion = {
      async complete(_system, messages) {
        seen.push(messages.map(message => message.content).join('\n'));
        step += 1;
        if (step === 1) return '[TOOL_CALLS]restricted_exec{"command1":{"op":"rg","path":"/codebase","pattern":"hiddenNeedle"},"command2":{"op":"rg","path":"/codebase","pattern":"(a+)+$"}}';
        return '[TOOL_CALLS]ANSWER{"files":[{"path":"/codebase/src/a.ts","ranges":[{"start":1,"end":1}]}]}';
      },
    };
    const result = await codeSearch(
      { search_term: 'where is alpha', search_folder_absolute_uri: dir, exclude_paths: ['vendor-extra'], max_results: 1 },
      dir,
      identityPath,
      completion,
      new AbortController().signal,
      2,
    );
    expect(result.status).toBe('success');
    expect(result.files).toHaveLength(1);
    expect(seen[0]).not.toContain('vendor-extra');
    expect(seen[1]).not.toContain('/codebase/vendor-extra');
    expect(seen[1]).toContain('command1:\n\ncommand2:');
    expect(seen[1]).toContain('(a+)+$');
    expect(Buffer.byteLength(seen[1])).toBeLessThan(LIMITS.totalBytes);
  });

  it('runs eight commands in one turn and drops the ninth', async () => {
    const dir = await fixture();
    const commands = Object.fromEntries([
      ...Array.from({ length: 8 }, (_, i) => [`command${i + 1}`, { op: 'ls', path: '/codebase/src' }]),
      ['command9', { op: 'rg', path: '/codebase', pattern: 'hiddenNeedle' }],
    ]);
    let transcript = '';
    const completion: Completion = {
      async complete(_system, messages) {
        transcript = messages.map(message => message.content).join('\n');
        if (transcript.includes('command8:')) return '[TOOL_CALLS]ANSWER{"files":[{"path":"/codebase/src/a.ts","ranges":[{"start":1,"end":1}]}]}';
        return `[TOOL_CALLS]restricted_exec${JSON.stringify(commands)}`;
      },
    };
    const result = await codeSearch(
      { search_term: 'where is alpha', search_folder_absolute_uri: dir },
      dir,
      identityPath,
      completion,
      new AbortController().signal,
      2,
    );
    expect(result.status).toBe('success');
    expect(transcript).toContain('command8:');
    expect(transcript).toContain('Commands beyond command8 were not executed');
  });

  it('points the map at a literal probe hit and expands a shallow tree around that directory', async () => {
    const dir = await fixture();
    let map = '';
    const completion: Completion = {
      async complete(_system, messages) {
        map = messages.map(message => message.content).join('\n');
        return '[TOOL_CALLS]ANSWER{"files":[]}';
      },
    };
    const result = await codeSearch(
      { search_term: 'where is alpha', search_folder_absolute_uri: dir, tree_depth: 1 },
      dir,
      identityPath,
      completion,
      new AbortController().signal,
      1,
    );
    expect(result.status).toBe('success');
    expect(map).toContain('# Relevant File Paths');
    expect(map).toContain('/codebase/src/a.ts:1');
    expect(map).toContain('# Hotspot Subtrees');
    expect(map).toContain('hot_dirs=[src]');
    expect(result.meta?.hotDirs).toEqual(['src']);
  });

  it('fills a remaining slot from a literal pattern and skips a readme', async () => {
    const dir = await fixture();
    await writeFile(join(dir, 'README.md'), 'export const docs = 1;\n');
    const completion: Completion = {
      async complete(_system, messages) {
        const text = messages.map(message => message.content).join('\n');
        if (text.includes('command1:')) return '[TOOL_CALLS]ANSWER{"files":[{"path":"/codebase/src/a.ts","ranges":[{"start":1,"end":1}]}]}';
        return '[TOOL_CALLS]restricted_exec{"command1":{"op":"rg","path":"/codebase","pattern":"export const"}}';
      },
    };
    const result = await codeSearch(
      { search_term: 'where is alpha', search_folder_absolute_uri: dir },
      dir,
      identityPath,
      completion,
      new AbortController().signal,
      2,
    );
    expect(result.status).toBe('success');
    expect(result.files.some(file => file.path.endsWith('/src/b.ts') && file.fromGrep)).toBe(true);
    expect(result.files.some(file => file.path.endsWith('README.md'))).toBe(false);
    expect(result.meta?.grepExpanded).toBe(1);
    const text = formatCodeSearch(result, false);
    expect(text).toContain('[grep expanded]');
    expect(text).toContain('grep_expanded=1');
    expect(text).toContain('1 from AI search, 1 from grep keyword expansion');
  });

  it('retries a narrower directory when the model never returns an answer', async () => {
    const dir = await fixture();
    await mkdir(join(dir, 'pkg'));
    await writeFile(join(dir, 'pkg', 'real.ts'), 'export const repairedJson = 1;\n');
    let calls = 0;
    const completion: Completion = {
      async complete(_system, messages) {
        calls += 1;
        const text = messages.map(message => message.content).join('\n');
        if (text.includes('/codebase/src/')) return '[TOOL_CALLS]restricted_exec{"command1":';
        return '[TOOL_CALLS]ANSWER{"files":[{"path":"/codebase/real.ts","ranges":[{"start":1,"end":1}]}]}';
      },
    };
    const result = await codeSearch(
      { search_term: 'where is repairedJson defined', search_folder_absolute_uri: dir },
      dir,
      identityPath,
      completion,
      new AbortController().signal,
      1,
    );
    expect(result.status).toBe('success');
    expect(result.files[0]?.path.endsWith('/real.ts')).toBe(true);
    expect(result.files[0]?.ranges[0]?.content).toContain('repairedJson');
    expect(calls).toBe(4);
    const text = formatCodeSearch(result, false);
    expect(text).toContain('[retry] recovered results from project_path=');
    expect(text).toContain('/pkg');
  });

  it('does not retry after a verified empty answer', async () => {
    const dir = await fixture();
    await mkdir(join(dir, 'pkg'));
    let calls = 0;
    const completion: Completion = {
      async complete() {
        calls += 1;
        return '[TOOL_CALLS]ANSWER{"files":[]}';
      },
    };
    const result = await codeSearch(
      { search_term: 'where is alpha', search_folder_absolute_uri: dir },
      dir,
      identityPath,
      completion,
      new AbortController().signal,
      1,
    );
    expect(result.status).toBe('success');
    expect(result.files).toHaveLength(0);
    expect(calls).toBe(1);
    expect(result.retryNotes).toBeUndefined();
  });
});
