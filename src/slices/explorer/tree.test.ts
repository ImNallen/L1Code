import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FileTreeOptions, FileTreeRenameEvent } from "@pierre/trees";
import { editor } from "@/slices/editor";
import { workspaceState } from "@/core/workspace";
import { rust } from "@/core/ipc";
import { applyFsBatch, applyGitStatus, captureTreeInput, clearTreeInput, directoryFor, dispose, explorerFilter, filePaths, firstMatch, load, nodeFor, remove, reveal, setFilter, startCreate, startRename, treeModel } from "./tree";
import { selectionIntentFor, type TreeInputEvent } from "./treeInput";

const options = vi.hoisted(() => new Map<string, FileTreeOptions>());
vi.mock("@pierre/trees", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@pierre/trees")>();
  return {
    ...actual,
    FileTree: class extends actual.FileTree {
      constructor(config: FileTreeOptions) {
        super(config);
        options.set("current", config);
      }
    },
  };
});
vi.mock("@/core/workspace", () => ({ workspaceState: { get: vi.fn() } }));
vi.mock("@/core/ipc", () => ({
  rust: { fsList: vi.fn(), fsCreate: vi.fn(), fsDelete: vi.fn(), fsRename: vi.fn() },
  errorMessage: (error: unknown) => String(error),
}));
vi.mock("@/slices/editor", () => ({ editor: { open: vi.fn(), moved: vi.fn() } }));

beforeEach(async () => {
  vi.resetAllMocks();
  vi.mocked(workspaceState.get).mockReturnValue({ status: "open", info: { name: "repo", root: "/workspace/repo", isGit: true } });
  vi.mocked(rust.fsList).mockResolvedValue("src/\nsrc/nested/\nsrc/nested/existing.ts\nother/\nother/existing.ts\nroot.ts");
  await load();
});

afterEach(() => dispose());

const projected = (path: string) => "repo/" + path;

function node(path: string) {
  const result = nodeFor(projected(path));
  if (!result) throw new Error(`Missing tree node ${path}`);
  return result;
}

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
    const entry = nodeFor(projected(path));
    const parent = entry ? directoryFor(entry) : null;
    expect(parent?.kind === "directory" ? parent.path + "/" : null).toBe(expected);
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
    for (const path of selected) model.getItem(projected(path))?.select();
    expect(model.getSelectedPaths()).toEqual(selected.map(projected));

    startCreate({ kind: "selection" }, dir);

    const expected = parent + name;
    expect(model.getItem(projected(expected))?.getPath()).toBe(projected(expected));
    expect(model.getSelectedPaths()).toEqual([projected(expected)]);
    expect(rust.fsCreate).not.toHaveBeenCalled();
  });

  it("uses the selected directory even when another item has focus", () => {
    const model = tree();
    model.getItem(projected("src/nested/"))?.select();
    model.getItem(projected("other/"))?.focus();
    expect(model.getSelectedPaths()).toEqual([projected("src/nested/")]);
    expect(model.getFocusedPath()).toBe(projected("other/"));

    startCreate({ kind: "selection" }, dir);

    expect(model.getItem(projected("src/nested/" + name))?.getPath()).toBe(projected("src/nested/" + name));
    expect(model.getItem(projected("other/" + name))).toBeNull();
  });

  it.each([
    { path: "other", parent: "other/" },
    { path: "other/", parent: "other/" },
    { path: "other/existing.ts", parent: "other/" },
    { path: "root.ts", parent: "" },
  ])("uses context item $path independently of selection", ({ path, parent }) => {
    const model = tree();
    model.getItem(projected("src/nested/"))?.select();

    startCreate({ kind: "item", node: node(path) }, dir);

    expect(model.getItem(projected(parent + name))?.getPath()).toBe(projected(parent + name));
    expect(model.getItem(projected("src/nested/" + name))).toBeNull();
    expect(rust.fsCreate).not.toHaveBeenCalled();
  });

  it("ignores an explicit item removed since its context menu opened", () => {
    const model = tree();
    model.getItem(projected("src/nested/"))?.select();
    const stale = node("other/");
    applyFsBatch({ gitMeta: false, overflow: false, changes: [{ path: "other", isDir: true, exists: false }] });
    expect(model.getItem(projected("other/"))).toBeNull();

    startCreate({ kind: "item", node: stale }, dir);

    expect(model.getItem(projected(name))).toBeNull();
    expect(model.getItem(projected("src/nested/" + name))).toBeNull();
    expect(model.getSelectedPaths()).toEqual([projected("src/nested/")]);
    expect(rust.fsCreate).not.toHaveBeenCalled();
  });
});

describe("remove", () => {
  it.each([
    { path: "other/", deleted: "other", isDir: true },
    { path: "src/nested/existing.ts", deleted: "src/nested/existing.ts", isDir: false },
  ])("sends $path to system trash and waits for its watcher removal", async ({ path, deleted, isDir }) => {
    const model = tree();
    model.getItem(projected("root.ts"))?.select();

    await remove(node(path));

    expect(rust.fsDelete).toHaveBeenCalledExactlyOnceWith(deleted);
    expect(model.getItem(projected(path))).not.toBeNull();
    expect(model.getItem(projected("root.ts"))).not.toBeNull();
    expect(filePaths()).toContain("other/existing.ts");
    expect(filePaths()).toContain("src/nested/existing.ts");

    applyFsBatch({ gitMeta: false, overflow: false, changes: [{ path: deleted, isDir, exists: false }] });

    expect(model.getItem(projected(path))).toBeNull();
    expect(model.getItem(projected("root.ts"))).not.toBeNull();
    expect(filePaths()).not.toContain(isDir ? "other/existing.ts" : deleted);
  });
});

