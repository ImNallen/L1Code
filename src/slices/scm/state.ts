// The git domain: one status snapshot, one refresh entry point, and the path the user focused.
// Writable stores stay in this module; index.ts exposes read-only views.

import { reveal } from "@/core/reveal";
import { errorMessage, rust, type GitFile, type GitStatus } from "@/core/ipc";
import { createStore, useStore, type ReadStore } from "@/core/store";
import { onFsBatch } from "@/core/workspace";
import { toast } from "@/core/toast";

export interface ScmState {
  /** null means the workspace is not a git repository (or nothing has loaded yet, see `gen`). */
  readonly status: GitStatus | null;
  /** Bumps after every completed refresh. Use it as a staleness key. */
  readonly gen: number;
  readonly refreshing: boolean;
  readonly error: string | null;
}

const store = createStore<ScmState>({ status: null, gen: 0, refreshing: false, error: null });
export const scmState: ReadStore<ScmState> = store;
export const useScmState = (): ScmState => useStore(store);

// ---------- refresh: debounced, single-flight, one trailing run ----------

const DEBOUNCE_MS = 150;
let timer: ReturnType<typeof setTimeout> | null = null;
let running = false;
let again = false;

export function refresh(): void {
  if (running) {
    again = true;
    return;
  }
  if (timer) clearTimeout(timer);
  timer = setTimeout(run, DEBOUNCE_MS);
}

async function run(): Promise<void> {
  timer = null;
  running = true;
  if (!store.get().refreshing) store.update((s) => ({ ...s, refreshing: true }));
  try {
    const status = await rust.gitStatus();
    store.update((s) => ({ status, gen: s.gen + 1, refreshing: s.refreshing, error: null }));
  } catch (e) {
    const error = errorMessage(e);
    // Toast a new failure once; refreshes on focus would repeat it.
    if (store.get().error !== error) toast(`Couldn't read git status: ${error}`, "error");
    store.update((s) => ({ ...s, gen: s.gen + 1, error }));
  } finally {
    running = false;
    if (again) {
      again = false;
      timer = setTimeout(run, DEBOUNCE_MS);
    } else {
      store.update((s) => ({ ...s, refreshing: false }));
    }
  }
}

export function activate(): () => void {
  refresh();
  const offFs = onFsBatch(() => refresh());
  const onFocus = () => refresh();
  window.addEventListener("focus", onFocus);
  return () => {
    offFs();
    window.removeEventListener("focus", onFocus);
    if (timer) clearTimeout(timer);
    timer = null;
  };
}

// ---------- focus: the file whose diff the Changes tool should show ----------

/** `seq` bumps on every request so clicking the same file twice scrolls again. */
export interface Focus {
  readonly path: string | null;
  readonly seq: number;
}

const focus = createStore<Focus>({ path: null, seq: 0 });
export const focusStore: ReadStore<Focus> = focus;
export const useFocusedPath = (): string | null => useStore(focus, (f) => f.path);

export function showChanges(path: string): void {
  focus.update((f) => ({ path, seq: f.seq + 1 }));
  reveal("changes");
}

// ---------- derived views ----------

export function useChangedCount(): number | null {
  return useStore(store, (s) => (s.status && s.status.files.length > 0 ? s.status.files.length : null));
}

export interface Groups {
  readonly staged: readonly GitFile[];
  /** Unstaged, untracked, and conflicted. */
  readonly changes: readonly GitFile[];
}

const isConflict = (f: GitFile) => f.staged === "conflicted" || f.unstaged === "conflicted";

export function groupFiles(files: readonly GitFile[]): Groups {
  const staged: GitFile[] = [];
  const changes: GitFile[] = [];
  for (const f of files) {
    if (isConflict(f)) {
      changes.push(f);
      continue;
    }
    if (f.staged) staged.push(f);
    if (f.unstaged) changes.push(f);
  }
  return { staged, changes };
}

// ---------- mutations: report failures as toasts, then refresh ----------

async function mutate(label: string, fn: () => Promise<unknown>): Promise<boolean> {
  try {
    await fn();
    return true;
  } catch (e) {
    toast(`${label} failed: ${errorMessage(e)}`, "error");
    return false;
  } finally {
    refresh();
  }
}

export const stage = (paths: string[]) => (paths.length ? mutate("Stage", () => rust.gitStage(paths)) : Promise.resolve(true));
export const unstage = (paths: string[]) => (paths.length ? mutate("Unstage", () => rust.gitUnstage(paths)) : Promise.resolve(true));
export const discard = (paths: string[], untracked: string[]) =>
  paths.length || untracked.length ? mutate("Discard", () => rust.gitDiscard(paths, untracked)) : Promise.resolve(true);
export const commit = (message: string, stageAll: boolean) => mutate("Commit", () => rust.gitCommit(message, stageAll));

// The draft commit message survives the Changes tool unmounting.
const message = createStore("");
export const useCommitMessage = (): string => useStore(message);
export const setCommitMessage = (m: string): void => message.set(m);
