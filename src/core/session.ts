// Per-workspace session storage. The shell composes slices' PersistSpecs into one blob per root.

import type { PersistSpec } from "./slice";

const PREFIX = "l1code.session:";

export function loadSession(root: string): Record<string, unknown> {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(PREFIX + root) ?? "{}");
    return raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Restores every spec from the saved blob, then keeps the blob up to date. Returns a cleanup. */
export async function bindSession(root: string, specs: readonly PersistSpec<unknown>[]): Promise<() => void> {
  const saved = loadSession(root);
  for (const spec of specs) {
    const value = spec.decode(saved[spec.key]);
    if (value !== undefined) await spec.restore(value);
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const write = () => {
    clearTimeout(timer);
    timer = undefined;
    const blob: Record<string, unknown> = {};
    for (const spec of specs) blob[spec.key] = spec.snapshot();
    localStorage.setItem(PREFIX + root, JSON.stringify(blob));
  };
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(write, 300);
  };
  const unsubs = specs.map((s) => s.subscribe(schedule));
  window.addEventListener("beforeunload", write);
  return () => {
    write();
    unsubs.forEach((u) => u());
    window.removeEventListener("beforeunload", write);
  };
}
