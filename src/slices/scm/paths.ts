import type { ChangeKind } from "@/core/ipc";

export function splitPath(path: string): { name: string; dir: string } {
  const i = path.lastIndexOf("/");
  return i < 0 ? { name: path, dir: "" } : { name: path.slice(i + 1), dir: path.slice(0, i) };
}

const LETTERS: Record<ChangeKind, string> = {
  added: "A",
  modified: "M",
  deleted: "D",
  renamed: "R",
  untracked: "U",
  conflicted: "!",
};

export const statusLetter = (kind: ChangeKind): string => LETTERS[kind];

export interface PatchStats {
  readonly additions: number;
  readonly deletions: number;
  /** Lines inside hunks, a cheap proxy for rendered height. */
  readonly lines: number;
  readonly deleted: boolean;
  readonly binary: boolean;
}

/** Counts +/- lines in a single-file unified patch, ignoring the `---`/`+++` headers. */
export function patchStats(patch: string): PatchStats {
  let additions = 0;
  let deletions = 0;
  let lines = 0;
  let inHunk = false;
  let deleted = false;
  let binary = false;
  let start = 0;
  while (start < patch.length) {
    let end = patch.indexOf("\n", start);
    if (end < 0) end = patch.length;
    const c = patch.charCodeAt(start);
    if (inHunk) {
      if (c === 43 /* + */) additions++;
      else if (c === 45 /* - */) deletions++;
      if (c === 43 || c === 45 || c === 32 /* space */ || c === 64 /* @ */) lines++;
      else if (c === 100 /* d */ && patch.startsWith("diff ", start)) inHunk = false;
    } else if (c === 64 && patch.startsWith("@@", start)) {
      inHunk = true;
      lines++;
    } else if (patch.startsWith("deleted file mode", start)) {
      deleted = true;
    } else if (patch.startsWith("Binary files", start) || patch.startsWith("GIT binary patch", start)) {
      binary = true;
    }
    start = end + 1;
  }
  return { additions, deletions, lines, deleted, binary };
}
