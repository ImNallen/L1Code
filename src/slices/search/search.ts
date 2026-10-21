// Search state and the only code that runs searches. Each run gets a new `runId`; hits from an
// older run are dropped in the channel callback, so a fast typist never sees mixed results.

import { channel, errorMessage, rust, type FileHits, type SearchQuery, type SearchSummary } from "@/core/ipc";
import type { PersistSpec } from "@/core/slice";
import { createStore, type ReadStore } from "@/core/store";

export type { FileHits, Hit, SearchQuery, SearchSummary } from "@/core/ipc";

export interface SearchState {
  readonly query: SearchQuery;
  readonly results: readonly FileHits[];
  readonly summary: SearchSummary | null;
  readonly running: boolean;
  readonly error: string | null;
  readonly runId: number;
}

const DEBOUNCE_MS = 200;

const store = createStore<SearchState>({
  query: { pattern: "", regex: false, caseSensitive: false, wholeWord: false },
  results: [],
  summary: null,
  running: false,
  error: null,
  runId: 0,
});
export const searchState: ReadStore<SearchState> = store;

let timer: ReturnType<typeof setTimeout> | undefined;
let pending: FileHits[] = [];
let frame = 0;

/** Changes the query. Typing runs the search after a short pause; `immediate` runs it now. */
export function setQuery(patch: Partial<SearchQuery>, immediate = false): void {
  store.update((s) => ({ ...s, query: { ...s.query, ...patch } }));
  clearTimeout(timer);
  if (immediate) void runSearch();
  else timer = setTimeout(() => void runSearch(), DEBOUNCE_MS);
}

function flush(runId: number) {
  cancelAnimationFrame(frame);
  frame = 0;
  if (pending.length === 0 || store.get().runId !== runId) return;
  const batch = pending;
  pending = [];
  store.update((s) => ({ ...s, results: [...s.results, ...batch] }));
}

/** Runs the current query now, superseding any search in flight. An empty pattern clears. */
export async function runSearch(): Promise<void> {
  clearTimeout(timer);
  cancelAnimationFrame(frame);
  frame = 0;
  pending = [];
  const prev = store.get();
  const runId = prev.runId + 1;
  const query = prev.query;

  if (!query.pattern) {
    if (prev.running) rust.searchCancel().catch(() => {});
    store.set({ ...prev, results: [], summary: null, running: false, error: null, runId });
    return;
  }

  store.set({ ...prev, results: [], summary: null, running: true, error: null, runId });
  const onHits = channel<FileHits[]>((files) => {
    if (store.get().runId !== runId) return;
    pending.push(...files);
    if (!frame) frame = requestAnimationFrame(() => flush(runId));
  });
  try {
    const summary = await rust.searchText(query, onHits);
    if (store.get().runId !== runId) return;
    flush(runId);
    store.update((s) => ({ ...s, summary, running: false }));
  } catch (e) {
    if (store.get().runId !== runId) return;
    flush(runId);
    store.update((s) => ({ ...s, running: false, error: errorMessage(e) }));
  }
}

export const sessionSpec: PersistSpec<{ query: SearchQuery }> = {
  key: "search",
  snapshot: () => ({ query: store.get().query }),
  decode(raw) {
    if (!raw || typeof raw !== "object") return undefined;
    const q = (raw as { query?: unknown }).query as Partial<Record<keyof SearchQuery, unknown>> | undefined;
    if (!q || typeof q !== "object" || typeof q.pattern !== "string") return undefined;
    return {
      query: {
        pattern: q.pattern,
        regex: q.regex === true,
        caseSensitive: q.caseSensitive === true,
        wholeWord: q.wholeWord === true,
      },
    };
  },
  restore({ query }) {
    setQuery(query, true);
  },
  subscribe(listener) {
    let prev = store.get().query;
    return store.subscribe(() => {
      const next = store.get().query;
      if (next === prev) return;
      prev = next;
      listener();
    });
  },
};
