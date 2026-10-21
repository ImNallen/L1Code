// Pure decision: given an open document and a fresh disk read, what changes? No I/O, no store.

import { Text } from "@codemirror/state";
import type { ReadResult } from "@/core/ipc";

/** What we last agreed with the disk on. Dirty and echo detection compare against this. */
export interface Baseline {
  readonly text: Text;
  readonly hash: string;
  readonly bom: boolean;
  readonly crlf: boolean;
}

/**
 * The disk, relative to the baseline:
 *   synced : disk is believed to equal the baseline
 *   changed: disk moved while the draft was dirty; the user must choose
 *   deleted: the file is gone (or unreadable); the draft is kept
 */
export type DiskState =
  | { readonly kind: "synced" }
  | { readonly kind: "changed"; readonly text: Text; readonly hash: string }
  | { readonly kind: "deleted" };

/** The parts of a document the decision needs. */
export interface DocSnapshot {
  readonly draft: Text;
  readonly baseline: Baseline;
  readonly disk: DiskState;
}

type TextRead = Extract<ReadResult, { kind: "text" }>;

export type ReconcileDecision =
  /** Disk equals the baseline: our own write echoing back, a touch, or nothing. */
  | { readonly kind: "noop" }
  /** Clean doc, disk changed: replace the text as one undoable change and adopt the new baseline. */
  | { readonly kind: "reload"; readonly baseline: Baseline }
  /** Disk now equals the draft (saved elsewhere, or a checkout to the same content). */
  | { readonly kind: "adopt"; readonly baseline: Baseline }
  /** Dirty doc, disk differs from both baseline and draft. */
  | { readonly kind: "conflict"; readonly text: Text; readonly hash: string }
  | { readonly kind: "deleted" }
  /** Was deleted or conflicted, now back to the baseline content. */
  | { readonly kind: "restored" };

export function toText(raw: string): Text {
  return Text.of(raw.split(/\r\n?|\n/));
}

export function isDirty(doc: DocSnapshot): boolean {
  return doc.draft !== doc.baseline.text && !doc.draft.eq(doc.baseline.text);
}

export function baselineOf(read: TextRead): Baseline {
  return { text: toText(read.text), hash: read.hash, bom: read.bom, crlf: read.crlf };
}

export function decideReconcile(doc: DocSnapshot, read: ReadResult): ReconcileDecision {
  if (read.kind !== "text") {
    return doc.disk.kind === "deleted" ? { kind: "noop" } : { kind: "deleted" };
  }
  if (read.hash === doc.baseline.hash) {
    return doc.disk.kind === "synced" ? { kind: "noop" } : { kind: "restored" };
  }
  if (doc.disk.kind === "changed" && read.hash === doc.disk.hash) return { kind: "noop" };
  const baseline = baselineOf(read);
  if (!isDirty(doc)) return { kind: "reload", baseline };
  if (doc.draft.eq(baseline.text)) return { kind: "adopt", baseline };
  return { kind: "conflict", text: baseline.text, hash: read.hash };
}
