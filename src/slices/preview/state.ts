// Preview state: the URL shown in the iframe and a reload counter. The only writer of both.

import { reveal } from "@/core/reveal";
import type { PersistSpec } from "@/core/slice";
import { createStore, type ReadStore } from "@/core/store";

export interface PreviewState {
  readonly url: string;
  /** Bumped to force the iframe to reload the same URL. */
  readonly reloadKey: number;
}

const store = createStore<PreviewState>({ url: "", reloadKey: 0 });
export const previewState: ReadStore<PreviewState> = store;

const LOCAL_HOST = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?=[:/?#]|$)/i;

/** Expands shorthand: `3000` and `:3000` become `http://localhost:3000`; bare hosts get a scheme. */
export function normalizeUrl(input: string): string {
  const s = input.trim();
  if (!s) return "";
  if (/^\d{1,5}$/.test(s)) return `http://localhost:${s}`;
  if (/^:\d{1,5}/.test(s)) return `http://localhost${s}`;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s) || /^(about|data):/i.test(s)) return s;
  if (LOCAL_HOST.test(s)) return `http://${s}`;
  return `https://${s}`;
}

export function navigate(input: string): void {
  const url = normalizeUrl(input);
  store.update((s) => (url === s.url ? { url, reloadKey: s.reloadKey + 1 } : { ...s, url }));
}

export function reload(): void {
  store.update((s) => ({ ...s, reloadKey: s.reloadKey + 1 }));
}

export function openPreview(url: string): void {
  navigate(url);
  reveal("preview");
}

export const sessionSpec: PersistSpec<{ url: string }> = {
  key: "preview",
  snapshot: () => ({ url: store.get().url }),
  decode(raw) {
    if (!raw || typeof raw !== "object") return undefined;
    const url = (raw as { url?: unknown }).url;
    return typeof url === "string" ? { url } : undefined;
  },
  restore({ url }) {
    store.update((s) => ({ ...s, url }));
  },
  subscribe(listener) {
    let prev = store.get().url;
    return store.subscribe(() => {
      const next = store.get().url;
      if (next === prev) return;
      prev = next;
      listener();
    });
  },
};