function rows() {
  return tree().getVisibleRows(0, tree().getVisibleCount());
}

function directory(path: string) {
  const item = tree().getItem(projected(path));
  if (!item || !("expand" in item)) throw new Error(`Missing directory ${path}`);
  return item;
}

function renameEvent(event: FileTreeRenameEvent) {
  const renaming = options.get("current")?.renaming;
  if (!renaming || typeof renaming !== "object" || !renaming.onRename) throw new Error("Missing rename callback");
  renaming.onRename(event);
}

async function rename(from: string, to: string, isFolder: boolean) {
  renameEvent({ sourcePath: projected(from), destinationPath: projected(to), isFolder });
  tree().move(projected(from), projected(to));
  await Promise.resolve();
}

describe("repository root", () => {
  it.each(["", "only/\nonly/nested/\nonly/nested/a.ts"])("keeps an explicit expanded root for %j", async (listing) => {
    dispose();
    vi.mocked(rust.fsList).mockResolvedValue(listing);
    await load();

    expect(rows().map(({ path }) => path)).toEqual(listing ? ["repo/", "repo/only/"] : ["repo/"]);
    expect(rows()[0]).toMatchObject({ name: "repo", depth: 0, kind: "directory", isExpanded: true });
    if (listing) expect(directory("only/").isExpanded()).toBe(false);
    directory("").select();
    directory("").collapse();
    expect(rows().map(({ path }) => path)).toEqual(["repo/"]);
    expect(tree().getSelectedPaths()).toEqual(["repo/"]);
    directory("").expand();
    expect(rows()).toHaveLength(listing ? 2 : 1);
    expect(editor.open).not.toHaveBeenCalled();
  });

  it.each(["repo", "Sidebar demo", "/"])("uses workspace name %j with a filesystem-root fallback", async (name) => {
    dispose();
    vi.mocked(workspaceState.get).mockReturnValue({ status: "open", info: { name, root: name === "/" ? "/" : "/workspace/" + name, isGit: false } });
    vi.mocked(rust.fsList).mockResolvedValue("a.ts");
    await load();
    const label = name === "/" ? "Workspace" : name;
    expect(rows().map(({ path }) => path)).toEqual([label + "/", label + "/a.ts"]);
    expect(nodeFor(label + "/a.ts")).toEqual({ kind: "file", path: "a.ts" });
  });

  it("round trips a descendant named like the root without stripping its name", async () => {
    vi.mocked(rust.fsList).mockResolvedValue("repo/\nrepo/repo.ts");
    await load();
    expect(nodeFor("repo/")).toEqual({ kind: "root" });
    expect(nodeFor("repo/repo/")).toEqual({ kind: "directory", path: "repo" });
    expect(nodeFor("repo/repo/repo.ts")).toEqual({ kind: "file", path: "repo/repo.ts" });
    tree().getItem("repo/repo/repo.ts")?.select();
    expect(editor.open).toHaveBeenCalledWith("repo/repo.ts", { focus: false });
    expect(filePaths()).toEqual(["repo/repo.ts"]);
  });

  it.each(["root.ts", "other/src/", "repository/root.ts", "repo/missing", "repo/../root.ts"])("rejects invalid or stale identity %s", (path) => {
    expect(nodeFor(path)).toBeNull();
  });

  it.each([false, true])("creates under the selected root with folder=%s", (dir) => {
    directory("").select();
    startCreate({ kind: "selection" }, dir);
    const expected = projected(dir ? "new-folder/" : "untitled");
    expect(tree().getSelectedPaths()).toEqual([expected]);
    expect(tree().getItem(expected)).not.toBeNull();
    expect(rust.fsCreate).not.toHaveBeenCalled();
  });

  it("refuses root rename through dispatch, keyboard, and commit, and refuses root deletion", async () => {
    const start = vi.spyOn(tree(), "startRenaming");
    startRename({ kind: "root" });
    expect(start).not.toHaveBeenCalled();
    directory("").focus();
    expect(tree().startRenaming()).toBe(false);
    expect(tree().startRenaming("repo")).toBe(false);
    await remove({ kind: "root" });
    renameEvent({ sourcePath: "repo", destinationPath: "new-name", isFolder: true });
    renameEvent({ sourcePath: "repo/root.ts", destinationPath: "repo/", isFolder: false });
    renameEvent({ sourcePath: "repo/root.ts", destinationPath: "outside/root.ts", isFolder: false });
    await Promise.resolve();
    expect(rust.fsRename).not.toHaveBeenCalled();
    expect(rust.fsCreate).not.toHaveBeenCalled();
    expect(rust.fsDelete).not.toHaveBeenCalled();
    expect(tree().getItem("repo/")).not.toBeNull();
  });

  it("preserves expansion, selection, and focus on reload, including directories under a collapsed root", async () => {
    directory("src/").expand();
    directory("src/nested/").expand();
    directory("src/").select();
    directory("").focus();
    directory("").collapse();
    await load();
    expect(directory("").isExpanded()).toBe(false);
    expect(directory("src/").isExpanded()).toBe(true);
    expect(directory("src/nested/").isExpanded()).toBe(true);
    expect(tree().getSelectedPaths()).toEqual([projected("src/")]);
    expect(tree().getFocusedPath()).toBe("repo/");
  });

  it("preserves inferred directory expansion through reload", async () => {
    vi.mocked(rust.fsList).mockResolvedValue("src/nested/existing.ts");
    await load();
    directory("src/nested/").expand();
    directory("src/").collapse();
    await load();
    expect(directory("src/").isExpanded()).toBe(false);
    expect(directory("src/nested/").isExpanded()).toBe(true);
  });
});

