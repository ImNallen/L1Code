// Shown when the active doc's file changed or vanished on disk while it had unsaved edits.

import { lazy, Suspense, useState } from "react";
import { useStore } from "@/core/store";
import { closeDocument, docsState, resolveConflict, saveDocument } from "./documents";

const CompareDialog = lazy(() => import("./CompareDialog"));

export function ConflictBanner() {
  const doc = useStore(docsState, (s) => s.open.find((d) => d.path === s.active) ?? null);
  const [comparing, setComparing] = useState(false);
  if (!doc || doc.disk.kind === "synced") return null;

  if (doc.disk.kind === "deleted") {
    return (
      <div className="conflict-banner">
        <span>This file was deleted on disk. Your copy is kept.</span>
        <div className="spacer" />
        <button className="btn" onClick={() => void saveDocument(doc.path)}>Save to recreate</button>
        <button className="btn" onClick={() => void closeDocument(doc.path)}>Close</button>
      </div>
    );
  }

  const disk = doc.disk;
  return (
    <div className="conflict-banner">
      <span>This file changed on disk while you were editing.</span>
      <div className="spacer" />
      <button className="btn" onClick={() => setComparing(true)}>Compare</button>
      <button className="btn" onClick={() => resolveConflict(doc.path, "takeDisk")}>Take disk</button>
      <button className="btn primary" onClick={() => resolveConflict(doc.path, "keepMine")}>Keep mine</button>
      {comparing && (
        <Suspense fallback={null}>
          <CompareDialog path={doc.path} disk={disk.text.toString()} mine={doc.state.doc.toString()} onClose={() => setComparing(false)} />
        </Suspense>
      )}
    </div>
  );
}
