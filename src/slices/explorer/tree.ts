// Owns the workspace path index and the @pierre/trees model, which is a projection of it.
// The model is created once per workspace and survives view switches. Watcher batches update
// the index and the model in one step.

import { FileTree, prepareFileTreeInput, type FileTreeBatchOperation, type GitStatusEntry } from "@pierre/trees";
import { errorMessage, rust, type FsBatch, type GitStatus } from "@/core/ipc";
import { createStore, type ReadStore } from "@/core/store";
import { toast } from "@/core/toast";
import { editor } from "@/slices/editor";

export interface ExplorerState {
  readonly status: "idle" | "loading" | "ready" | "failed";
  /** Bumps whenever the path index changes; quick open keys its cache on it. */
  readonly gen: number;
  readonly fileCount: number;
}

const store = createStore<ExplorerState>({ status: "idle", gen: 0, fileCount: 0 });
export const explorerState: ReadStore<ExplorerState> = store;

/** Canonical paths; directories end with "/". The only path index in the app. */
let paths = new Set<string>();
let files: string[] = [];
let model: FileTree | null = null;
/** A row added by "New File/Folder" that becomes real only when its rename is confirmed. */
let pendingNew: { path: string; dir: boolean } | null = null;

/** The filter typed above the tree. The model hides every row that doesn't match it. */
const filterStore = createStore("");
export const explorerFilter: ReadStore<string> = filterStore;

export function setFilter(value: string): void {
  filterStore.set(value);
  model?.setSearch(value || null);
}

/** The first file the filter matches, for Enter in the filter box. */
export function firstMatch(): string | null {
  const hit = model?.getSearchMatchingPaths().find((p) => !isDirPath(p));
  return hit ? stripSlash(hit) : null;
}

export function treeModel(): FileTree | null {
  return model;
}

export function filePaths(): readonly string[] {
  return files;
}

export async function load(): Promise<void> {
  store.update((s) => ({ ...s, status: s.status === "ready" ? "ready" : "loading" }));
  let raw: string;
  try {
    raw = await rust.fsList();
  } catch (e) {
    store.update((s) => ({ ...s, status: "failed" }));
    toast(`Couldn't list files: ${errorMessage(e)}`, "error");
    return;
  }
  const list = raw ? raw.split("\n") : [];
  paths = new Set(list);
  const preparedInput = prepareFileTreeInput(list);
  if (model) {
    model.resetPaths({ preparedInput });
    if (filterStore.get()) model.setSearch(filterStore.get());
  } else {
    model = new FileTree({
      preparedInput,
      flattenEmptyDirectories: true,
      initialExpansion: "closed",
      fileTreeSearchMode: "hide-non-matches",
      initialSearchQuery: filterStore.get() || null,
      stickyFolders: true,
      density: "compact",
      composition: { contextMenu: { enabled: true, triggerMode: "right-click" } },
      onSelectionChange: (selected) => {
        const only = selected.length === 1 ? selected[0] : undefined;
        if (only && !isDirPath(only)) void editor.open(stripSlash(only), { focus: false });
      },
      renaming: {
        onRename: (e) => void commitRename(e.sourcePath, e.destinationPath, e.isFolder),
        onError: (msg) => toast(msg, "error"),
      },
      unsafeCSS: TREE_CSS,
    });
  }
  updateFiles();
}

export function dispose(): void {
  model?.cleanUp();
  model = null;
  paths = new Set();
  files = [];
  filterStore.set("");
  store.set({ status: "idle", gen: 0, fileCount: 0 });
}

let reloadTimer: ReturnType<typeof setTimeout> | undefined;
function scheduleReload() {
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(() => void load(), 250);
}

/** Applies a watcher batch to the index and the model together. */
export function applyFsBatch(batch: FsBatch): void {
  if (!model) return;
  if (batch.overflow) return scheduleReload();
  const ops: FileTreeBatchOperation[] = [];
  for (const c of batch.changes) {
    const file = c.path;
    const dir = c.path + "/";
    if (c.exists) {
      if (c.isDir) {
        // A folder that appears may arrive with its contents unreported (e.g. moved in): re-list.
        if (!paths.has(dir)) return scheduleReload();
      } else if (!paths.has(file)) {
        paths.add(file);
        ops.push({ type: "add", path: file });
      }
    } else if (paths.has(file)) {
      paths.delete(file);
      ops.push({ type: "remove", path: file });
    } else if (paths.has(dir)) {
      for (const p of [...paths]) if (p.startsWith(dir)) paths.delete(p);
      paths.delete(dir);
      ops.push({ type: "remove", path: dir, recursive: true });
    }
  }
  if (!ops.length) return;
  try {
    model.batch(ops);
  } catch {
    return scheduleReload();
  }
  updateFiles();
}