describe("canonical mutation callbacks", () => {
  it.each([false, true])("commits a root creation with a nonempty relative path, folder=%s", async (dir) => {
    directory("").select();
    startCreate({ kind: "selection" }, dir);
    await rename(dir ? "new-folder" : "untitled", "created", dir);
    expect(rust.fsCreate).toHaveBeenCalledExactlyOnceWith("created", dir);
    expect(tree().getItem(projected("created"))).not.toBeNull();
  });

  it.each([false, true])("creates a descendant with relative IPC and editor paths, folder=%s", async (dir) => {
    startCreate({ kind: "item", node: node("src/nested/") }, dir);
    const from = "src/nested/" + (dir ? "new-folder" : "untitled");
    const to = "src/nested/created";
    await rename(from, to, dir);
    expect(rust.fsCreate).toHaveBeenCalledExactlyOnceWith(to, dir);
    expect(tree().getItem(projected(to))).not.toBeNull();
    if (dir) expect(filePaths()).not.toContain(to);
    else {
      expect(filePaths()).toContain(to);
      expect(editor.open).toHaveBeenCalledWith(to);
    }
    expect(rust.fsRename).not.toHaveBeenCalled();
  });

  it.each([
    { from: "src/nested/existing.ts", to: "src/nested/renamed.ts", dir: false },
    { from: "src/nested", to: "src/renamed", dir: true },
  ])("renames $from with relative IPC and index paths", async ({ from, to, dir }) => {
    await rename(from, to, dir);
    expect(rust.fsRename).toHaveBeenCalledExactlyOnceWith(from, to);
    expect(editor.moved).toHaveBeenCalledExactlyOnceWith(from, to, dir);
    expect(filePaths()).toContain(dir ? to + "/existing.ts" : to);
    expect(filePaths()).not.toContain(dir ? from + "/existing.ts" : from);
    applyFsBatch({ gitMeta: false, overflow: false, changes: [
      { path: from, exists: false, isDir: dir },
      { path: to, exists: true, isDir: dir },
    ] });
    expect(tree().getItem(projected(to))).not.toBeNull();
    expect(rust.fsList).toHaveBeenCalledTimes(1);
  });

  it.each([false, true])("rolls a failed rename back in the projected model, folder=%s", async (dir) => {
    vi.mocked(rust.fsRename).mockRejectedValue(new Error("rename refused"));
    const from = dir ? "src/nested" : "root.ts";
    await rename(from, "renamed", dir);
    expect(tree().getItem(projected(from))).not.toBeNull();
    expect(tree().getItem(projected("renamed"))).toBeNull();
    expect(filePaths()).toContain(dir ? "src/nested/existing.ts" : from);
    expect(editor.moved).not.toHaveBeenCalled();
  });

  it("removes a failed creation using its projected destination", async () => {
    vi.mocked(rust.fsCreate).mockRejectedValue(new Error("creation refused"));
    startCreate({ kind: "item", node: node("") }, false);
    await rename("untitled", "created.ts", false);
    expect(tree().getItem(projected("created.ts"))).toBeNull();
    expect(filePaths()).not.toContain("created.ts");
  });

  it("ignores stale rename and delete dispatch", async () => {
    const stale = node("root.ts");
    applyFsBatch({ gitMeta: false, overflow: false, changes: [{ path: "root.ts", isDir: false, exists: false }] });
    startRename(stale);
    await remove(stale);
    expect(rust.fsRename).not.toHaveBeenCalled();
    expect(rust.fsDelete).not.toHaveBeenCalled();
  });
});

