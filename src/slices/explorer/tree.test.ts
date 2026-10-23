import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { rust } from "@/core/ipc";
import { applyFsBatch, directoryFor, dispose, filePaths, load, remove, startCreate, treeModel } from "./tree";

vi.mock("@/core/ipc", () => ({
  rust: { fsList: vi.fn(), fsCreate: vi.fn(), fsDelete: vi.fn() },
  errorMessage: (error: unknown) => String(error),
}));
vi.mock("@/slices/editor", () => ({ editor: { open: vi.fn(), moved: vi.fn() } }));

beforeEach(async () => {
  vi.clearAllMocks();
  vi.mocked(rust.fsList).mockResolvedValue("src/\nsrc/nested/\nsrc/nested/existing.ts\nother/\nother/existing.ts\nroot.ts");
  await load();
});

afterEach(() => dispose());

function tree() {
  const model = treeModel();
  if (!model) throw new Error("Explorer model is not loaded");
  return model;
}

describe("directoryFor", () => {
  it.each([
    { path: "src/nested", expected: "src/nested/" },
    { path: "src/nested/", expected: "src/nested/" },
    { path: "src", expected: "src/" },
    { path: "src/", expected: "src/" },
    { path: "src/nested/existing.ts", expected: "src/nested/" },
    { path: "root.ts", expected: null },
    { path: "missing", expected: null },
    { path: "missing/", expected: null },
  ])("resolves $path to its canonical creation directory", ({ path, expected }) => {
    expect(directoryFor(path)).toBe(expected);
  });
});

describe.each([
  { kind: "file", dir: false, name: "untitled" },
  { kind: "folder", dir: true, name: "new-folder/" },
])("$kind creation", ({ dir, name }) => {
  it.each([
    { selected: ["src/nested/"], parent: "src/nested/" },
    { selected: ["src/nested/existing.ts"], parent: "src/nested/" },
    { selected: ["root.ts"], parent: "" },
    { selected: [], parent: "" },
    { selected: ["src/nested/", "other/"], parent: "" },
    { selected: ["src/nested/existing.ts", "other/existing.ts"], parent: "" },
  ])("uses the toolbar selection $selected", ({ selected, parent }) => {
    const model = tree();
    for (const path of selected) model.getItem(path)?.select();
    expect(model.getSelectedPaths()).toEqual(selected);

    startCreate({ kind: "selection" }, dir);

    const expected = parent + name;
    expect(model.getItem(expected)?.getPath()).toBe(expected);
    expect(model.getSelectedPaths()).toEqual([expected]);
    expect(rust.fsCreate).not.toHaveBeenCalled();
  });

  it("uses the selected directory even when another item has focus", () => {
    const model = tree();
    model.getItem("src/nested/")?.select();
    model.getItem("other/")?.focus();
    expect(model.getSelectedPaths()).toEqual(["src/nested/"]);
    expect(model.getFocusedPath()).toBe("other/");

    startCreate({ kind: "selection" }, dir);

    expect(model.getItem("src/nested/" + name)?.getPath()).toBe("src/nested/" + name);
    expect(model.getItem("other/" + name)).toBeNull();
  });

  it.each([
    { path: "other", parent: "other/" },
    { path: "other/", parent: "other/" },
    { path: "other/existing.ts", parent: "other/" },
    { path: "root.ts", parent: "" },
  ])("uses context item $path independently of selection", ({ path, parent }) => {
    const model = tree();
    model.getItem("src/nested/")?.select();

    startCreate({ kind: "item", path }, dir);

    expect(model.getItem(parent + name)?.getPath()).toBe(parent + name);
    expect(model.getItem("src/nested/" + name)).toBeNull();
    expect(rust.fsCreate).not.toHaveBeenCalled();
  });

  it("ignores an explicit item removed since its context menu opened", () => {
    const model = tree();
    model.getItem("src/nested/")?.select();
    applyFsBatch({ gitMeta: false, overflow: false, changes: [{ path: "other", isDir: true, exists: false }] });
    expect(model.getItem("other/")).toBeNull();

    startCreate({ kind: "item", path: "other/" }, dir);

    expect(model.getItem(name)).toBeNull();
    expect(model.getItem("src/nested/" + name)).toBeNull();
    expect(model.getSelectedPaths()).toEqual(["src/nested/"]);
    expect(rust.fsCreate).not.toHaveBeenCalled();
  });
});

describe("remove", () => {
  it.each([
    { path: "other/", deleted: "other", isDir: true },
    { path: "src/nested/existing.ts", deleted: "src/nested/existing.ts", isDir: false },
  ])("sends $path to system trash and waits for its watcher removal", async ({ path, deleted, isDir }) => {
    const model = tree();
    model.getItem("root.ts")?.select();

    await remove(path);

    expect(rust.fsDelete).toHaveBeenCalledExactlyOnceWith(deleted);
    expect(model.getItem(path)).not.toBeNull();
    expect(model.getItem("root.ts")).not.toBeNull();
    expect(filePaths()).toContain("other/existing.ts");
    expect(filePaths()).toContain("src/nested/existing.ts");

    applyFsBatch({ gitMeta: false, overflow: false, changes: [{ path: deleted, isDir, exists: false }] });

    expect(model.getItem(path)).toBeNull();
    expect(model.getItem("root.ts")).not.toBeNull();
    expect(filePaths()).not.toContain(isDir ? "other/existing.ts" : deleted);
  });
});
