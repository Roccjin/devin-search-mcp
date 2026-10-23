import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { isAbsolute } from 'node:path';
import { z } from 'zod';
import { isDirectRun } from './direct.js';
import { openSearchRuntime, runCodeSearch, runStatus, runWebSearch, webSearchEnabled, type SearchRuntime, type ToolText } from './runtime.js';

const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;

const CODE_DESCRIPTION = [
  'Cloud-assisted read-only semantic code search in one local folder.',
  'Selected code is sent to the Devin/Windsurf cloud.',
  'Call this first, before manual repository exploration, when the relevant file or symbol is unknown.',
  'If the exact path or symbol is already known, read the file or search locally instead.',
  'Ask one focused question. Write the query in English and add local-language business terms only when needed.',
  'Paths and line ranges are leads: read those files before editing or answering.',
  'include_snippets defaults to false.',
  'tree_depth defaults to 3, from 1 to 6, and shrinks if the repository map exceeds 250KB.',
  'The map includes literal probe hits and hotspot directories. After the answer, unused result slots are filled from the literal searches the model already ran.',
  'If the model returns no parseable paths, the search retries up to two likely subdirectories.',
  'exclude_paths drops extra path fragments such as node_modules or dist.',
  'max_results defaults to 8 and cannot exceed 8.',
  'If the result contains a login URL, show that URL to the user and stop. Do not run devin-login or any login command.',
  'After the user finishes in the browser, call this tool again.',
  'Never ask for or accept an authorization code.',
].join(' ');

const WEB_DESCRIPTION = 'Web search through the signed-in Devin session. Do not send secrets or private source as the query. Prefer the host web search when one exists. If the result contains a login URL, show that URL and stop; do not run a login command.';

const STATUS_DESCRIPTION = 'Show whether the local Devin session is logged in, and when it expires, without revealing credentials. If no session is stored, this starts a browser login and returns the link. Show that link to the user. Do not run devin-login. Logout is devin-logout in the user terminal. Do not run it yourself.';

export interface DevinServer {
  readonly server: McpServer;
  readonly runtime: SearchRuntime;
  close(): Promise<void>;
}

function toolResult(result: ToolText) {
  return { content: [{ type: 'text' as const, text: result.text }], isError: result.isError };
}

export async function createDevinServer(options: { runtime?: SearchRuntime; env?: NodeJS.ProcessEnv } = {}): Promise<DevinServer> {
  const env = options.env ?? process.env;
  const runtime = options.runtime ?? await openSearchRuntime(env);
  const server = new McpServer({ name: 'devin-search', version: '0.1.0' });
  server.registerTool('devin_code_search', {
    description: CODE_DESCRIPTION,
    inputSchema: {
      query: z.string().min(1).max(8192).describe('What code to find. English, plus local business terms when useful.'),
      project_path: z.string().min(1).describe('Absolute path of the local folder to search. Must be the workspace root or a directory inside it.'),
      max_turns: z.number().int().min(1).max(6).default(6).describe('Cloud command rounds. Default 6, maximum 6.'),
      tree_depth: z.number().int().min(1).max(6).default(3).describe('Repository map depth. Default 3. Shrinks automatically above about 250KB.'),
      max_results: z.number().int().min(1).max(8).default(8).describe('Maximum verified files. Default 8, maximum 8.'),
      exclude_paths: z.array(z.string()).default([]).describe('Extra path fragments to skip, such as node_modules or dist. At most 32.'),
      include_snippets: z.boolean().default(false).describe('Include verified source snippets. Default false: paths, line ranges, and grep keywords only.'),
    },
    annotations: READ_ONLY,
  }, async (args, extra) => {
    const query = args.query.trim();
    if (!query) return toolResult({ text: 'query is empty.', isError: true });
    if (!isAbsolute(args.project_path)) return toolResult({ text: 'project_path must be an absolute local directory.', isError: true });
    return toolResult(await runCodeSearch(runtime, {
      query,
      projectPath: args.project_path,
      maxTurns: args.max_turns ?? 6,
      treeDepth: args.tree_depth ?? 3,
      maxResults: args.max_results ?? 8,
      excludePaths: args.exclude_paths ?? [],
      includeSnippets: args.include_snippets ?? false,
    }, extra.signal ?? new AbortController().signal));
  });
  server.registerTool('devin_status', {
    description: STATUS_DESCRIPTION,
    inputSchema: {},
    annotations: { ...READ_ONLY, openWorldHint: false },
  }, async () => toolResult(await runStatus(runtime)));
  if (webSearchEnabled(env)) {
    server.registerTool('devin_web_search', {
      description: WEB_DESCRIPTION,
      inputSchema: {
        query: z.string().min(1).max(8192).describe('Public web query.'),
        max_results: z.number().int().min(1).max(10).default(10).describe('Maximum sources, 1 to 10. Default 10.'),
      },
      annotations: READ_ONLY,
    }, async (args, extra) => toolResult(await runWebSearch(runtime, args.query.trim(), args.max_results ?? 10, extra.signal ?? new AbortController().signal)));
  }
  return {
    server,
    runtime,
    async close() {
      await server.close();
      await runtime.dispose();
    },
  };
}

if (isDirectRun()) {
  const devin = await createDevinServer();
  await devin.server.connect(new StdioServerTransport());
}