describe("canonical filtering", () => {
  beforeEach(async () => {
    vi.mocked(rust.fsList).mockResolvedValue("nested/\nnested/repo.ts\nnested/another.ts\na.ts");
    await load();
  });

  it.each([
    { query: "repo", visible: ["repo/", "repo/nested/", "repo/nested/repo.ts"], first: "nested/repo.ts" },
    { query: "a.ts", visible: ["repo/", "repo/a.ts"], first: "a.ts" },
    { query: " NESTED\\REPO ", visible: ["repo/", "repo/nested/", "repo/nested/repo.ts"], first: "nested/repo.ts" },
    { query: "missing", visible: ["repo/"], first: null },
  ])("matches canonical paths for $query", ({ query, visible, first }) => {
    setFilter(query);
    expect(rows().map(({ path }) => path)).toEqual(visible);
    expect(firstMatch()).toBe(first);
    expect(explorerFilter.get()).toBe(query);
    expect(tree().getSearchValue()).toBe(first ? query.trim().replaceAll("\\", "/").toLowerCase() : "");
    expect(filePaths()).toEqual(["nested/repo.ts", "nested/another.ts", "a.ts"]);
  });

  it("returns only root when the repository name has no canonical match", async () => {
    vi.mocked(rust.fsList).mockResolvedValue("a.ts");
    await load();
    setFilter("repo");
    expect(rows().map(({ path }) => path)).toEqual(["repo/"]);
    expect(firstMatch()).toBeNull();
    expect(tree().getSearchValue()).toBe("");
    expect(explorerFilter.get()).toBe("repo");
  });

  it("restores the expansion snapshot after filter changes and reload", async () => {
    directory("nested/").expand();
    directory("").collapse();
    setFilter("repo");
    setFilter("missing");
    await load();
    setFilter("");
    expect(directory("").isExpanded()).toBe(false);
    expect(directory("nested/").isExpanded()).toBe(true);
  });

  it("keeps the filter when revealing a matching file", () => {
    setFilter("repo");
    const scroll = vi.spyOn(tree(), "scrollToPath");
    reveal("nested/repo.ts");
    expect(explorerFilter.get()).toBe("repo");
    expect(tree().getSearchValue()).toBe("repo");
    expect(tree().getItem(projected("nested/another.ts"))).toBeNull();
    expect(scroll).toHaveBeenCalledExactlyOnceWith(projected("nested/repo.ts"), { focus: false, offset: "nearest" });
  });

  it("clears the filter when revealing a hidden canonical file", () => {
    setFilter("repo");
    reveal("nested/another.ts");
    expect(explorerFilter.get()).toBe("");
    expect(tree().getSearchValue()).toBe("");
    expect(rows().map(({ path }) => path)).toContain(projected("nested/another.ts"));
  });

  it("resolves the creation target before clearing search", () => {
    setFilter("repo");
    tree().getItem(projected("nested/repo.ts"))?.select();
    startCreate({ kind: "selection" }, false);
    expect(explorerFilter.get()).toBe("");
    expect(tree().getSearchValue()).toBe("");
    expect(tree().getSelectedPaths()).toEqual([projected("nested/untitled")]);
  });

  it.each(["dispatch", "keyboard"])("clears the input and projection for %s rename", (source) => {
    directory("nested/").collapse();
    setFilter("repo");
    if (source === "dispatch") startRename(node("nested/repo.ts"));
    else {
      tree().getItem(projected("nested/repo.ts"))?.focus();
      expect(tree().startRenaming()).toBe(true);
    }
    expect(explorerFilter.get()).toBe("");
    expect(tree().getSearchValue()).toBe("");
    expect(tree().getItem(projected("nested/another.ts"))).not.toBeNull();
    expect(tree().getSelectedPaths()).toEqual([projected("nested/repo.ts")]);
    expect(rows().map(({ path }) => path)).toContain(projected("nested/repo.ts"));
    expect(tree().getFocusedPath()).toBe(projected("nested/repo.ts"));
  });

  it.each(["", "repo", "missing"])("updates watchers safely under filter %j", (query) => {
    setFilter(query);
    applyFsBatch({ gitMeta: false, overflow: false, changes: [
      { path: "hidden.ts", exists: true, isDir: false },
      { path: "fresh/repo-new.ts", exists: true, isDir: false },
      { path: "nested/another.ts", exists: false, isDir: false },
      { path: "nested/repo.ts", exists: false, isDir: false },
    ] });
    expect(filePaths()).toEqual(["a.ts", "hidden.ts", "fresh/repo-new.ts"]);
    expect(tree().getItem(projected("nested/repo.ts"))).toBeNull();
    if (query) expect(tree().getItem(projected("hidden.ts"))).toBeNull();
    else expect(tree().getItem(projected("hidden.ts"))).not.toBeNull();
    if (query === "repo") {
      expect(rows().map(({ path }) => path)).toEqual(["repo/", "repo/fresh/", "repo/fresh/repo-new.ts"]);
      expect(firstMatch()).toBe("fresh/repo-new.ts");
    }
    if (query === "missing") expect(rows().map(({ path }) => path)).toEqual(["repo/"]);
    setFilter("");
    expect(tree().getItem(projected("hidden.ts"))).not.toBeNull();
    expect(tree().getItem(projected("fresh/repo-new.ts"))).not.toBeNull();
    expect(rust.fsList).toHaveBeenCalledTimes(2);
  });

  it("starts and stops native search when watcher changes add and remove the last canonical match", () => {
    setFilter("fresh");
    expect(tree().getSearchValue()).toBe("");
    applyFsBatch({ gitMeta: false, overflow: false, changes: [{ path: "fresh.ts", exists: true, isDir: false }] });
    expect(tree().getSearchValue()).toBe("fresh");
    expect(firstMatch()).toBe("fresh.ts");
    expect(rows().map(({ path }) => path)).toEqual(["repo/", "repo/fresh.ts"]);
    applyFsBatch({ gitMeta: false, overflow: false, changes: [{ path: "fresh.ts", exists: false, isDir: false }] });
    expect(tree().getSearchValue()).toBe("");
    expect(explorerFilter.get()).toBe("fresh");
    expect(firstMatch()).toBeNull();
    expect(rows().map(({ path }) => path)).toEqual(["repo/"]);
  });

  it.each(["repo", "missing"])("removes a canonical directory while filtered by %s", (query) => {
    setFilter(query);
    applyFsBatch({ gitMeta: false, overflow: false, changes: [{ path: "nested", exists: false, isDir: true }] });
    expect(filePaths()).toEqual(["a.ts"]);
    expect(rows().map(({ path }) => path)).toEqual(["repo/"]);
    setFilter("");
    expect(tree().getItem(projected("nested/"))).toBeNull();
    expect(tree().getItem(projected("a.ts"))).not.toBeNull();
  });
});

