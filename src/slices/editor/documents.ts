// Owns open documents and tabs: drafts, disk baselines, save, and external-change reconciliation.
//
// Invariants:
// - A Doc's `state` (CodeMirror EditorState) is the only copy of its draft. The single mounted
//   EditorView renders it, and every view transaction is committed back here in the same tick.
// - All disk I/O for a path (open, save, reconcile) runs one at a time through `enqueue(path)`.
//   A watcher event for our own save therefore reconciles after the save set the new baseline,
//   sees an equal hash, and does nothing. No timing windows, no "ignore next event" flags.
// - Saves are compare-and-swap writes against `baseline.hash`, so we never overwrite a change we
//   haven't seen.

import { EditorSelection, EditorState, type StateEffect, type Text, type TransactionSpec, type Transaction } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { message } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { errorMessage, rust, type ReadResult, type WriteExpect } from "@/core/ipc";
import { createStore, useStore, watch, type ReadStore } from "@/core/store";
import type { PersistSpec } from "@/core/slice";
import { toast } from "@/core/toast";
import { onFsBatch } from "@/core/workspace";
import { appearance, settings } from "@/slices/settings";
import { baseExtensions, languageSlot, lineWrapping, loadLanguage, schemeFlag, schemeSlot, wrapSlot } from "./extensions";
import { baselineOf, decideReconcile, isDirty, type Baseline, type DiskState, type ReconcileDecision } from "./reconcile";

export interface Doc {
  readonly path: string;
  readonly state: EditorState;
  readonly baseline: Baseline;
  readonly disk: DiskState;
  readonly saving: boolean;
  /** Captured when the tab is hidden, applied when it is shown again. */
  readonly scroll: StateEffect<unknown> | null;
  /** Scroll the cursor into view the next time this doc is shown. */
  readonly reveal: boolean;
  /** Give the editor keyboard focus the next time this doc is shown. */
  readonly focus: boolean;
}

export interface DocsState {
  /** Open docs in tab order. The open set and the tab order are one list, so they can't disagree. */
  readonly open: readonly Doc[];
  readonly active: string | null;
}

const store = createStore<DocsState>({ open: [], active: null });
export const docsState: ReadStore<DocsState> = store;

export function docDirty(doc: Doc): boolean {
  return isDirty({ draft: doc.state.doc, baseline: doc.baseline, disk: doc.disk });
}

// ---------------------------------------------------------------------------------------------
// Runtime coordination (not app state)

const queues = new Map<string, Promise<unknown>>();

function enqueue<T>(path: string, task: () => Promise<T>): Promise<T> {
  const prev = queues.get(path) ?? Promise.resolve();
  const next = prev.catch(() => undefined).then(task);
  queues.set(path, next);
  void next.finally(() => {
    if (queues.get(path) === next) queues.delete(path);
  }).catch(() => undefined);
  return next;
}

/** The single mounted EditorView and the doc it renders. Set only through `bindView`. */
let bound: { view: EditorView; path: string | null } | null = null;

const emptyState = EditorState.create({ doc: "", extensions: [EditorState.readOnly.of(true), EditorView.editable.of(false)] });

// ---------------------------------------------------------------------------------------------
// Public API

export interface OpenOptions {
  /** 1-based line. */
  line?: number;
  /** 1-based column. */
  column?: number;
  /** Open without activating (session restore). */
  background?: boolean;
  /** Move keyboard focus into the editor. Default true; the explorer passes false. */
  focus?: boolean;
}

export function openDocument(path: string, opts: OpenOptions = {}): Promise<boolean> {
  if (find(path)) {
    show(path, opts);
    return Promise.resolve(true);
  }
  return enqueue(path, async () => {
    if (find(path)) {
      show(path, opts);
      return true;
    }
    let read: ReadResult;
    try {
      read = await rust.fsRead(path);
    } catch (e) {
      toast(`Can't open ${path}: ${errorMessage(e)}`, "error");
      return false;
    }
    if (read.kind !== "text") {
      const why = read.kind === "binary" ? "is a binary file" : read.kind === "tooLarge" ? "is larger than 10 MB" : "doesn't exist";
      if (!opts.background) toast(`${path} ${why}.`, "error");
      return false;
    }
    const baseline = baselineOf(read);
    const state = EditorState.create({ doc: baseline.text, extensions: baseExtensions() });
    const doc: Doc = { path, state, baseline: { ...baseline, text: state.doc }, disk: { kind: "synced" }, saving: false, scroll: null, reveal: false, focus: false };
    store.update((s) => {
      const at = s.active ? s.open.findIndex((d) => d.path === s.active) + 1 : s.open.length;
      const open = [...s.open.slice(0, at), doc, ...s.open.slice(at)];
      return { open, active: opts.background ? (s.active ?? path) : path };
    });
    if (opts.line) placeCursor(path, opts.line, opts.column ?? 1);
    if (!opts.background && opts.focus !== false) requestFocus(path);
    void loadLanguage(path).then((lang) => {
      if (lang && find(path)) transact(path, { effects: languageSlot.reconfigure(lang) });
    });
    return true;
  });
}

