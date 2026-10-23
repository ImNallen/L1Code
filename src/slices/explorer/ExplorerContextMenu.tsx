import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { terminal } from "@/slices/terminal";
import { directoryFor, load, remove, startCreate, startRename, type TreeNode } from "./tree";

export function ExplorerContextMenu({ node, root, close }: { node: TreeNode; root: string; close: () => void }) {
  const dir = directoryFor(node);
  const run = (fn: () => void) => () => {
    close();
    fn();
  };
  const rel = node.kind === "root" ? "." : node.path;
  const absolute = node.kind === "root" ? root : `${root.replace(/\/$/, "")}/${node.path}`;
  return (
    <div className="ctx-menu" data-file-tree-context-menu-root="true">
      <button onClick={run(() => startCreate({ kind: "item", node }, false))}>Add File…</button>
      <button onClick={run(() => startCreate({ kind: "item", node }, true))}>Add Folder…</button>
      <hr />
      {node.kind !== "root" && (
        <>
          <button onClick={run(() => startRename(node))}>Rename…</button>
          <button onClick={run(() => void remove(node))}>Delete</button>
          <hr />
        </>
      )}
      <button onClick={run(() => void navigator.clipboard.writeText(rel))}>Copy Relative Path</button>
      <button onClick={run(() => void navigator.clipboard.writeText(absolute))}>Copy Path</button>
      <button onClick={run(() => void revealItemInDir(absolute))}>Reveal in Finder</button>
      <button onClick={run(() => void terminal.open(dir.kind === "root" ? undefined : { cwd: dir.path }))}>Open in Terminal</button>
      <hr />
      <button onClick={run(() => void load())}>Refresh</button>
    </div>
  );
}
