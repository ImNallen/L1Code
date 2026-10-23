// The one gateway to Rust. Commands come from the generated bindings with their Result envelope
// unwrapped into a thrown `IpcError`, so callers write plain `await rust.fsRead(path)`.

import { Channel } from "@tauri-apps/api/core";
import { commands, type Error as WireError } from "./bindings.gen";

export type {
  ChangeKind,
  Check,
  FilePatch,
  FontFamily,
  FsBatch,
  FsChange,
  GitFile,
  GitStatus,
  PrLookup,
  PtyEvent,
  PullRequest,
  ReadResult,
  TerminalInfo,
  WorkspaceInfo,
  WriteExpect,
  WriteResult,
} from "./bindings.gen";

export class IpcError extends Error {
  readonly kind: WireError["kind"];
  constructor(e: WireError) {
    super("message" in e ? e.message : e.kind);
    this.kind = e.kind;
  }
}

type Commands = typeof commands;
type Unwrapped<R> = R extends Promise<{ status: "ok"; data: infer D } | { status: "error"; error: unknown }> ? Promise<D> : R;
type Rust = { [K in keyof Commands]: (...args: Parameters<Commands[K]>) => Unwrapped<ReturnType<Commands[K]>> };

export const rust = new Proxy({} as Rust, {
  get(_, name: string) {
    const fn = (commands as Record<string, (...a: unknown[]) => Promise<unknown>>)[name];
    if (!fn) throw new Error(`unknown command ${name}`);
    return async (...args: unknown[]) => {
      const res = await fn(...args);
      if (res && typeof res === "object" && "status" in res) {
        const r = res as { status: "ok"; data: unknown } | { status: "error"; error: WireError };
        if (r.status === "error") throw new IpcError(r.error);
        return r.data;
      }
      return res;
    };
  },
});

/** A Channel whose messages go to `onMessage`. Pass it to a streaming command. */
export function channel<T>(onMessage: (msg: T) => void): Channel<T> {
  const ch = new Channel<T>();
  ch.onmessage = onMessage;
  return ch;
}

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