export function saveDocument(path?: string): Promise<void> {
  const p = path ?? store.get().active;
  if (!p) return Promise.resolve();
  return enqueue(p, async () => {
    const doc = find(p);
    if (!doc || (!docDirty(doc) && doc.disk.kind === "synced")) return;
    if (doc.disk.kind === "changed") {
      toast(`${p} changed on disk. Choose "Keep mine" or "Take disk" first.`, "error");
      return;
    }
    const snapshot: Text = doc.state.doc;
    const expect: WriteExpect = doc.disk.kind === "deleted" ? { kind: "absent" } : { kind: "hash", hash: doc.baseline.hash };
    patch(p, { saving: true });
    try {
      const res = await rust.fsWrite(p, snapshot.toString(), doc.baseline.bom, doc.baseline.crlf, expect);
      if (res.kind === "written") {
        patch(p, { saving: false, disk: { kind: "synced" }, baseline: { ...doc.baseline, text: snapshot, hash: res.hash } });
      } else {
        patch(p, { saving: false });
        // Someone wrote between our last look and this save: surface it, never clobber.
        await reconcileNow(p);
      }
    } catch (e) {
      patch(p, { saving: false });
      toast(`Save failed for ${p}: ${errorMessage(e)}`, "error");
    }
  });
}

export async function saveAll(): Promise<void> {
  await Promise.all(store.get().open.filter(docDirty).map((d) => saveDocument(d.path)));
}

export async function closeDocument(path: string): Promise<boolean> {
  const doc = find(path);
  if (!doc) return true;
  if (docDirty(doc)) {
    const choice = await askToSave(`Save changes to ${basename(path)}?`);
    if (choice === "cancel") return false;
    if (choice === "save") {
      await saveDocument(path);
      const after = find(path);
      if (after && docDirty(after)) return false;
    }
  }
  store.update((s) => {
    const i = s.open.findIndex((d) => d.path === path);
    if (i < 0) return s;
    const open = s.open.filter((d) => d.path !== path);
    const active = s.active === path ? (open[i] ?? open[i - 1] ?? null)?.path ?? null : s.active;
    return { open, active };
  });
  return true;
}

export function closeActive(): void {
  const a = store.get().active;
  if (a) void closeDocument(a);
}

export async function closeAllDocuments(): Promise<boolean> {
  const dirty = store.get().open.filter(docDirty);
  if (dirty.length) {
    const names = dirty.map((d) => basename(d.path)).join(", ");
    const choice = await askToSave(`Save changes to ${dirty.length} file${dirty.length > 1 ? "s" : ""}?\n${names}`);
    if (choice === "cancel") return false;
    if (choice === "save") {
      await saveAll();
      if (store.get().open.some(docDirty)) return false;
    }
  }
  store.set({ open: [], active: null });
  return true;
}

export function cycleTab(step: number): void {
  const { open, active } = store.get();
  if (open.length < 2) return;
  const i = open.findIndex((d) => d.path === active);
  const next = open[(i + step + open.length) % open.length];
  if (next) store.update((s) => ({ ...s, active: next.path }));
}

export function activateTab(path: string): void {
  if (find(path)) store.update((s) => ({ ...s, active: path }));
}

export function moveTab(path: string, toIndex: number): void {
  store.update((s) => {
    const doc = s.open.find((d) => d.path === path);
    if (!doc) return s;
    const rest = s.open.filter((d) => d.path !== path);
    rest.splice(Math.max(0, Math.min(toIndex, rest.length)), 0, doc);
    return { ...s, open: rest };
  });
}

export function moveDocuments(from: string, to: string, isDir: boolean): void {
  const retarget = (p: string) => (p === from ? to : isDir && p.startsWith(from + "/") ? to + p.slice(from.length) : null);
  store.update((s) => ({
    open: s.open.map((d) => {
      const next = retarget(d.path);
      return next ? { ...d, path: next } : d;
    }),
    active: s.active ? (retarget(s.active) ?? s.active) : null,
  }));
  if (bound?.path) bound.path = retarget(bound.path) ?? bound.path;
}

