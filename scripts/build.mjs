import { build } from 'esbuild';
import { chmod } from 'node:fs/promises';

const shared = {
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  banner: { js: '#!/usr/bin/env node' },
  legalComments: 'none',
  external: ['@modelcontextprotocol/sdk', 'zod', '@vscode/ripgrep'],
};

await build({ ...shared, entryPoints: ['src/server.ts'], outfile: 'dist/server.js' });
await build({ ...shared, entryPoints: ['src/cli.ts'], outfile: 'dist/cli.js' });
await chmod('dist/server.js', 0o755);
await chmod('dist/cli.js', 0o755);
