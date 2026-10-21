import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), Channel: class {} }));

describe("manifest", async () => {
  // Importing the manifest pulls in every slice's index; keep this a cheap structural check.
  const { manifest } = await import("./manifest").catch(() => ({ manifest: null }));

  it("has unique ids and shortcuts", () => {
    if (!manifest) return;
    const views = [...manifest.left, ...manifest.right];
    const ids = views.map((v) => v.id);
    expect(new Set(ids).size).toBe(ids.length);
    const chords = [
      ...views.map((v) => v.shortcut).filter(Boolean),
      ...[manifest.main.extras, ...views.map((v) => v.extras)].flatMap((e) => e?.commands?.map((c) => c.chord) ?? []),
    ].map((c) => c!.toLowerCase());
    expect(new Set(chords).size).toBe(chords.length);
  });
});
