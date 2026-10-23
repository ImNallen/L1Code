import { Children, isValidElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { rust } from "@/core/ipc";
import { terminal } from "@/slices/terminal";
import { ExplorerContextMenu } from "./ExplorerContextMenu";
import { dispose, filePaths, load, treeModel, type TreeNode } from "./tree";

vi.mock("@/core/ipc", () => ({ rust: { fsList: vi.fn() }, errorMessage: String }));
vi.mock("@/core/workspace", () => ({
  workspaceState: { get: () => ({ status: "open", info: { name: "Sidebar demo", root: "/workspace/Sidebar demo", isGit: true } }) },
}));
vi.mock("@/slices/editor", () => ({ editor: { open: vi.fn() } }));
vi.mock("@/slices/terminal", () => ({ terminal: { open: vi.fn() } }));
vi.mock("@tauri-apps/plugin-opener", () => ({ revealItemInDir: vi.fn() }));

const writeText = vi.fn();
const close = vi.fn();
const workspaceRoot = "/workspace/Sidebar demo";

beforeEach(async () => {
  vi.resetAllMocks();
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  vi.mocked(rust.fsList).mockResolvedValue("src/\nsrc/a.ts\nroot.ts");
  await load();
});

afterEach(() => {
  dispose();
  vi.unstubAllGlobals();
});

function menu(node: TreeNode, root = workspaceRoot) {
  return ExplorerContextMenu({ node, root, close });
}

function click(node: TreeNode, label: string, root = workspaceRoot) {
  const button = Children.toArray(menu(node, root).props.children).find(
    (child) => isValidElement<{ children: string }>(child) && child.type === "button" && child.props.children === label,
  );
  if (!isValidElement<{ onClick: () => void }>(button)) throw new Error(`Missing button ${label}`);
  button.props.onClick();
  expect(close).toHaveBeenCalledOnce();
}

describe("explorer context actions", () => {
  it("hides root mutations and exposes safe root actions", () => {
    const html = renderToStaticMarkup(menu({ kind: "root" }));
    for (const label of ["Add File", "Add Folder", "Copy Relative Path", "Copy Path", "Reveal in Finder", "Open in Terminal", "Refresh"]) {
      expect(html).toContain(label);
    }
    expect(html).not.toContain("Rename");
    expect(html).not.toContain("Delete");
    const descendant = renderToStaticMarkup(menu({ kind: "file", path: "root.ts" }));
    expect(descendant).toContain("Rename");
    expect(descendant).toContain("Delete");
  });

  it.each([
    { label: "Add File…", path: "untitled" },
    { label: "Add Folder…", path: "new-folder/" },
  ])("creates at root through $label independently of selection", ({ label, path }) => {
    treeModel()?.getItem("Sidebar demo/src/")?.select();
    click({ kind: "root" }, label);
    expect(treeModel()?.getSelectedPaths()).toEqual(["Sidebar demo/" + path]);
    expect(filePaths()).toEqual(["src/a.ts", "root.ts"]);
  });

  it.each([
    { label: "Copy Path", expected: workspaceRoot },
    { label: "Copy Relative Path", expected: "." },
  ])("copies the root through $label", ({ label, expected }) => {
    click({ kind: "root" }, label);
    expect(writeText).toHaveBeenCalledExactlyOnceWith(expected);
  });

  it("reveals the absolute workspace root in Finder", () => {
    click({ kind: "root" }, "Reveal in Finder");
    expect(revealItemInDir).toHaveBeenCalledExactlyOnceWith(workspaceRoot);
  });

  it.each([
    { node: { kind: "root" }, cwd: undefined },
    { node: { kind: "file", path: "root.ts" }, cwd: undefined },
    { node: { kind: "directory", path: "src" }, cwd: { cwd: "src" } },
    { node: { kind: "file", path: "src/a.ts" }, cwd: { cwd: "src" } },
  ] satisfies { node: TreeNode; cwd: { cwd: string } | undefined }[])("opens a terminal for $node with a canonical cwd", ({ node, cwd }) => {
    click(node, "Open in Terminal");
    expect(terminal.open).toHaveBeenCalledExactlyOnceWith(cwd);
  });

  it.each([
    { root: workspaceRoot, expected: workspaceRoot + "/src/a.ts" },
    { root: "/", expected: "/src/a.ts" },
  ])("uses the absolute descendant path under $root", ({ root, expected }) => {
    click({ kind: "file", path: "src/a.ts" }, "Copy Path", root);
    expect(writeText).toHaveBeenCalledExactlyOnceWith(expected);
  });

  it("copies canonical relative descendant paths", () => {
    click({ kind: "directory", path: "src" }, "Copy Relative Path");
    expect(writeText).toHaveBeenCalledExactlyOnceWith("src");
  });

  it("refreshes the root without changing its selection", async () => {
    treeModel()?.getItem("Sidebar demo/")?.select();
    click({ kind: "root" }, "Refresh");
    await Promise.resolve();
    expect(rust.fsList).toHaveBeenCalledTimes(2);
    expect(treeModel()?.getSelectedPaths()).toEqual(["Sidebar demo/"]);
  });
});
