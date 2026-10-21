// App-wide transient messages.

import { createStore, type ReadStore } from "./store";

export interface Toast {
  readonly id: number;
  readonly message: string;
  readonly tone: "info" | "error";
}

const store = createStore<readonly Toast[]>([]);
export const toasts: ReadStore<readonly Toast[]> = store;
let next = 1;

export function toast(message: string, tone: Toast["tone"] = "info"): void {
  const id = next++;
  store.update((t) => [...t.slice(-3), { id, message, tone }]);
  setTimeout(() => dismissToast(id), tone === "error" ? 7000 : 3500);
}

export function dismissToast(id: number): void {
  store.update((t) => t.filter((x) => x.id !== id));
}
