import { FileTree, type FileTreeProps } from "@pierre/trees/react";
import { FilePlus, FolderPlus, RefreshCw } from "lucide-react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { useStore } from "@/core/store";
import { workspaceState } from "@/core/workspace";
import { terminal } from "@/slices/terminal";
import { explorerState, load, remove, startCreate, startRename, treeModel } from "./tree";
import "./explorer.css";

export default function ExplorerView() {
  const ws = useStore(workspaceState);
  const st = useStore(explorerState);
  const model = treeModel();
  const root = ws.status === "open" ? ws.info.root : "";

  const renderContextMenu: FileTreeProps["renderContextMenu"] = (item, ctx) => {
    const dir = item.kind === "directory" ? item.path : item.path.includes("/") ? item.path.slice(0, item.path.lastIndexOf("/")) : null;
    const run = (fn: () => void) => () => {
      ctx.close({ restoreFocus: false });
      fn();
    };
    const rel = item.path.replace(/\/$/, "");
    return (
      <div className="ctx-menu" data-file-tree-context-menu-root="true">
        <button onClick={run(() => startCreate(dir, false))}>New File…</button>
        <button onClick={run(() => startCreate(dir, true))}>New Folder…</button>
        <hr />
        <button onClick={run(() => startRename(item.path))}>Rename…</button>
        <button onClick={run(() => void remove(item.path))}>Move to Trash</button>
        <hr />
        <button onClick={run(() => void navigator.clipboard.writeText(rel))}>Copy Relative Path</button>
        <button onClick={run(() => void navigator.clipboard.writeText(`${root}/${rel}`))}>Copy Path</button>
        <button onClick={run(() => void revealItemInDir(`${root}/${rel}`))}>Reveal in Finder</button>
        {dir !== null && <button onClick={run(() => void terminal.open({ cwd: dir.replace(/\/$/, "") }))}>Open in Terminal</button>}
      </div>
    );
  };

  return (
    <div className="panel explorer">
      <div className="panel-header">
        <span className="explorer-root" title={root}>
          {ws.status === "open" ? ws.info.name : "Explorer"}
        </span>
        <div className="spacer" />
        <button className="icon-btn" title="New File" onClick={() => startCreate(null, false)}>
          <FilePlus />
        </button>
        <button className="icon-btn" title="New Folder" onClick={() => startCreate(null, true)}>
          <FolderPlus />
        </button>
        <button className="icon-btn" title="Refresh" onClick={() => void load()}>
          <RefreshCw />
        </button>
      </div>
      <div className="explorer-tree">
        {model ? (
          <FileTree model={model} renderContextMenu={renderContextMenu} style={{ height: "100%" }} />
        ) : (
          <div className="empty">{st.status === "failed" ? "Couldn't list files." : "Loading files…"}</div>
        )}
      </div>
    </div>
  );
}
