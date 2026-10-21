// Small fuzzy matcher for quick open: subsequence match scored for basename hits, word starts,
// and consecutive runs.

export interface Match {
  readonly path: string;
  readonly score: number;
  /** Indices into `path` that matched, for highlighting. */
  readonly positions: readonly number[];
}

export function fuzzyMatch(paths: readonly string[], query: string, limit = 60): Match[] {
  const q = query.replace(/\s+/g, "").toLowerCase();
  if (!q) return [];
  const out: Match[] = [];
  for (const path of paths) {
    const m = score(path, q);
    if (m) out.push(m);
  }
  out.sort((a, b) => b.score - a.score || a.path.length - b.path.length);
  return out.slice(0, limit);
}

function score(path: string, q: string): Match | null {
  const lower = path.toLowerCase();
  const baseStart = lower.lastIndexOf("/") + 1;
  // Prefer matching inside the basename: try from the basename first, fall back to the whole path.
  return run(path, lower, q, baseStart, baseStart) ?? run(path, lower, q, 0, baseStart);
}

function run(path: string, lower: string, q: string, from: number, baseStart: number): Match | null {
  const positions: number[] = [];
  let s = 0;
  let prev = -2;
  let i = from;
  for (const ch of q) {
    const at = lower.indexOf(ch, i);
    if (at < 0) return null;
    positions.push(at);
    s += 1;
    if (at === prev + 1) s += 5;
    const before = path[at - 1];
    if (at === 0 || before === "/" || before === "_" || before === "-" || before === "." || (before && /[a-z]/.test(before) && /[A-Z]/.test(path[at]!))) s += 4;
    if (at >= baseStart) s += 2;
    prev = at;
    i = at + 1;
  }
  if (lower.slice(baseStart).startsWith(q)) s += 10;
  s -= path.length * 0.02;
  return { path, score: s, positions };
}
