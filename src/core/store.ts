// Tiny external store. Each slice creates its own stores and keeps the writable handle
// module-private, exporting only `ReadStore` or hooks. That makes every piece of state single-writer
// by module scope: no global store, no second writer to forget about.

import { useCallback, useRef, useSyncExternalStore } from "react";

export interface ReadStore<T> {
  get(): T;
  subscribe(listener: () => void): () => void;
}

export interface Store<T> extends ReadStore<T> {
  set(next: T): void;
  update(fn: (prev: T) => T): void;
}

export function createStore<T>(initial: T): Store<T> {
  let value = initial;
  const listeners = new Set<() => void>();
  const set = (next: T) => {
    if (Object.is(next, value)) return;
    value = next;
    for (const l of [...listeners]) l();
  };
  return {
    get: () => value,
    set,
    update: (fn) => set(fn(value)),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** Subscribe a component to a store, or to a selection of it. `equal` defaults to `Object.is`. */
export function useStore<T>(store: ReadStore<T>): T;
export function useStore<T, U>(store: ReadStore<T>, select: (t: T) => U, equal?: (a: U, b: U) => boolean): U;
export function useStore<T, U>(store: ReadStore<T>, select?: (t: T) => U, equal: (a: U, b: U) => boolean = Object.is): T | U {
  const last = useRef<{ src: T; out: U } | null>(null);
  const getSnapshot = useCallback(() => {
    const src = store.get();
    if (!select) return src;
    const prev = last.current;
    if (prev && prev.src === src) return prev.out;
    const out = select(src);
    if (prev && equal(prev.out, out)) {
      last.current = { src, out: prev.out };
      return prev.out;
    }
    last.current = { src, out };
    return out;
    // The selector is treated as stable per call site; callers pass inline lambdas.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store]);
  return useSyncExternalStore(store.subscribe, getSnapshot);
}

/** A read-only view of `select(source)`. It notifies only when the selected value changes. */
export function derive<T, U>(source: ReadStore<T>, select: (t: T) => U, equal: (a: U, b: U) => boolean = Object.is): ReadStore<U> {
  let value = select(source.get());
  return {
    get() {
      const next = select(source.get());
      if (!equal(next, value)) value = next;
      return value;
    },
    subscribe(listener) {
      return source.subscribe(() => {
        const next = select(source.get());
        if (equal(next, value)) return;
        value = next;
        listener();
      });
    },
  };
}

/** Calls `listener` when the selected value changes. Returns an unsubscribe function. */
export function watch<T, U>(store: ReadStore<T>, select: (t: T) => U, listener: (next: U, prev: U) => void): () => void {
  let prev = select(store.get());
  return store.subscribe(() => {
    const next = select(store.get());
    if (Object.is(next, prev)) return;
    const old = prev;
    prev = next;
    listener(next, old);
  });
}

export function shallowEqual<T>(a: readonly T[], b: readonly T[]): boolean {
  return a.length === b.length && a.every((x, i) => Object.is(x, b[i]));
}
