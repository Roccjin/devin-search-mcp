import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { formatCodeSearch } from '../src/format.js';
import { createRuntime, identityPath, runCodeSearch } from '../src/runtime.js';
import { codeSearch } from '../third_party/dsh-devin-search/src/code-search.js';
import type { Completion } from '../third_party/dsh-devin-search/src/completion.js';
import { AuthStore } from '../third_party/dsh-devin-search/packages/pi-devin-search/src/store.js';

const secret = 'devin-session-token$fixture-secret-value';
const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
});

describe('code search', () => {
  it('stops after the requested turns and omits snippet text', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'devin-search-'));
    dirs.push(dir);
    await mkdir(join(dir, 'src'));
    await writeFile(join(dir, 'src', 'a.ts'), 'export const target = 1;\n');
    let calls = 0;
    const completion: Completion = {
      async complete(system) {
        calls += 1;
        if (system.includes('Command budget exhausted')) {
          return '<ANSWER><file path="/codebase/src/a.ts"><range>1-1</range></file></ANSWER>';
        }
        return '[TOOL_CALLS]restricted_exec{"command1":{"op":"rg","path":"/codebase","pattern":"target"}}';
      },
    };
    const result = await codeSearch(
      { search_term: 'where is target defined', search_folder_absolute_uri: dir },
      dir,
      identityPath,
      completion,
      new AbortController().signal,
      1,
    );
    expect(calls).toBe(2);
    expect(result.status).toBe('success');
    expect(result.keywords).toEqual(['target']);
    expect(result.files[0]?.path.endsWith('/src/a.ts')).toBe(true);
    const text = formatCodeSearch(result, false);
    expect(text).toContain('grep keywords: target');
    expect(text).not.toContain('export const target');
  });

  it('refuses a search when no session is stored', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'devin-runtime-'));
    dirs.push(dir);
    const runtime = createRuntime(dir);
    const result = await runCodeSearch(runtime, {
      query: 'target',
      projectPath: dir,
      maxTurns: 1,
      includeSnippets: false,
    }, new AbortController().signal);
    expect(result.isError).toBe(true);
    expect(result.text).toContain('https://app.devin.ai/auth/cli/continue?');
    expect(result.text).toContain('Do not run devin-login');
    expect(result.text).not.toContain('devin-session-token$');
    await runtime.dispose();
  });

  it('status of a stored grant does not echo the token', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'devin-grant-'));
    dirs.push(dir);
    await new AuthStore(dir).write({
      version: 1,
      token: secret,
      expiresAt: Date.now() + 60_000,
      expirySource: 'fallback',
    });
    const runtime = createRuntime(dir);
    const text = await runtime.session.status();
    expect(text).toContain('Logged in.');
    expect(text).not.toContain(secret);
    await runtime.dispose();
  });

  it('keeps the first complete tool call and quotes a truncated one', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'devin-search-'));
    dirs.push(dir);
    await mkdir(join(dir, 'src'));
    await writeFile(join(dir, 'src', 'a.ts'), 'export const target = 1;\n');
    const seen: string[] = [];
    let step = 0;
    const completion: Completion = {
      async complete(_system, messages) {
        seen.push(messages.map(message => message.content).join('\n'));
        step += 1;
        if (step === 1) {
          return '[TOOL_CALLS]restricted_exec{"command1":{"op":"readfile","path":"/codebase/src/a.ts","start":1,"end":1}}\nI will check the next symbol.\n[TOOL_CALLS]ANSWER{"files":[]}';
        }
        if (step === 2) return '[TOOL_CALLS]restricted_exec{"command1":';
        return '[TOOL_CALLS]ANSWER{"files":[{"path":"/codebase/src/a.ts","ranges":[{"start":1,"end":1}]}]}';
      },
    };
    const result = await codeSearch(
      { search_term: 'where is target defined', search_folder_absolute_uri: dir },
      dir,
      identityPath,
      completion,
      new AbortController().signal,
      3,
    );
    expect(result.status).toBe('success');
    expect(result.files[0]?.path.endsWith('/src/a.ts')).toBe(true);
    expect(seen[1]).toContain('export const target');
    expect(seen[1]).not.toContain('No commands were executed');
    expect(seen[2]).toContain('Invalid Devin JSON response');
    expect(seen[2]).toContain('[TOOL_CALLS]restricted_exec{"command1":');
    expect(step).toBe(3);
  });
});
