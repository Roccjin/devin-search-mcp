import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stderr } from 'node:process';
import { afterEach, describe, expect, it } from 'vitest';
import { browserOpenArgs, parseArgs, runCli } from '../src/cli.js';
import { createRuntime } from '../src/runtime.js';
import { AuthStore } from '../third_party/dsh-devin-search/packages/pi-devin-search/src/store.js';

const secret = 'devin-session-token$fixture-secret-value';
const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
});

describe('cli', () => {
  it('opens a browser without a shell on each platform', () => {
    const url = 'https://app.devin.ai/auth/cli/continue?state=abc&code_challenge=xyz';
    expect(browserOpenArgs('darwin', url)).toEqual({ command: 'open', args: [url] });
    expect(browserOpenArgs('linux', url, {})).toEqual({ command: 'xdg-open', args: [url] });
    expect(browserOpenArgs('linux', url, { WSL_DISTRO_NAME: 'Debian' }).command).toBe('powershell.exe');
    expect(browserOpenArgs('win32', url).args).toContain(url);
  });

  it('parses login, code, status, and logout', () => {
    expect(parseArgs([])).toEqual({ kind: 'login', mode: 'loopback' });
    expect(parseArgs(['--code'])).toEqual({ kind: 'login', mode: 'code' });
    expect(parseArgs(['login', '--code'])).toEqual({ kind: 'login', mode: 'code' });
    expect(parseArgs(['status'])).toEqual({ kind: 'status' });
    expect(parseArgs(['logout'])).toEqual({ kind: 'logout' });
    expect(parseArgs([], '/home/roccjin/.local/bin/devin-logout')).toEqual({ kind: 'logout' });
    expect(parseArgs(['--help'], 'devin-logout')).toEqual({ kind: 'help' });
    expect(parseArgs(['nope'])).toEqual({ kind: 'help' });
  });

  it('devin-logout deletes the stored session and does not print the token', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'devin-cli-'));
    dirs.push(dir);
    await new AuthStore(dir).write({
      version: 1,
      token: secret,
      expiresAt: Date.now() + 60_000,
      expirySource: 'fallback',
    });
    const lines: string[] = [];
    const write = stderr.write.bind(stderr);
    stderr.write = ((chunk: string | Uint8Array) => {
      lines.push(String(chunk));
      return true;
    }) as typeof stderr.write;
    try {
      const code = await runCli([], async () => createRuntime(dir), '/tmp/devin-logout');
      expect(code).toBe(0);
      const status = await runCli(['status'], async () => createRuntime(dir));
      expect(status).toBe(0);
    } finally {
      stderr.write = write;
    }
    const text = lines.join('');
    expect(text).toContain('Logged out; stored Devin session cleared.');
    expect(text).toContain('Not logged in.');
    expect(text).not.toContain(secret);
    expect(text).not.toContain('fixture-secret-value');
  });

  it('status prints expiry and never the token', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'devin-cli-'));
    dirs.push(dir);
    await new AuthStore(dir).write({
      version: 1,
      token: secret,
      expiresAt: Date.now() + 60_000,
      expirySource: 'fallback',
    });
    const lines: string[] = [];
    const write = stderr.write.bind(stderr);
    stderr.write = ((chunk: string | Uint8Array) => {
      lines.push(String(chunk));
      return true;
    }) as typeof stderr.write;
    try {
      const code = await runCli(['status'], async () => createRuntime(dir));
      expect(code).toBe(0);
    } finally {
      stderr.write = write;
    }
    const text = lines.join('');
    expect(text).toContain('Logged in.');
    expect(text).not.toContain(secret);
    expect(text).not.toContain('fixture-secret-value');
  });
});
