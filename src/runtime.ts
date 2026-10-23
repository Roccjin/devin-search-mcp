import { mkdir, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { codeSearch, type SearchResult } from '../third_party/dsh-devin-search/src/code-search.js';
import { WindsurfCompletion } from '../third_party/dsh-devin-search/src/completion.js';
import { DevinError } from '../third_party/dsh-devin-search/src/safety.js';
import { webProvider, type SearchProvider } from '../third_party/dsh-devin-search/src/web.js';
import { AuthSession } from '../third_party/dsh-devin-search/packages/pi-devin-search/src/session.js';
import { AuthStore } from '../third_party/dsh-devin-search/packages/pi-devin-search/src/store.js';
import { loginOpener } from './browser.js';
import { formatCodeSearch, formatWeb, presentStatus, rewriteLogin } from './format.js';
import { ensureLoginLink } from './login-link.js';

export interface SearchRuntime {
  readonly agentDir: string;
  readonly session: AuthSession;
  readonly cloud: WindsurfCompletion;
  readonly web: SearchProvider;
  openLogin: (url: string) => void;
  dispose(): Promise<void>;
}

export interface CodeQuery {
  query: string;
  projectPath: string;
  maxTurns: number;
  includeSnippets: boolean;
}

export interface ToolText {
  text: string;
  isError: boolean;
}

/** Parent of `devin-search/credentials.json`. Default is `~/.config`. */
export function credentialAgentDir(env: NodeJS.ProcessEnv = process.env, home = homedir()): string {
  const override = env.DEVIN_SEARCH_CONFIG_HOME;
  if (override !== undefined) {
    if (!override || !isAbsolute(override)) throw new Error('DEVIN_SEARCH_CONFIG_HOME must be an absolute path.');
    return override;
  }
  return join(home, '.config');
}

/** On unless DEVIN_WEB_SEARCH is 0, false, no, or off. */
export function webSearchEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env.DEVIN_WEB_SEARCH?.trim().toLowerCase();
  if (value === undefined || value === '') return true;
  return value !== '0' && value !== 'false' && value !== 'no' && value !== 'off';
}

/** The credential store rejects a symlink parent. Resolve after create. */
export async function prepareAgentDir(dir: string): Promise<string> {
  await mkdir(dir, { recursive: true, mode: 0o755 });
  return realpath(dir);
}

export function createRuntime(agentDir: string, options: { openLogin?: (url: string) => void } = {}): SearchRuntime {
  const store = new AuthStore(agentDir);
  let cloud!: WindsurfCompletion;
  const session = new AuthSession(store, { onInvalidate: () => cloud.invalidate() });
  cloud = new WindsurfCompletion(session);
  const web = webProvider(session);
  let disposed = false;
  return {
    agentDir,
    session,
    cloud,
    web,
    openLogin: options.openLogin ?? (() => {}),
    async dispose() {
      if (disposed) return;
      disposed = true;
      cloud.invalidate();
      await session.dispose();
    },
  };
}

export async function openSearchRuntime(env: NodeJS.ProcessEnv = process.env): Promise<SearchRuntime> {
  return createRuntime(await prepareAgentDir(credentialAgentDir(env)), { openLogin: loginOpener(env) });
}

export function identityPath(path: string): string {
  return path;
}

export async function runCodeSearch(runtime: SearchRuntime, input: CodeQuery, signal: AbortSignal): Promise<ToolText> {
  await runtime.session.status();
  if (!runtime.session.available()) return { text: await ensureLoginLink(runtime), isError: true };
  let result: SearchResult;
  try {
    result = await codeSearch(
      { search_term: input.query, search_folder_absolute_uri: input.projectPath },
      input.projectPath,
      identityPath,
      runtime.cloud,
      signal,
      input.maxTurns,
    );
  } catch (error) {
    return { text: rewriteLogin(error instanceof DevinError ? error.message : 'Devin operation failed. No provider details were retained.'), isError: true };
  }
  return { text: formatCodeSearch(result, input.includeSnippets), isError: result.status === 'error' };
}

export async function runWebSearch(runtime: SearchRuntime, query: string, maxResults: number, signal: AbortSignal): Promise<ToolText> {
  await runtime.session.status();
  if (!runtime.session.available()) return { text: await ensureLoginLink(runtime), isError: true };
  try {
    const result = await runtime.web.search({ query, maxResults }, signal);
    return { text: formatWeb(result), isError: false };
  } catch (error) {
    return { text: rewriteLogin(error instanceof DevinError ? error.message : 'Devin operation failed. No provider details were retained.'), isError: true };
  }
}

export async function runStatus(runtime: SearchRuntime): Promise<ToolText> {
  const status = await runtime.session.status();
  if (!runtime.session.available()) return { text: await ensureLoginLink(runtime), isError: false };
  return { text: presentStatus(status, false), isError: false };
}
