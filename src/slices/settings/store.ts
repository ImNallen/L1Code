// Owns the app-wide settings value. It is not per workspace, so it lives in its own localStorage key
// rather than the session blob.

import { createStore, useStore, type ReadStore } from "@/core/store";
import { parseSettings, type Settings } from "./model";

const KEY = "l1code.settings";

function readStored(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

const store = createStore<Settings>(parseSettings(readStored()));
export const settingsState: ReadStore<Settings> = store;

export function setSetting<K extends keyof Settings>(key: K, value: Settings[K]): void {
  if (store.get()[key] === value) return;
  store.update((s) => ({ ...s, [key]: value }));
  localStorage.setItem(KEY, JSON.stringify(store.get()));
}

export function useSetting<K extends keyof Settings>(key: K): Settings[K] {
  return useStore(store, (s) => s[key]);
}