describe("filtered selection", () => {
  it.each([false, true])("creates in a hidden selected folder before clearing the filter, folder=%s", (dir) => {
    directory("src/").select();
    setFilter("root.ts");
    expect(tree().getItem(projected("src/"))).toBeNull();

    startCreate({ kind: "selection" }, dir);

    const expected = projected("src/" + (dir ? "new-folder/" : "untitled"));
    expect(tree().getSelectedPaths()).toEqual([expected]);
    expect(rows().map(({ path }) => path)).toContain(expected);
  });

  it.each([false, true])("restores a hidden folder selection when the filter is cleared, folder=%s", (dir) => {
    directory("src/").select();
    setFilter("root.ts");
    setFilter("");
    expect(tree().getSelectedPaths()).toEqual([projected("src/")]);

    startCreate({ kind: "selection" }, dir);

    expect(tree().getSelectedPaths()).toEqual([projected("src/" + (dir ? "new-folder/" : "untitled"))]);
  });

  it("retains selection through query transitions, missing matches, and reload", async () => {
    directory("src/").expand();
    directory("src/nested/").select();
    setFilter("root.ts");
    setFilter("missing");
    await load();
    setFilter("existing.ts");
    expect(tree().getSelectedPaths()).toEqual([projected("src/nested/")]);
    setFilter("other");
    setFilter("   ");
    expect(tree().getSelectedPaths()).toEqual([projected("src/nested/")]);
    expect(directory("src/").isExpanded()).toBe(true);
    expect(directory("src/nested/").isExpanded()).toBe(false);
  });

  it.each([false, true])("honors a new visible selection while filtering, clear=%s", (clear) => {
    directory("src/").select();
    setFilter("other");
    directory("other/").select();
    setFilter("missing");
    if (clear) setFilter("");

    startCreate({ kind: "selection" }, false);

    expect(tree().getSelectedPaths()).toEqual([projected("other/untitled")]);
  });

  describe.each([false, true])("root fallback with cleared filter=%s", (clear) => {
    it.each([
      { selected: [], query: "existing.ts", deselect: false, restored: [] },
      { selected: ["src/", "other/"], query: "other", deselect: false, restored: ["src/", "other/"] },
      { selected: ["src/nested/existing.ts", "other/existing.ts"], query: "root.ts", deselect: false, restored: ["src/nested/existing.ts", "other/existing.ts"] },
      { selected: ["other/"], query: "other", deselect: true, restored: [] },
    ])("keeps root creation fallback for $selected with deselect=$deselect", ({ selected, query, deselect, restored }) => {
      for (const path of selected) tree().getItem(projected(path))?.select();
      setFilter(query);
      if (deselect) directory("other/").deselect();
      if (clear) {
        setFilter("");
        expect(tree().getSelectedPaths()).toEqual(restored.map(projected));
      }

      startCreate({ kind: "selection" }, false);

      expect(tree().getSelectedPaths()).toEqual([projected("untitled")]);
    });
  });

  it.each([
    { path: "src", isDir: true, selected: "src/" },
    { path: "src/nested/existing.ts", isDir: false, selected: "src/nested/existing.ts" },
  ])("does not restore a hidden selection after removal of $path", ({ path, isDir, selected }) => {
    tree().getItem(projected(selected))?.select();
    setFilter("root.ts");
    applyFsBatch({ gitMeta: false, overflow: false, changes: [{ path, isDir, exists: false }] });
    setFilter("");
    expect(tree().getSelectedPaths()).toEqual([]);

    startCreate({ kind: "selection" }, false);

    expect(tree().getSelectedPaths()).toEqual([projected("untitled")]);
  });

  it("does not resurrect a removed selection when its path is recreated during filtering", () => {
    tree().getItem(projected("src/nested/existing.ts"))?.select();
    setFilter("root.ts");
    const change = { path: "src/nested/existing.ts", isDir: false };
    applyFsBatch({ gitMeta: false, overflow: false, changes: [{ ...change, exists: false }] });
    applyFsBatch({ gitMeta: false, overflow: false, changes: [{ ...change, exists: true }] });
    setFilter("");
    expect(tree().getItem(projected("src/nested/existing.ts"))).not.toBeNull();
    expect(tree().getSelectedPaths()).toEqual([]);
  });

  it("does not reopen a file when projection restores its selection", () => {
    tree().getItem(projected("src/nested/existing.ts"))?.select();
    vi.mocked(editor.open).mockClear();
    setFilter("root.ts");
    setFilter("existing.ts");
    setFilter("");
    expect(tree().getSelectedPaths()).toEqual([projected("src/nested/existing.ts")]);
    expect(editor.open).not.toHaveBeenCalled();
  });

  it("retains the current rename target when a different selection is hidden", () => {
    directory("src/").select();
    directory("other/").collapse();
    setFilter("other/existing.ts");

    expect(tree().startRenaming(projected("other/existing.ts"))).toBe(true);

    expect(explorerFilter.get()).toBe("");
    expect(tree().getSelectedPaths()).toEqual([projected("other/existing.ts")]);
    expect(rows().map(({ path }) => path)).toContain(projected("other/existing.ts"));
    expect(tree().getFocusedPath()).toBe(projected("other/existing.ts"));
  });
});

