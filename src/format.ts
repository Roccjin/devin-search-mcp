import type { SearchResult as CodeResult } from '../third_party/dsh-devin-search/src/code-search.js';
import type { SearchResult as WebResult } from '../third_party/dsh-devin-search/src/web.js';

const LOGIN_HINT = 'Run devin-login in a terminal. Do not paste an authorization code into the chat.';

/** Upstream copy says `/devin-login`. This host's command is the terminal program `devin-login`. */
export function rewriteLogin(text: string): string {
  return text.replaceAll('/devin-login', 'devin-login');
}

/** Tool and CLI text must not carry a session token, even if a snippet contains one. */
export function withholdCredentials(text: string): string {
  if (text.includes('devin-session-token$') || text.includes('sk-ws-')) {
    return 'Devin result withheld because it contained credential material.';
  }
  return text;
}

export function presentStatus(status: string, withHint: boolean): string {
  const text = rewriteLogin(status);
  if (!withHint || text.startsWith('Logged in.')) return withholdCredentials(text);
  return withholdCredentials(`${text} ${LOGIN_HINT}`);
}

export function formatCodeSearch(result: CodeResult, includeSnippets: boolean): string {
  if (result.status === 'error' || result.files.length === 0) return withholdCredentials(rewriteLogin(result.content));
  const lines = [`Found ${result.files.length} relevant files.`];
  result.files.forEach((file, index) => {
    const ranges = file.ranges.map(range => `L${range.start}-${range.end}`).join(', ');
    lines.push(`  [${index + 1}/${result.files.length}] ${file.path} (${ranges})`);
    if (includeSnippets) {
      for (const range of file.ranges) {
        lines.push(`  --- ${file.path}:${range.start}-${range.end} ---`);
        lines.push(range.content);
      }
    }
  });
  if (result.keywords?.length) lines.push(`grep keywords: ${result.keywords.join(', ')}`);
  if (result.content.includes('Some answer paths were not verified')) {
    lines.push('Some answer paths were not verified and were omitted.');
  }
  if (result.content.includes('Search was partial')) {
    lines.push('Search was partial; this is not evidence that the whole workspace has no matches.');
  }
  return withholdCredentials(lines.join('\n'));
}

export function formatWeb(result: WebResult): string {
  if (result.sources.length === 0) return 'No web results.';
  const lines = result.sources.map((source, index) => {
    const title = source.title ? `${source.title}\n` : '';
    const snippet = source.snippet ? `\n${source.snippet}` : '';
    return `[${index + 1}] ${title}${source.url}${snippet}`;
  });
  if (result.truncated) lines.push('Results truncated.');
  return withholdCredentials(lines.join('\n\n'));
}
