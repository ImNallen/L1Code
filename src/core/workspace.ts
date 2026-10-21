// Owns which folder is open and the watcher stream for it. Slices subscribe to file changes here
// instead of each building their own watcher.

import { listen } from "@tauri-apps/api/event";
import { channel, rust, type FsBatch, type WorkspaceInfo } from "./ipc";
import { createStore, type ReadStore } from "./store";

export type WorkspaceState =
  | { readonly status: "none" }
  | { readonly status: "opening"; readonly path: string }
  | { readonly status: "open"; readonly info: WorkspaceInfo }
  | { readonly status: "failed"; readonly path: string; readonly message: string };

const state = createStore<WorkspaceState>({ status: "none" });
export const workspaceState: ReadStore<WorkspaceState> = state;

const fsListeners = new Set<(batch: FsBatch) => void>();

/** Called for every watcher batch of the open workspace. Returns an unsubscribe function. */
export function onFsBatch(listener: (batch: FsBatch) => void): () => void {
  fsListeners.add(listener);
  return () => fsListeners.delete(listener);
}

/** Opens `path` as the workspace. Resolves with the info, or throws if it is not a folder. */
export async function openWorkspace(path: string): Promise<WorkspaceInfo> {
  state.set({ status: "opening", path });
  try {
    const onFs = channel<FsBatch>((batch) => fsListeners.forEach((l) => l(batch)));
    const info = await rust.workspaceOpen(path, onFs);
    rememberRecent(info.root);
    state.set({ status: "open", info });
    return info;
  } catch (e) {
    state.set({ status: "failed", path, message: e instanceof Error ? e.message : String(e) });
    throw e;
  }
}

export function currentRoot(): string | null {
  const s = state.get();
  return s.status === "open" ? s.info.root : null;
}

const RECENT_KEY = "l1code.recent";

export function recentWorkspaces(): string[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function rememberRecent(root: string) {
  const next = [root, ...recentWorkspaces().filter((r) => r !== root)].slice(0, 12);
  localStorage.setItem(RECENT_KEY, JSON.stringify(next));
}

/** Paths handed to us from the command line: once at launch, then from later `l1code <path>` runs. */
export async function onLaunchPath(handler: (absPath: string) => void): Promise<() => void> {
  const initial = await rust.appInitialPath();
  if (initial) handler(initial);
  return listen<string>("open-path", (e) => handler(e.payload));
}
