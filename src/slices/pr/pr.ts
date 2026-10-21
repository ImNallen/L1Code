// Owns the pull request lookup for the current branch. It runs in the background while a workspace
// is open, so the Pull Request tab can appear as soon as a PR exists.

import { errorMessage, rust, type PrLookup } from "@/core/ipc";
import { createStore, derive, watch, type ReadStore } from "@/core/store";
import { scm } from "@/slices/scm";

export interface PrState {
  /** The branch the result belongs to. */
  readonly branch: string | null;
  readonly lookup: PrLookup | null;
  readonly loading: boolean;
  readonly error: string | null;
}

const store = createStore<PrState>({ branch: null, lookup: null, loading: false, error: null });
export const prState: ReadStore<PrState> = store;

/** True when the current branch has a pull request. A branch switch clears `lookup` until reloaded. */
export const prAvailable = derive(store, (s) => s.lookup?.kind === "found");

const REFRESH_MS = 60_000;
let latest = 0;

function currentBranch(): string | null {
  return scm.state.get().status?.branch ?? null;
}

export async function load(): Promise<void> {
  const branch = currentBranch();
  const id = ++latest;
  store.update((s) => (s.branch === branch ? { ...s, loading: true } : { branch, lookup: null, loading: true, error: null }));
  try {
    const lookup = await rust.ghPrView();
    if (id === latest) store.set({ branch, lookup, loading: false, error: null });
  } catch (e) {
    if (id === latest) store.update((s) => ({ ...s, loading: false, error: errorMessage(e) }));
  }
}

/** Query once git status is known, again on every branch change, every minute, and on focus. */
export function activate(): () => void {
  const ready = () => scm.state.get().gen > 0;
  const offBranch = watch(
    scm.state,
    (s) => (s.gen > 0 ? (s.status?.branch ?? "") : null),
    (branch) => branch !== null && void load(),
  );
  if (ready()) void load();
  const timer = setInterval(() => ready() && void load(), REFRESH_MS);
  const onFocus = () => ready() && void load();
  window.addEventListener("focus", onFocus);
  return () => {
    offBranch();
    clearInterval(timer);
    window.removeEventListener("focus", onFocus);
  };
}
