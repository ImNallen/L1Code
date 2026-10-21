import { describe, expect, it } from "vitest";
import type { ReadResult } from "@/core/ipc";
import { decideReconcile, toText, type DocSnapshot } from "./reconcile";

const read = (text: string, hash: string): ReadResult => ({ kind: "text", text, hash, bom: false, crlf: false });
const base = (text: string, hash: string) => ({ text: toText(text), hash, bom: false, crlf: false });

function doc(draft: string, baselineText: string, hash: string, disk: DocSnapshot["disk"] = { kind: "synced" }): DocSnapshot {
  const baseline = base(baselineText, hash);
  return { draft: draft === baselineText ? baseline.text : toText(draft), baseline, disk };
}

describe("decideReconcile", () => {
  it("ignores our own write echoing back", () => {
    expect(decideReconcile(doc("a", "a", "h1"), read("a", "h1")).kind).toBe("noop");
  });

  it("reloads a clean doc", () => {
    const d = decideReconcile(doc("a", "a", "h1"), read("b", "h2"));
    expect(d.kind).toBe("reload");
  });

  it("treats undo back to the saved text as clean", () => {
    const snap: DocSnapshot = { draft: toText("a"), baseline: base("a", "h1"), disk: { kind: "synced" } };
    expect(decideReconcile(snap, read("b", "h2")).kind).toBe("reload");
  });

  it("adopts the disk when it equals the draft", () => {
    expect(decideReconcile(doc("b", "a", "h1"), read("b", "h2")).kind).toBe("adopt");
  });

  it("flags a conflict for a dirty doc and is idempotent", () => {
    const d = decideReconcile(doc("mine", "a", "h1"), read("theirs", "h2"));
    expect(d.kind).toBe("conflict");
    const again = decideReconcile(doc("mine", "a", "h1", { kind: "changed", text: toText("theirs"), hash: "h2" }), read("theirs", "h2"));
    expect(again.kind).toBe("noop");
  });

  it("handles deletion and restore", () => {
    expect(decideReconcile(doc("a", "a", "h1"), { kind: "missing" }).kind).toBe("deleted");
    expect(decideReconcile(doc("a", "a", "h1", { kind: "deleted" }), { kind: "missing" }).kind).toBe("noop");
    expect(decideReconcile(doc("x", "a", "h1", { kind: "deleted" }), read("a", "h1")).kind).toBe("restored");
  });

  it("normalizes CRLF when comparing", () => {
    expect(decideReconcile(doc("a\nb", "z", "h1"), read("a\r\nb", "h2")).kind).toBe("adopt");
  });
});