export function resolveConflict(path: string, choice: "keepMine" | "takeDisk"): void {
  const doc = find(path);
  if (!doc || doc.disk.kind !== "changed") return;
  const disk = doc.disk;
  if (choice === "keepMine") {
    patch(path, { baseline: { ...doc.baseline, text: disk.text, hash: disk.hash }, disk: { kind: "synced" } });
    return;
  }
  transact(path, { changes: { from: 0, to: doc.state.doc.length, insert: disk.text } });
  const after = find(path)!;
  patch(path, { baseline: { ...doc.baseline, text: after.state.doc, hash: disk.hash }, disk: { kind: "synced" } });
}

export function activePath(): string | null {
  return store.get().active;
}

export function useActivePath(): string | null {
  return useStore(store, (s) => s.active);
}

export function hasDirty(): boolean {
  return store.get().open.some(docDirty);
}

// ---------------------------------------------------------------------------------------------
// View binding (EditorPane only)

/** Called once by EditorPane. Returns the transaction hook the view must be created with. */
export function bindView(view: EditorView): { show(path: string | null): void; unbind(): void } {
  bound = { view, path: null };
  return {
    show(path) {
      if (!bound) return;
      if (bound.path && bound.path !== path && find(bound.path)) patch(bound.path, { scroll: view.scrollSnapshot() });
      const doc = path ? find(path) : undefined;
      if (!doc) {
        bound.path = null;
        view.setState(emptyState);
        return;
      }
      bound.path = doc.path;
      if (view.state !== doc.state) view.setState(doc.state);
      if (doc.reveal) {
        view.dispatch({ effects: EditorView.scrollIntoView(doc.state.selection.main.head, { y: "center" }) });
        patch(doc.path, { reveal: false, scroll: null });
      } else if (doc.scroll) {
        view.dispatch({ effects: doc.scroll });
      }
      if (doc.focus) {
        requestAnimationFrame(() => view.focus());
        patch(doc.path, { focus: false });
      }
    },
    unbind() {
      if (bound?.view === view) bound = null;
    },
  };
}

/** The view's `dispatchTransactions`: apply, then commit the new state back into the doc. */
export function dispatchFromView(trs: readonly Transaction[], view: EditorView): void {
  view.update(trs);
  if (bound?.view === view && bound.path) patch(bound.path, { state: view.state });
}

// ---------------------------------------------------------------------------------------------
// Workspace-facing

/** Re-check `path` against disk. Safe to call any number of times; queued behind saves. */
export function reconcile(path: string): Promise<void> {
  if (!find(path)) return Promise.resolve();
  return enqueue(path, () => reconcileNow(path));
}

async function reconcileNow(path: string): Promise<void> {
  if (!find(path)) return;
  let read: ReadResult;
  try {
    read = await rust.fsRead(path);
  } catch {
    return;
  }
  // Re-find: the draft may have changed during the read.
  const doc = find(path);
  if (doc) apply(doc, decideReconcile({ draft: doc.state.doc, baseline: doc.baseline, disk: doc.disk }, read));
}

export function reconcileAll(): Promise<void> {
  return Promise.all(store.get().open.map((d) => reconcile(d.path))).then(() => undefined);
}

/** Subscriptions that live while a workspace is open. */
export function activate(): () => void {
  const offFs = onFsBatch((batch) => {
    if (batch.overflow) {
      void reconcileAll();
      return;
    }
    const open = store.get().open;
    for (const change of batch.changes) {
      for (const d of open) {
        if (d.path === change.path || (!change.exists && d.path.startsWith(change.path + "/"))) void reconcile(d.path);
      }
    }
  });
  const onFocus = () => void reconcileAll();
  window.addEventListener("focus", onFocus);
  // The theme reads the font from CSS variables the settings slice paints; the view must remeasure lines.
  const offFont = watch(settings.state, (s) => `${s.editorFontSize}px ${s.editorFontFamily}`, () => bound?.view.requestMeasure());
  const offWrap = watch(settings.state, (s) => s.editorWordWrap, (on) => {
    const effects = wrapSlot.reconfigure(lineWrapping(on));
    for (const d of store.get().open) transact(d.path, { effects });
  });
  const offScheme = watch(appearance.state, (p) => p.scheme, (scheme) => {
    const effects = schemeSlot.reconfigure(schemeFlag(scheme));
    for (const d of store.get().open) transact(d.path, { effects });
  });
  const unlistenClose = getCurrentWindow().onCloseRequested(async (e) => {
    if (hasDirty() && !(await closeAllDocuments())) e.preventDefault();
  });
  return () => {
    offFs();
    offFont();
    offWrap();
    offScheme();
    window.removeEventListener("focus", onFocus);
    void unlistenClose.then((u) => u());
  };
}

