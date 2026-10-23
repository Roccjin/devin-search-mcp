import { describe, expect, it } from 'vitest';
import type { LoginInteraction } from '../third_party/dsh-devin-search/packages/pi-devin-search/src/session.js';
import { ensureLoginLink } from '../src/login-link.js';
import type { SearchRuntime } from '../src/runtime.js';

function host(login: LoginInteraction extends never ? never : (interaction: LoginInteraction) => Promise<string>, opened: string[]): SearchRuntime {
  return {
    openLogin(url: string) { opened.push(url); },
    session: {
      available: () => false,
      status: async () => 'Not logged in.',
      login,
    },
  } as unknown as SearchRuntime;
}

describe('login link', () => {
  it('returns one link and opens the browser once while login is still waiting', async () => {
    const opened: string[] = [];
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const url = 'https://app.devin.ai/auth/cli/continue?state=abc';
    const runtime = host(async interaction => {
      calls += 1;
      interaction.notify(url);
      await gate;
      return 'Login saved.';
    }, opened);
    const first = ensureLoginLink(runtime);
    const second = ensureLoginLink(runtime);
    const [a, b] = await Promise.all([first, second]);
    expect(calls).toBe(1);
    expect(opened).toEqual([url]);
    expect(a).toContain(url);
    expect(a).toContain('Do not run devin-login');
    expect(a).toContain('Do not paste an authorization code');
    expect(b).toBe(a);
    const again = await ensureLoginLink(runtime);
    expect(again).toBe(a);
    expect(calls).toBe(1);
    release();
  });

  it('falls back to the terminal command when no link is produced', async () => {
    const runtime = host(async () => {
      throw new Error('Unable to start Devin loopback callback.');
    }, []);
    const text = await ensureLoginLink(runtime);
    expect(text).toContain('Run devin-login in a terminal.');
    expect(text).toContain('Do not paste an authorization code');
    expect(text).not.toContain('devin-session-token$');
  });
});