describe("projected model boundaries", () => {
  it("maps only indexed Git paths into the projection", () => {
    const setGitStatus = vi.spyOn(tree(), "setGitStatus");
    applyGitStatus({ branch: "main", upstream: null, ahead: 0, behind: 0, files: [
      { path: "root.ts", origPath: null, staged: null, unstaged: "conflicted" },
      { path: "src/nested/existing.ts", origPath: null, staged: "added", unstaged: null },
      { path: "missing.ts", origPath: null, staged: null, unstaged: "modified" },
    ] });
    expect(setGitStatus).toHaveBeenCalledExactlyOnceWith([
      { path: "repo/root.ts", status: "modified" },
      { path: "repo/src/nested/existing.ts", status: "added" },
    ]);
    applyGitStatus(null);
    expect(setGitStatus).toHaveBeenLastCalledWith([]);
  });

  it.each(["root.ts", "src/nested/existing.ts"])("expands the root and ancestors to reveal %s without selection or focus changes", (path) => {
    directory("").select();
    directory("").focus();
    directory("").collapse();
    const scroll = vi.spyOn(tree(), "scrollToPath");
    reveal(path);
    expect(directory("").isExpanded()).toBe(true);
    expect(rows().map(({ path }) => path)).toContain(projected(path));
    expect(scroll).toHaveBeenCalledExactlyOnceWith(projected(path), { focus: false, offset: "nearest" });
    expect(tree().getSelectedPaths()).toEqual(["repo/"]);
    expect(tree().getFocusedPath()).toBe("repo/");
    expect(editor.open).not.toHaveBeenCalled();
  });
});

class InputElement extends EventTarget {
  constructor(readonly tagName: string, private readonly attributes: Record<string, string>) {
    super();
  }

  getAttribute(name: string) {
    return this.attributes[name] ?? null;
  }
}

function clickInput(modifiers: MouseEventInit = {}, targets: EventTarget[] = [new InputElement("BUTTON", { role: "treeitem" })]) {
  return {
    type: "click", eventPhase: 1, button: modifiers.button ?? 0,
    ctrlKey: modifiers.ctrlKey ?? false, metaKey: modifiers.metaKey ?? false, shiftKey: modifiers.shiftKey ?? false,
    composedPath: () => targets,
  };
}

function keyInput(key: string, modifiers: KeyboardEventInit = {}, targets?: EventTarget[]) {
  return { ...clickInput(modifiers, targets), type: "keydown", key, code: modifiers.code ?? "", isComposing: modifiers.isComposing ?? false, keyCode: 0 };
}

function dispatchInput(event: ReturnType<typeof clickInput> | ReturnType<typeof keyInput>, action: () => void = () => {}) {
  captureTreeInput(event);
  event.eventPhase = 2;
  action();
  event.eventPhase = 0;
}

function afterDispatch() {
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}

async function dispatchNativeInput(event: ReturnType<typeof clickInput>, action: () => void) {
  captureTreeInput(event);
  await Promise.resolve();
  event.eventPhase = 2;
  action();
  event.eventPhase = 0;
}

async function createSelectedFile(name: string) {
  startCreate({ kind: "selection" }, false);
  const path = tree().getSelectedPaths()[0];
  const target = path ? nodeFor(path) : null;
  if (!target || target.kind !== "file") throw new Error("Missing creation placeholder");
  await rename(target.path, target.path.slice(0, target.path.lastIndexOf("/") + 1) + name, false);
}

