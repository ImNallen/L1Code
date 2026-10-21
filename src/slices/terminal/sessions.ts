// The terminal registry: the only owner of xterm instances. Rust owns the PTYs and a byte-addressed
// output ring; each xterm here is created once per session, survives the tool being hidden, and is
// re-parented into whichever surface mounts. A window reload re-attaches from the ring.

import { Terminal, type ILink, type ITheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import { openUrl } from "@tauri-apps/plugin-opener";
import { channel, errorMessage, rust, type PtyEvent, type TerminalInfo } from "@/core/ipc";
import { createStore, type ReadStore } from "@/core/store";
import { toast } from "@/core/toast";
import { currentRoot } from "@/core/workspace";
import { editor } from "@/slices/editor";
import { preview } from "@/slices/preview";

export interface TerminalSession {
  readonly id: number;
  readonly title: string;
  readonly exited: boolean;
}

export interface TerminalState {
  readonly sessions: readonly TerminalSession[];
  readonly active: number | null;
  /** The first `ptyList` after activation finished, so an empty list really means no sessions. */
  readonly ready: boolean;
}

const store = createStore<TerminalState>({ sessions: [], active: null, ready: false });
export const terminalState: ReadStore<TerminalState> = store;

interface Entry {
  readonly id: number;
  readonly term: Terminal;
  readonly fit: FitAddon;
  /** UTF-8 byte offset of the end of the output already written to `term`. */
  seenEnd: number;
  /** Bumped on every attach so a superseded channel's late messages are ignored. */
  attachSeq: number;
  exited: boolean;
  exitPrinted: boolean;
  sentSize: { cols: number; rows: number } | null;
}

const entries = new Map<number, Entry>();
const isMac = navigator.platform.toLowerCase().includes("mac");

const THEME: ITheme = {
  background: "#13161b",
  foreground: "#d7dce4",
  cursor: "#7aa2ff",
  cursorAccent: "#13161b",
  selectionBackground: "rgba(122, 162, 255, 0.3)",
  black: "#1e232b",
  red: "#f2777a",
  green: "#7ccf9b",
  yellow: "#e5c07b",
  blue: "#7aa2ff",
  magenta: "#c792ea",
  cyan: "#6cc4d8",
  white: "#d7dce4",
  brightBlack: "#6b7383",
  brightRed: "#ff8f91",
  brightGreen: "#98e0b2",
  brightYellow: "#f0d398",
  brightBlue: "#9bb8ff",
  brightMagenta: "#dbaaf5",
  brightCyan: "#8ad8ea",
  brightWhite: "#ffffff",
};

function monoFont(): string {
  const css = getComputedStyle(document.documentElement).getPropertyValue("--font-mono").trim();
  return css || 'ui-monospace, Menlo, monospace';
}

/** UTF-8 length of a JS string without allocating. Rust offsets count bytes. */
function utf8Length(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      n += 4;
      i++;
    } else n += 3;
  }
  return n;
}

