import { FileTree, type FileTreeProps } from "@pierre/trees/react";
import { useEffect, useRef } from "react";
import { FilePlus, FolderPlus, Search, X } from "lucide-react";
import { onReveal } from "@/core/reveal";
import { useStore } from "@/core/store";
import { workspaceState } from "@/core/workspace";
import { editor } from "@/slices/editor";
import { captureTreeInput, clearTreeInput, explorerFilter, explorerState, firstMatch, nodeFor, setFilter, startCreate, treeModel } from "./tree";
import { ExplorerContextMenu } from "./ExplorerContextMenu";
import "./explorer.css";

export default function ExplorerView() {
  const ws = useStore(workspaceState);
  const st = useStore(explorerState);
  const filter = useStore(explorerFilter);
  const input = useRef<HTMLInputElement>(null);
  const model = treeModel();
  useEffect(() => clearTreeInput, [model]);

  // The explorer shortcut lands in the filter box.
  useEffect(
    () =>
      onReveal((id) => {
        if (id !== "explorer") return;
        requestAnimationFrame(() => {
          input.current?.focus();
          input.current?.select();
        });
      }),
    [],
  );
  const root = ws.status === "open" ? ws.info.root : "";

  const renderContextMenu: FileTreeProps["renderContextMenu"] = (item, ctx) => {
    const node = nodeFor(item.path);
    if (!node) return null;
    return <ExplorerContextMenu node={node} root={root} close={() => ctx.close({ restoreFocus: false })} />;
  };

  return (
    <div className="panel explorer">
      <div className="explorer-bar">
        <div className="explorer-filter">
          <Search className="explorer-filter-icon" />
          <input
            ref={input}
            className="input"
            value={filter}
            placeholder="Search"
            aria-label="Search files"
            onChange={(e) => setFilter(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                const path = firstMatch();
                if (path) void editor.open(path);
              }
              if (e.key === "Escape") {
                if (filter) setFilter("");
                else input.current?.blur();
              }
            }}
          />
          {filter && (
            <button className="icon-btn" title="Clear search" aria-label="Clear search" onClick={() => setFilter("")}>
              <X />
            </button>
          )}
        </div>
        <button className="icon-btn" title="Add folder" aria-label="Add folder" onClick={() => startCreate({ kind: "selection" }, true)}>
          <FolderPlus />
        </button>
        <button className="icon-btn" title="Add file" aria-label="Add file" onClick={() => startCreate({ kind: "selection" }, false)}>
          <FilePlus />
        </button>
      </div>
      <div className="explorer-tree">
        {model ? (
          <FileTree
            model={model}
            renderContextMenu={renderContextMenu}
            onClickCapture={(event) => captureTreeInput(event.nativeEvent)}
            onKeyDownCapture={(event) => captureTreeInput(event.nativeEvent)}
            style={{ height: "100%" }}
          />
        ) : (
          <div className="empty">{st.status === "failed" ? "Couldn't list files." : "Loading files…"}</div>
        )}
      </div>
    </div>
  );
}