describe("tree input selection", () => {
  beforeEach(() => vi.stubGlobal("Element", InputElement));
  afterEach(() => vi.unstubAllGlobals());

  it.each([{ metaKey: true }, { ctrlKey: true }])("retains additive intent across the native capture checkpoint with %j", async (modifiers) => {
    directory("src/").select();
    setFilter("other/existing.ts");

    await dispatchNativeInput(clickInput(modifiers), () => {
      tree().getItem(projected("other/existing.ts"))?.select();
      tree().closeSearch();
    });
    await createSelectedFile("additive.ts");

    expect(rust.fsCreate).toHaveBeenCalledExactlyOnceWith("additive.ts", false);
    expect(editor.open).not.toHaveBeenCalledWith("other/existing.ts", { focus: false });
  });

  it.each([{ metaKey: true }, { ctrlKey: true }])("retains toggle intent across the native capture checkpoint with %j", async (modifiers) => {
    directory("src/").select();
    directory("other/").select();
    setFilter("other");

    await dispatchNativeInput(clickInput(modifiers), () => {
      directory("other/").deselect();
      tree().closeSearch();
    });
    await createSelectedFile("toggle-off.ts");

    expect(rust.fsCreate).toHaveBeenCalledExactlyOnceWith("src/toggle-off.ts", false);
  });

  it("settles unchanged replacement before immediate creation", async () => {
    directory("src/").select();
    directory("other/").select();
    setFilter("other");
    dispatchInput(clickInput(), () => directory("other/").select());

    await createSelectedFile("immediate.ts");

    expect(rust.fsCreate).toHaveBeenCalledExactlyOnceWith("other/immediate.ts", false);
  });

  it.each(["filter change", "watcher reset"])("settles unchanged replacement before an immediate %s", (action) => {
    directory("src/").select();
    directory("other/").select();
    setFilter("other");
    dispatchInput(clickInput(), () => directory("other/").select());

    if (action === "filter change") setFilter("existing.ts");
    else applyFsBatch({ gitMeta: false, overflow: false, changes: [{ path: "other/new.ts", isDir: false, exists: true }] });
    setFilter("");

    expect(tree().getSelectedPaths()).toEqual([projected("other/")]);
  });

  it("settles unchanged replacement before capturing the next input", async () => {
    directory("src/").select();
    directory("other/").select();
    setFilter("other");
    dispatchInput(clickInput(), () => directory("other/").select());
    dispatchInput(clickInput({ metaKey: true }), () => {
      directory("other/").deselect();
      tree().closeSearch();
    });

    await createSelectedFile("next-input.ts");

    expect(rust.fsCreate).toHaveBeenCalledExactlyOnceWith("next-input.ts", false);
  });

  it("keeps the hidden creation directory when native Escape closes search", async () => {
    directory("src/").select();
    setFilter("other/existing.ts");
    dispatchInput(keyInput("Escape"), () => tree().closeSearch());

    await createSelectedFile("native-clear.ts");

    expect(rust.fsCreate).toHaveBeenCalledExactlyOnceWith("src/native-clear.ts", false);
  });

  it.each([{ metaKey: true }, { ctrlKey: true }, { metaKey: true, shiftKey: true }, { ctrlKey: true, shiftKey: true }])(
    "retains hidden selection for additive input %j",
    async (modifiers) => {
      directory("src/").select();
      setFilter("other/existing.ts");
      dispatchInput(clickInput(modifiers), () => {
        tree().getItem(projected("other/existing.ts"))?.select();
        tree().closeSearch();
      });

      await createSelectedFile("additive.ts");

      expect(rust.fsCreate).toHaveBeenCalledExactlyOnceWith("additive.ts", false);
    },
  );

  it.each([{ metaKey: true }, { ctrlKey: true }])("retains hidden selection when toggling off the visible part with %j", async (modifiers) => {
    directory("src/").select();
    directory("other/").select();
    setFilter("other");
    dispatchInput(clickInput(modifiers), () => {
      directory("other/").deselect();
      tree().closeSearch();
    });

    await createSelectedFile("toggle-off.ts");

    expect(rust.fsCreate).toHaveBeenCalledExactlyOnceWith("src/toggle-off.ts", false);
  });

  it.each([{}, { shiftKey: true }])("replaces hidden selection on an unchanged visible selection with %j", async (modifiers) => {
    directory("src/").select();
    directory("").select();
    setFilter("missing");
    expect(tree().isSearchOpen()).toBe(false);
    dispatchInput(clickInput(modifiers), () => directory("").select());
    await afterDispatch();
    setFilter("");

    expect(tree().getSelectedPaths()).toEqual([projected("")]);
  });

  it("replaces an unchanged search result on Enter before search closes", () => {
    directory("src/").select();
    directory("other/").select();
    setFilter("other");
    dispatchInput(keyInput("Enter"), () => {
      directory("other/").select();
      tree().closeSearch();
    });

    expect(tree().getSelectedPaths()).toEqual([projected("other/")]);
  });

  it.each(["view cleanup", "query change", "disposal"])("cancels queued replacement on %s", async (cleanup) => {
    directory("src/").select();
    directory("").select();
    setFilter("missing");
    dispatchInput(clickInput(), () => {
      if (cleanup === "query change") setFilter("other");
    });
    if (cleanup === "view cleanup") clearTreeInput();
    else if (cleanup === "disposal") {
      dispose();
      await load();
      directory("src/").select();
      directory("").select();
      setFilter("missing");
    }
    await afterDispatch();
    setFilter("");

    expect(tree().getSelectedPaths()).toEqual([projected("src/"), projected("")]);
  });

  it("does not apply an ended input scope to a later programmatic selection", async () => {
    directory("src/").select();
    setFilter("other");
    dispatchInput(clickInput({ metaKey: true }));
    directory("other/").select();
    await afterDispatch();
    setFilter("");

    expect(tree().getSelectedPaths()).toEqual([projected("other/")]);
  });

  it("does not let an earlier queued completion clear the next input scope", async () => {
    directory("src/").select();
    setFilter("other");
    dispatchInput(keyInput("ArrowDown"));
    await dispatchNativeInput(clickInput({ metaKey: true }), () => directory("other/").select());
    await afterDispatch();
    setFilter("");

    expect(tree().getSelectedPaths()).toEqual([projected("src/"), projected("other/")]);
  });

  it("does not open a visible file while hidden canonical selection is retained", async () => {
    directory("src/").select();
    setFilter("other/existing.ts");
    dispatchInput(clickInput({ metaKey: true }), () => tree().getItem(projected("other/existing.ts"))?.select());
    await afterDispatch();
    setFilter("");

    expect(tree().getSelectedPaths()).toEqual([projected("src/"), projected("other/existing.ts")]);
    expect(editor.open).not.toHaveBeenCalled();
  });

  it.each([false, true])("opens an unchanged visible file once when replacement removes hidden selection, closeSearch=%s", async (closeSearch) => {
    directory("src/").select();
    tree().getItem(projected("other/existing.ts"))?.select();
    setFilter("other/existing.ts");
    dispatchInput(clickInput(), () => {
      tree().getItem(projected("other/existing.ts"))?.select();
      if (closeSearch) tree().closeSearch();
    });
    await afterDispatch();

    expect(editor.open).toHaveBeenCalledExactlyOnceWith("other/existing.ts", { focus: false });
  });

  it.each([false, true])("does not duplicate an editor open on selection callback and finalization, closeSearch=%s", async (closeSearch) => {
    directory("src/").select();
    setFilter("other/existing.ts");
    dispatchInput(clickInput(), () => {
      tree().getItem(projected("other/existing.ts"))?.select();
      if (closeSearch) tree().closeSearch();
    });
    await afterDispatch();

    expect(editor.open).toHaveBeenCalledExactlyOnceWith("other/existing.ts", { focus: false });
  });

  it("preserves hidden selection when search Enter belongs to composition", async () => {
    directory("src/").select();
    tree().getItem(projected("other/existing.ts"))?.select();
    setFilter("other/existing.ts");
    dispatchInput(keyInput("Enter", { isComposing: true }));
    await afterDispatch();
    setFilter("");

    expect(tree().getSelectedPaths()).toEqual([projected("src/"), projected("other/existing.ts")]);
    expect(editor.open).not.toHaveBeenCalled();
  });

  it("does not arm rename for the root or lose hidden selection on the following close", () => {
    directory("src/").select();
    setFilter("other");
    dispatchInput(keyInput("F2"), () => expect(tree().startRenaming(projected(""))).toBe(false));
    tree().closeSearch();

    expect(tree().getSelectedPaths()).toEqual([projected("src/")]);
  });
});