function openLink(uri: string) {
  let host: string;
  try {
    host = new URL(uri).hostname;
  } catch {
    return;
  }
  if (host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0" || host === "[::1]") preview.open(uri);
  else openUrl(uri).catch((e) => toast(errorMessage(e), "error"));
}

// `src/foo.ts:12`, `./a/b.rs:3:7`, or an absolute path inside the workspace root.
const FILE_LINE = /(^|[\s'"`([{<=])((?:\.{0,2}\/)?[\w@.+-]+(?:\/[\w@.+-]+)*\.\w+):(\d+)(?::(\d+))?/g;

function toRelPath(raw: string): string | null {
  let p = raw;
  if (p.startsWith("/")) {
    const root = currentRoot();
    if (!root || !p.startsWith(root.endsWith("/") ? root : root + "/")) return null;
    p = p.slice(root.length).replace(/^\/+/, "");
  }
  p = p.replace(/^(\.\/)+/, "");
  if (!p || p.split("/").some((seg) => seg === ".." || seg === ".")) return null;
  return p;
}

function fileLinks(term: Terminal, y: number): ILink[] | undefined {
  const line = term.buffer.active.getLine(y - 1)?.translateToString(true);
  if (!line) return undefined;
  const links: ILink[] = [];
  for (const m of line.matchAll(FILE_LINE)) {
    const [, lead = "", rawPath = "", lineNo = "", col] = m;
    const path = toRelPath(rawPath);
    if (!path || /^[\d.]+$/.test(path)) continue;
    const start = (m.index ?? 0) + lead.length;
    const text = m[0].slice(lead.length);
    links.push({
      range: { start: { x: start + 1, y }, end: { x: start + text.length, y } },
      text,
      activate: () => void editor.open(path, { line: Number(lineNo), column: col ? Number(col) : undefined }),
    });
  }
  return links.length ? links : undefined;
}

function sendSize(e: Entry) {
  const { cols, rows } = e.term;
  if (e.exited || (e.sentSize && e.sentSize.cols === cols && e.sentSize.rows === rows)) return;
  e.sentSize = { cols, rows };
  rust.ptyResize(e.id, cols, rows).catch(() => {});
}

function createEntry(info: TerminalInfo): Entry {
  const term = new Terminal({
    fontFamily: monoFont(),
    fontSize: 12.5,
    lineHeight: 1.2,
    cursorBlink: true,
    scrollback: 10_000,
    macOptionIsMeta: true,
    theme: THEME,
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  term.loadAddon(new WebLinksAddon((_, uri) => openLink(uri)));
  term.registerLinkProvider({ provideLinks: (y, cb) => cb(fileLinks(term, y)) });
  // Let app shortcuts (Cmd+… on macOS, Ctrl+` everywhere) reach the shell instead of the shell process.
  term.attachCustomKeyEventHandler((ev) => !((isMac && ev.metaKey) || (ev.ctrlKey && ev.key === "`")));

  const entry: Entry = { id: info.id, term, fit, seenEnd: 0, attachSeq: 0, exited: info.exited, exitPrinted: false, sentSize: null };
  term.onData((d) => {
    if (!entry.exited) rust.ptyWrite(info.id, d).catch(() => {});
  });
  term.onResize(() => sendSize(entry));
  entries.set(info.id, entry);
  return entry;
}

function onEvent(entry: Entry, ev: PtyEvent) {
  if (ev.kind === "data") {
    if (ev.start === null) {
      entry.term.write(ev.data);
      return;
    }
    const end = ev.start + utf8Length(ev.data);
    if (end <= entry.seenEnd) return;
    let data = ev.data;
    if (ev.start < entry.seenEnd) {
      // Partial overlap: keep only the bytes past what we already wrote.
      const bytes = new TextEncoder().encode(data);
      data = new TextDecoder().decode(bytes.subarray(entry.seenEnd - ev.start));
    }
    entry.seenEnd = end;
    entry.term.write(data);
    return;
  }
  entry.exited = true;
  if (entry.exitPrinted) return;
  entry.exitPrinted = true;
  const label = ev.code === null ? "[process exited]" : `[process exited with code ${ev.code}]`;
  entry.term.write(`\r\n\x1b[2m${label}\x1b[0m\r\n`);
  setSession(entry.id, { exited: true });
}

async function attachChannel(entry: Entry) {
  const seq = ++entry.attachSeq;
  const ch = channel<PtyEvent>((ev) => {
    if (entry.attachSeq === seq && entries.get(entry.id) === entry) onEvent(entry, ev);
  });
  await rust.ptyAttach(entry.id, ch);
}

function setSession(id: number, patch: Partial<TerminalSession>) {
  store.update((s) => ({ ...s, sessions: s.sessions.map((x) => (x.id === id ? { ...x, ...patch } : x)) }));
}

/** Starts a shell (in `cwd`, workspace-relative, or the root) and makes it the active session. */
export async function openSession(cwd?: string): Promise<void> {
  try {
    const info = await rust.ptyOpen(cwd ?? null, 80, 24);
    const entry = createEntry(info);
    store.update((s) => ({ ...s, sessions: [...s.sessions, { id: info.id, title: info.title, exited: info.exited }], active: info.id }));
    await attachChannel(entry);
  } catch (e) {
    toast(`Could not start terminal: ${errorMessage(e)}`, "error");
  }
}

export function setActive(id: number): void {
  if (entries.has(id)) store.update((s) => ({ ...s, active: id }));
}

/** Kills the shell and disposes its xterm. */
export function closeSession(id: number): void {
  rust.ptyKill(id).catch(() => {});
  dispose(id);
  store.update((s) => {
    const i = s.sessions.findIndex((x) => x.id === id);
    const sessions = s.sessions.filter((x) => x.id !== id);
    const active = s.active !== id ? s.active : (sessions[Math.min(i, sessions.length - 1)]?.id ?? null);
    return { ...s, sessions, active };
  });
}

function dispose(id: number) {
  const e = entries.get(id);
  if (!e) return;
  entries.delete(id);
  e.attachSeq++;
  e.term.dispose();
}

let autoOpened = false;

/** Opens a first session when the tool is first shown and nothing survived from before. */
export function ensureSession(): void {
  const s = store.get();
  if (autoOpened || !s.ready) return;
  autoOpened = true;
  if (s.sessions.length === 0) void openSession();
}

/** Mounts the session's xterm into `el` (opening it the first time) and keeps it fitted. */
export function attach(id: number, el: HTMLElement): () => void {
  const e = entries.get(id);
  if (!e) return () => {};
  if (e.term.element) el.appendChild(e.term.element);
  else e.term.open(el);

  let visible = false;
  const fitIfVisible = () => {
    if (!entries.has(id)) return;
    if (el.clientWidth === 0 || el.clientHeight === 0) {
      visible = false;
      return;
    }
    try {
      e.fit.fit();
    } catch {
      return;
    }
    sendSize(e);
    if (!visible) {
      visible = true;
      e.term.refresh(0, e.term.rows - 1);
      e.term.focus();
    }
  };
  const ro = new ResizeObserver(fitIfVisible);
  ro.observe(el);
  return () => ro.disconnect();
}

/** Re-attaches every session Rust still has (they survive window reloads) and drops stale ones. */
export function activate(): () => void {
  let cancelled = false;
  const before = new Set(entries.keys());
  void (async () => {
    try {
      const list = await rust.ptyList();
      if (cancelled) return;
      const ids = new Set(list.map((t) => t.id));
      for (const id of before) if (!ids.has(id)) dispose(id);
      for (const info of list) {
        const entry = entries.get(info.id) ?? createEntry(info);
        await attachChannel(entry).catch(() => {});
        if (cancelled) return;
      }
      store.update((s) => {
        const listed = list.map((t) => ({ id: t.id, title: t.title, exited: entries.get(t.id)?.exited ?? t.exited }));
        // Keep sessions opened while the list was in flight.
        const sessions = [...listed, ...s.sessions.filter((x) => !ids.has(x.id) && entries.has(x.id))];
        const active = sessions.some((x) => x.id === s.active) ? s.active : (sessions[sessions.length - 1]?.id ?? null);
        return { sessions, active, ready: true };
      });
    } catch {
      if (!cancelled) store.update((s) => ({ ...s, ready: true }));
    }
  })();
  return () => {
    cancelled = true;
    for (const id of [...entries.keys()]) dispose(id);
    autoOpened = false;
    store.set({ sessions: [], active: null, ready: false });
  };
}
