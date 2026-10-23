import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { getDefaultEnvironment, StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const home = await mkdtemp(join(tmpdir(), 'devin-smoke-'));
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [new URL('../dist/server.js', import.meta.url).pathname],
  cwd: new URL('..', import.meta.url).pathname,
  stderr: 'pipe',
  env: { ...getDefaultEnvironment(), DEVIN_SEARCH_CONFIG_HOME: home, DEVIN_LOGIN_OPEN: '0' },
});
const client = new Client({ name: 'devin-search-smoke', version: '0.1.0' });
try {
  await client.connect(transport);
  const listed = await client.listTools();
  const names = listed.tools.map(tool => tool.name).sort();
  if (names.join(',') !== 'devin_code_search,devin_status,devin_web_search') {
    throw new Error(`unexpected tools: ${names.join(',')}`);
  }
  const status = await client.callTool({ name: 'devin_status', arguments: {} });
  const text = JSON.stringify(status);
  if (!text.includes('https://app.devin.ai/auth/cli/continue?') || text.includes('devin-session-token$') || !text.includes('Do not paste an authorization code')) {
    throw new Error('status smoke failed');
  }
  console.log('smoke ok');
} finally {
  await client.close();
  await rm(home, { recursive: true, force: true });
}