export function applyGitStatus(status: GitStatus | null): void {
  if (!model) return;
  const entries: GitStatusEntry[] = [];
  for (const f of status?.files ?? []) {
    const kind = f.unstaged ?? f.staged;
    if (!kind) continue;
    const mapped = kind === "conflicted" ? "modified" : kind;
    if (paths.has(f.path)) entries.push({ path: f.path, status: mapped });
  }
  model.setGitStatus(entries);
}

/** Expands the ancestors of `path` and scrolls it into view without opening anything. */
export function reveal(path: string): void {
  if (!model || !paths.has(path)) return;
  const parts = path.split("/");
  for (let i = 1; i < parts.length; i++) {
    const dir = parts.slice(0, i).join("/") + "/";
    const item = dirHandle(model.getItem(dir) ?? model.getItem(dir.slice(0, -1)));
    if (item && !item.isExpanded()) item.expand();
  }
  model.scrollToPath(path, { focus: false, offset: "nearest" });
}

/** Adds a placeholder row under `parent` and starts renaming it. Confirming creates it on disk. */
export function startCreate(parent: string | null, dir: boolean): void {
  if (!model) return;
  const base = parent ? stripSlash(parent) + "/" : "";
  let name = dir ? "new-folder" : "untitled";
  for (let i = 2; paths.has(base + name) || paths.has(base + name + "/"); i++) name = `${dir ? "new-folder" : "untitled"}-${i}`;
  const path = base + name + (dir ? "/" : "");
  pendingNew = { path: stripSlash(path), dir };
  if (parent) {
    dirHandle(model.getItem(parent) ?? model.getItem(stripSlash(parent) + "/"))?.expand();
  }
  model.add(path);
  model.startRenaming(path, { removeIfCanceled: true });
}

export function startRename(path: string): void {
  model?.startRenaming(path);
}

export async function remove(path: string): Promise<void> {
  try {
    await rust.fsDelete(stripSlash(path));
  } catch (e) {
    toast(`Delete failed: ${errorMessage(e)}`, "error");
  }
  // The watcher reports the removal; the index updates from there.
}

async function commitRename(source: string, dest: string, isFolder: boolean): Promise<void> {
  const from = stripSlash(source);
  const to = stripSlash(dest);
  if (pendingNew && pendingNew.path === from) {
    const dir = pendingNew.dir;
    pendingNew = null;
    try {
      await rust.fsCreate(to, dir);
      paths.add(dir ? to + "/" : to);
      updateFiles();
      if (!dir) void editor.open(to);
    } catch (e) {
      model?.remove(dest, { recursive: true });
      toast(`Couldn't create ${to}: ${errorMessage(e)}`, "error");
    }
    return;
  }
  try {
    await rust.fsRename(from, to);
  } catch (e) {
    model?.move(dest, source);
    toast(`Rename failed: ${errorMessage(e)}`, "error");
    return;
  }
  // Keep the index in step with the model so the watcher's echo is a no-op.
  if (isFolder) {
    const prefix = from + "/";
    for (const p of [...paths]) {
      if (p.startsWith(prefix)) {
        paths.delete(p);
        paths.add(to + "/" + p.slice(prefix.length));
      }
    }
  } else {
    paths.delete(from);
    paths.add(to);
  }
  updateFiles();
  editor.moved(from, to, isFolder);
}

function updateFiles() {
  files = [...paths].filter((p) => !p.endsWith("/"));
  store.update((s) => ({ status: "ready", gen: s.gen + 1, fileCount: files.length }));
}

type ItemHandle = ReturnType<FileTree["getItem"]>;
type DirHandle = Extract<NonNullable<ItemHandle>, { expand(): void }>;

function dirHandle(item: ItemHandle): DirHandle | null {
  return item && "expand" in item ? (item as DirHandle) : null;
}

function isDirPath(p: string) {
  return p.endsWith("/") || paths.has(p + "/");
}

function stripSlash(p: string) {
  return p.endsWith("/") ? p.slice(0, -1) : p;
}

const TREE_CSS = `:host { color-scheme: dark; }`;