describe("native selection input precedence", () => {
  beforeEach(() => vi.stubGlobal("Element", InputElement));
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    { key: "Enter", searchOpen: true, expected: "replace" },
    { key: "Escape", searchOpen: true, expected: "preserve" },
    { key: "F2", searchOpen: true, expected: "preserve" },
    { key: "a", searchOpen: true, expected: "preserve" },
    { key: " ", searchOpen: true, expected: "preserve" },
    { key: "ArrowDown", searchOpen: true, expected: "preserve" },
    { key: "ArrowUp", searchOpen: true, expected: "preserve" },
    { key: "a", searchOpen: false, expected: "replace" },
    { key: " ", searchOpen: false, expected: "delta" },
    { key: "Spacebar", searchOpen: false, expected: "delta" },
    { key: "ArrowDown", searchOpen: false, expected: "delta" },
    { key: "ArrowUp", searchOpen: false, expected: "delta" },
    { key: "Enter", searchOpen: false, expected: "preserve" },
    { key: "F10", searchOpen: false, expected: "preserve" },
  ])("classifies $key with searchOpen=$searchOpen as $expected", ({ key, searchOpen, expected }) => {
    expect(selectionIntentFor(keyInput(key, { metaKey: true, shiftKey: true }), { searchOpen, hasFocusedItem: true })).toBe(expected);
  });

  it("requires a focused native item for keyboard selection shortcuts", () => {
    expect(selectionIntentFor(keyInput("a", { ctrlKey: true }), { searchOpen: false, hasFocusedItem: false })).toBe("preserve");
  });

  it.each([
    new InputElement("DIV", { role: "tree" }),
    new InputElement("INPUT", {}),
    new InputElement("TEXTAREA", {}),
    new InputElement("DIV", { contenteditable: "true" }),
    new InputElement("DIV", { role: "menu" }),
    new InputElement("BUTTON", { role: "menuitem" }),
  ])("ignores clicks outside a tree row or inside a control, %j", (target) => {
    const path = target.getAttribute("role") === "tree" ? [target] : [target, new InputElement("BUTTON", { role: "treeitem" })];
    expect(selectionIntentFor(clickInput({}, path), { searchOpen: false, hasFocusedItem: true })).toBeNull();
  });

  it("ignores rename input keys even when the native event is composing", () => {
    const event = { ...keyInput("Enter", {}, [new InputElement("INPUT", {}), new InputElement("BUTTON", { role: "treeitem" })]), isComposing: true } satisfies TreeInputEvent & { isComposing: boolean };
    expect(selectionIntentFor(event, { searchOpen: true, hasFocusedItem: true })).toBeNull();
  });

  it.each([
    keyInput("Enter", { isComposing: true }),
    { ...keyInput("Enter"), keyCode: 229 },
  ])("ignores composing search Enter on a tree row, %j", (event) => {
    expect(selectionIntentFor(event, { searchOpen: true, hasFocusedItem: true })).toBeNull();
  });

  it("ignores menu action keys when the menu uses ordinary buttons", () => {
    const targets = [new InputElement("BUTTON", {}), new InputElement("DIV", { role: "tree" })];
    expect(selectionIntentFor(keyInput("Enter", {}, targets), { searchOpen: true, hasFocusedItem: true })).toBeNull();
  });
});
