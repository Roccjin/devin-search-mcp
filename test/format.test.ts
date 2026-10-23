import { describe, expect, it } from 'vitest';
import { formatCodeSearch, formatWeb, presentStatus, withholdCredentials } from '../src/format.js';
import type { SearchResult } from '../third_party/dsh-devin-search/src/code-search.js';

const hit: SearchResult = {
  status: 'success',
  keywords: ['target'],
  content: 'export const target = 1;\n',
  files: [{ path: '/tmp/proj/a.ts', ranges: [{ start: 1, end: 1, content: 'export const target = 1;' }] }],
};

describe('format', () => {
  it('keeps paths and keywords and drops snippets by default', () => {
    const text = formatCodeSearch(hit, false);
    expect(text).toContain('/tmp/proj/a.ts (L1-1)');
    expect(text).toContain('grep keywords: target');
    expect(text).not.toContain('export const target');
  });

  it('includes snippets only when asked', () => {
    expect(formatCodeSearch(hit, true)).toContain('export const target = 1;');
  });

  it('rewrites the upstream login command and adds the terminal hint', () => {
    const text = presentStatus('Session expired; use /devin-login.', true);
    expect(text).toContain('devin-login');
    expect(text).not.toContain('/devin-login');
    expect(text).toContain('Run devin-login in a terminal.');
    expect(text).toContain('Do not paste an authorization code');
  });

  it('withholds credential material', () => {
    expect(withholdCredentials('prefix devin-session-token$secret')).toBe('Devin result withheld because it contained credential material.');
  });

  it('formats web sources without adding a login hint', () => {
    const text = formatWeb({
      truncated: false,
      sources: [{ url: 'https://example.test/a', title: 'Example', snippet: 'hello' }],
    });
    expect(text).toContain('https://example.test/a');
    expect(text).toContain('hello');
  });
});
