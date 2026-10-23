import type { LocalWorkspace } from './local.js';

const STOP = new Set([
  'where', 'what', 'which', 'when', 'who', 'why', 'how', 'does', 'with',
  'from', 'into', 'that', 'this', 'those', 'these', 'there', 'their',
  'implemented', 'implementation', 'handled', 'handling', 'used', 'using',
  'code', 'file', 'files', 'logic', 'find', 'search', 'about', 'have',
  'been', 'also', 'only', 'your', 'than', 'then', 'them', 'they', 'will',
  'would', 'could', 'should', 'after', 'before', 'under', 'over', 'such',
  'some', 'more', 'most', 'each', 'other', 'back', 'fall', 'down',
]);

const HINTS = ['src', 'app', 'lib', 'packages', 'server', 'backend', 'services', 'internal'];

export interface HotMap {
  text: string;
  depth: number;
  bytes: number;
  fellBack: boolean;
  hotspotDepth: number;
  hotDirs: string[];
  retryCandidates: string[];
}

/** Distinctive query tokens, longest first, original spelling kept for literal probe. */
export function queryTokens(query: string): string[] {
  const scored: { token: string; rank: number }[] = [];
  const seen = new Set<string>();
  const add = (token: string, rank: number) => {
    const key = token.toLowerCase();
    if (key.length < 4 || STOP.has(key) || seen.has(key)) return;
    seen.add(key);
    scored.push({ token, rank });
  };
  for (const part of query.split(/[^A-Za-z0-9_]+/)) {
    if (!part) continue;
    add(part, part.length + 1);
    const split = part
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
      .split(/[_\s]+/);
    for (const piece of split) add(piece, piece.length);
  }
  return scored.sort((a, b) => b.rank - a.rank || a.token.localeCompare(b.token)).slice(0, 6).map(item => item.token);
}

function dirScores(topDirs: string[], tokens: string[], hits: readonly { rel: string }[], hotDirs: readonly string[], hints: boolean): { name: string; score: number; probe: number }[] {
  const present = new Set(topDirs);
  const hitCount = new Map<string, number>();
  for (const hit of hits) {
    const top = hit.rel.split('/')[0];
    if (!top || !present.has(top)) continue;
    hitCount.set(top, (hitCount.get(top) ?? 0) + 1);
  }
  const names = [...new Set([...hotDirs, ...topDirs, ...(hints ? HINTS : [])])].filter(name => present.has(name));
  return names.map(name => {
    const lower = name.toLowerCase();
    let nameScore = 0;
    for (const token of tokens) {
      const key = token.toLowerCase();
      if (lower === key) nameScore += 4;
      else if (lower.includes(key) || (key.length >= lower.length && key.includes(lower))) nameScore += 2;
    }
    const probe = hitCount.get(name) ?? 0;
    const score = probe * 10 + nameScore + (hotDirs.includes(name) ? 2 : 0) + (hints && HINTS.includes(lower) ? 1 : 0);
    return { name, score, probe };
  }).filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || b.probe - a.probe || a.name.localeCompare(b.name));
}

/** Local substitute for the 1.5.2 directory ranker: literal probe hits plus directory-name overlap. No git history and no extra model round. */
export async function describeRepository(workspace: LocalWorkspace, query: string, requested: number): Promise<HotMap> {
  const classic = await workspace.repoMap(requested);
  const tokens = queryTokens(query);
  const hits = tokens.length ? await workspace.probeLiterals(tokens, 24) : [];
  const topDirs = await workspace.topDirectories();
  const hotDirs = dirScores(topDirs, tokens, hits, [], false).slice(0, 4).map(item => item.name);
  const hotspotDepth = requested > 2 ? Math.min(4, requested) : 2;
  const sections = [classic.text];
  if (hits.length) {
    const lines = ['', '# Relevant File Paths'];
    for (const hit of hits) lines.push(`- /codebase/${hit.rel}:${hit.line}`);
    sections.push(lines.join('\n'));
  }
  if (hotDirs.length && classic.depth < hotspotDepth) {
    const blocks = ['', '# Hotspot Subtrees'];
    for (const dir of hotDirs) blocks.push(await workspace.subtreeMap(dir, hotspotDepth), '');
    sections.push(blocks.join('\n').trimEnd());
  }
  let text = sections.join('\n');
  let bytes = Buffer.byteLength(text);
  if (bytes > 250 * 1024) {
    text = classic.text;
    bytes = classic.bytes;
  }
  return {
    text,
    depth: classic.depth,
    bytes,
    fellBack: classic.fellBack,
    hotspotDepth: hotDirs.length ? hotspotDepth : 0,
    hotDirs,
    retryCandidates: dirScores(topDirs, tokens, hits, hotDirs, true).slice(0, 2).map(item => item.name),
  };
}

const NOISE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.webp', '.woff', '.ttf', '.eot', '.mp4', '.mp3', '.pdf', '.zip', '.gz', '.exe', '.dll', '.so', '.pyc', '.class', '.wasm']);
const NOISE_BASE = new Set(['package.json', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'notice', 'license', 'claude.md', 'agents.md']);

/** 0 prefers implementation files, 1 is tests and docs, undefined is skipped. */
export function expansionRank(rel: string): number | undefined {
  const base = rel.split('/').pop()?.toLowerCase() ?? '';
  if (!base || NOISE_BASE.has(base) || base.startsWith('readme') || base.endsWith('.d.ts') || base.endsWith('.min.js') || base.endsWith('.map')) return;
  const ext = base.includes('.') ? base.slice(base.lastIndexOf('.')) : '';
  if (NOISE_EXT.has(ext)) return;
  if (rel.includes('/test/') || rel.includes('/tests/') || /\.(?:test|spec)\./.test(base)) return 1;
  if (ext === '.md' || ext === '.json' || ext === '.yml' || ext === '.yaml' || ext === '.toml') return 1;
  return 0;
}

