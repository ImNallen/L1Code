import { FolderOpen } from "lucide-react";
import { chordLabel } from "@/core/keys";
import { useStore } from "@/core/store";
import { recentWorkspaces, workspaceState } from "@/core/workspace";
import { openPath, pickFolder } from "./boot";

export function Welcome() {
  const ws = useStore(workspaceState);
  const recent = recentWorkspaces();
  const home = recent[0]?.match(/^\/Users\/[^/]+/)?.[0];
  return (
    <div className="welcome">
      <div className="welcome-card">
        <div className="welcome-mark">L1</div>
        <h1>L1Code</h1>
        <p className="welcome-sub">A fast editor for quick edits.</p>
        {ws.status === "opening" && <p className="welcome-sub">Opening {ws.path}…</p>}
        {ws.status === "failed" && <p className="welcome-error">{ws.message}</p>}
        <button className="btn primary welcome-open" onClick={() => void pickFolder()}>
          <FolderOpen size={15} /> Open Folder <kbd>{chordLabel("Mod+o")}</kbd>
        </button>
        {recent.length > 0 && (
          <div className="welcome-recent">
            <div className="panel-header">Recent</div>
            {recent.map((r) => (
              <div key={r} className="row" onClick={() => void openPath(r)} title={r}>
                <span className="name">{r.slice(r.lastIndexOf("/") + 1)}</span>
                <span className="dim">{home && r.startsWith(home) ? "~" + r.slice(home.length) : r}</span>
              </div>
            ))}
          </div>
        )}
        <p className="welcome-hint mono">l1code &lt;path&gt;</p>
      </div>
    </div>
  );
}
