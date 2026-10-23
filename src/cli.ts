import { basename } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stderr, stdin } from 'node:process';
import { DevinError } from '../third_party/dsh-devin-search/src/safety.js';
import { browserOpenArgs, openBrowser } from './browser.js';
import { isDirectRun } from './direct.js';
import { presentStatus } from './format.js';
import { openSearchRuntime, type SearchRuntime } from './runtime.js';

export { browserOpenArgs, openBrowser };

export type CliCommand =
  | { kind: 'login'; mode: 'loopback' | 'code' }
  | { kind: 'status' }
  | { kind: 'logout' }
  | { kind: 'help' };

const USAGE = `Usage:
  devin-login              browser callback on this machine
  devin-login --code       print the URL and read the code in this terminal
  devin-login status       show login state without credentials
  devin-logout             delete the local session
`;

export function parseArgs(argv: readonly string[], invoked = ''): CliCommand {
  if (basename(invoked) === 'devin-logout') return argv.length === 0 ? { kind: 'logout' } : { kind: 'help' };
  if (argv.length === 0) return { kind: 'login', mode: 'loopback' };
  if (argv.length === 1 && (argv[0] === 'login' || argv[0] === '--login')) return { kind: 'login', mode: 'loopback' };
  if (argv.length === 1 && (argv[0] === '--code' || argv[0] === 'code')) return { kind: 'login', mode: 'code' };
  if (argv.length === 2 && argv[0] === 'login' && (argv[1] === '--code' || argv[1] === 'code')) return { kind: 'login', mode: 'code' };
  if (argv.length === 1 && argv[0] === 'status') return { kind: 'status' };
  if (argv.length === 1 && argv[0] === 'logout') return { kind: 'logout' };
  return { kind: 'help' };
}

function write(text: string): void {
  stderr.write(`${text}\n`);
}

function failureText(error: unknown): string {
  if (error instanceof DevinError) return error.message;
  if (error instanceof Error && error.message === 'DEVIN_SEARCH_CONFIG_HOME must be an absolute path.') return error.message;
  return 'Devin operation failed. No provider details were retained.';
}

async function prompt(signal: AbortSignal): Promise<string> {
  const rl = createInterface({ input: stdin, output: stderr });
  const abort = () => { rl.close(); };
  signal.addEventListener('abort', abort, { once: true });
  try {
    return await rl.question('Paste the Devin authorization code, then press Enter:\n');
  } finally {
    signal.removeEventListener('abort', abort);
    rl.close();
  }
}

export async function runCli(argv: readonly string[], open: () => Promise<SearchRuntime> = openSearchRuntime, invoked = ''): Promise<number> {
  const command = parseArgs(argv, invoked);
  if (command.kind === 'help') {
    write(USAGE.trimEnd());
    return 2;
  }
  let runtime: SearchRuntime | undefined;
  const controller = new AbortController();
  const stop = () => {
    runtime?.session.cancel();
    controller.abort();
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  try {
    runtime = await open();
    if (command.kind === 'status') {
      const text = await runtime.session.status();
      write(presentStatus(text, !runtime.session.available()));
      return 0;
    }
    if (command.kind === 'logout') {
      await runtime.session.logout();
      write('Logged out; stored Devin session cleared.');
      return 0;
    }
    const text = await runtime.session.login({
      hasUI: true,
      notify(url) {
        write(url);
        if (command.mode === 'loopback') {
          openBrowser(url);
          write('Opening the browser. If it does not open, use the URL above. Waiting for the local callback.');
        } else {
          write('Open this URL, then paste the authorization code in this terminal. Do not paste it into an agent chat.');
        }
      },
      prompt,
    }, controller.signal, command.mode);
    write(text);
    return 0;
  } catch (error) {
    write(failureText(error));
    return 1;
  } finally {
    process.off('SIGINT', stop);
    process.off('SIGTERM', stop);
    await runtime?.dispose();
  }
}

if (isDirectRun()) {
  process.exitCode = await runCli(process.argv.slice(2), openSearchRuntime, process.argv[1] ?? '');
}