// ---------------------------------------------------------------------------------------------
// Session

interface EditorSession {
  open: string[];
  active: string | null;
}

export const sessionSpec: PersistSpec<EditorSession> = {
  key: "editor",
  snapshot: () => ({ open: store.get().open.map((d) => d.path), active: store.get().active }),
  decode(raw) {
    if (!raw || typeof raw !== "object") return undefined;
    const r = raw as Partial<EditorSession>;
    if (!Array.isArray(r.open)) return undefined;
    return { open: r.open.filter((p): p is string => typeof p === "string").slice(0, 50), active: typeof r.active === "string" ? r.active : null };
  },
  async restore(value) {
    for (const p of value.open) await openDocument(p, { background: true });
    if (value.active) activateTab(value.active);
  },
  subscribe: (listener) => {
    const a = watch(store, (s) => s.open.map((d) => d.path).join("\n"), listener);
    const b = watch(store, (s) => s.active, listener);
    return () => {
      a();
      b();
    };
  },
};

// ---------------------------------------------------------------------------------------------
// Private helpers

function find(path: string): Doc | undefined {
  return store.get().open.find((d) => d.path === path);
}

function patch(path: string, fields: Partial<Omit<Doc, "path">>): void {
  store.update((s) => ({ ...s, open: s.open.map((d) => (d.path === path ? { ...d, ...fields } : d)) }));
}

/** Apply a transaction to a doc, whether or not it is on screen. */
function transact(path: string, spec: TransactionSpec): void {
  if (bound?.path === path) {
    bound.view.dispatch(spec);
    return;
  }
  const doc = find(path);
  if (doc) patch(path, { state: doc.state.update(spec).state });
}

function show(path: string, opts: OpenOptions): void {
  if (!opts.background) store.update((s) => ({ ...s, active: path }));
  if (opts.line) placeCursor(path, opts.line, opts.column ?? 1);
  if (!opts.background && opts.focus !== false) requestFocus(path);
}

function requestFocus(path: string): void {
  // Defer a frame: the key event that triggered the open must not land in the editor.
  if (bound?.path === path) requestAnimationFrame(() => bound?.view.focus());
  else patch(path, { focus: true });
}

function placeCursor(path: string, line: number, column: number): void {
  const doc = find(path);
  if (!doc) return;
  const l = doc.state.doc.line(Math.max(1, Math.min(line, doc.state.doc.lines)));
  const pos = Math.min(l.from + Math.max(0, column - 1), l.to);
  if (bound?.path === path) {
    bound.view.dispatch({ selection: EditorSelection.cursor(pos), effects: EditorView.scrollIntoView(pos, { y: "center" }) });
    bound.view.focus();
  } else {
    patch(path, { state: doc.state.update({ selection: EditorSelection.cursor(pos) }).state, reveal: true });
  }
}

function apply(doc: Doc, decision: ReconcileDecision): void {
  switch (decision.kind) {
    case "noop":
      return;
    case "reload": {
      transact(doc.path, { changes: { from: 0, to: doc.state.doc.length, insert: decision.baseline.text } });
      const after = find(doc.path);
      if (after) patch(doc.path, { baseline: { ...decision.baseline, text: after.state.doc }, disk: { kind: "synced" } });
      return;
    }
    case "adopt":
      patch(doc.path, { baseline: { ...decision.baseline, text: doc.state.doc }, disk: { kind: "synced" } });
      return;
    case "conflict":
      patch(doc.path, { disk: { kind: "changed", text: decision.text, hash: decision.hash } });
      return;
    case "deleted":
      patch(doc.path, { disk: { kind: "deleted" } });
      return;
    case "restored":
      patch(doc.path, { disk: { kind: "synced" } });
      return;
  }
}

async function askToSave(text: string): Promise<"save" | "discard" | "cancel"> {
  const res = await message(text, {
    title: "Unsaved changes",
    kind: "warning",
    buttons: { yes: "Save", no: "Don't Save", cancel: "Cancel" },
  });
  if (res === "Yes" || res === "Save") return "save";
  if (res === "No" || res === "Don't Save") return "discard";
  return "cancel";
}

function basename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

