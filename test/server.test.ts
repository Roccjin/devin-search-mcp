import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createRuntime } from '../src/runtime.js';
import { createDevinServer, type DevinServer } from '../src/server.js';

const dirs: string[] = [];
const open: DevinServer[] = [];

afterEach(async () => {
  await Promise.all(open.splice(0).map(server => server.close()));
  await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
});

async function clientFor(env: NodeJS.ProcessEnv) {
  const dir = await mkdtemp(join(tmpdir(), 'devin-mcp-'));
  dirs.push(dir);
  const devin = await createDevinServer({ runtime: createRuntime(dir), env });
  open.push(devin);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await devin.server.connect(serverTransport);
  const client = new Client({ name: 'devin-search-test', version: '0' });
  await client.connect(clientTransport);
  return client;
}

function textOf(result: unknown): { text: string; isError: boolean } {
  if (!result || typeof result !== 'object') return { text: '', isError: false };
  const record = result as { content?: unknown; isError?: boolean };
  const content = Array.isArray(record.content) ? record.content : [];
  const text = content.map(item => typeof item === 'object' && item && 'text' in item ? String(item.text) : '').join('\n');
  return { text, isError: record.isError === true };
}

describe('mcp server', () => {
  it('registers code search and status, and hides web search', async () => {
    const client = await clientFor({});
    const listed = await client.listTools();
    const names = listed.tools.map(tool => tool.name).sort();
    expect(names).toEqual(['devin_code_search', 'devin_status', 'devin_web_search']);
    const web = listed.tools.find(tool => tool.name === 'devin_web_search');
    const schema = web?.inputSchema as { properties?: { max_results?: { default?: number } } } | undefined;
    expect(schema?.properties?.max_results?.default).toBe(10);
    const code = listed.tools.find(tool => tool.name === 'devin_code_search');
    const codeSchema = code?.inputSchema as { properties?: { tree_depth?: { default?: number }; max_results?: { default?: number } } } | undefined;
    expect(codeSchema?.properties?.tree_depth?.default).toBe(3);
    expect(codeSchema?.properties?.max_results?.default).toBe(8);
    const status = textOf(await client.callTool({ name: 'devin_status', arguments: {} }));
    const url = status.text.match(/https:\/\/app\.devin\.ai\/auth\/cli\/continue\?\S+/)?.[0];
    expect(url).toBeTruthy();
    expect(status.text).toContain('Do not paste an authorization code');
    expect(status.text).toContain('Do not run devin-login');
    expect(status.text).not.toContain('devin-session-token$');
    const search = textOf(await client.callTool({
      name: 'devin_code_search',
      arguments: { query: 'where is login handled', project_path: '/tmp', include_snippets: true },
    }));
    expect(search.isError).toBe(true);
    expect(search.text).toContain(url);
  });

  it('hides web search when DEVIN_WEB_SEARCH is off', async () => {
    const client = await clientFor({ DEVIN_WEB_SEARCH: '0' });
    const listed = await client.listTools();
    expect(listed.tools.map(tool => tool.name)).not.toContain('devin_web_search');
  });

  it('rejects a relative project path before any search', async () => {
    const client = await clientFor({});
    const search = textOf(await client.callTool({
      name: 'devin_code_search',
      arguments: { query: 'target', project_path: 'relative/path' },
    }));
    expect(search.isError).toBe(true);
    expect(search.text).toContain('absolute');
  });
});
