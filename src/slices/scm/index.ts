// Source control slice: the git domain and the right Changes tool, which diffs, stages, and commits.
// Public surface: `changesTool`, `scm` (owner API), `scmExtras`.

import { lazy } from "react";
import { FileDiff } from "lucide-react";
import { defineRightTool, type SliceExtras } from "@/core/slice";
import { derive } from "@/core/store";
import * as s from "./state";

export type { ScmState } from "./state";

export const changesTool = defineRightTool({
  id: "changes",
  title: "Changes",
  icon: FileDiff,
  shortcut: "Mod+Shift+D",
  component: lazy(() => import("./ChangesTool")),
  useBadge: s.useChangedCount,
  available: derive(s.scmState, (st) => (st.status?.files.length ?? 0) > 0),
});

export const scm = {
  state: s.scmState,
  useState: s.useScmState,
  /** Re-reads git status. Debounced, single-flight, and never throws. */
  refresh: s.refresh,
  /** Focuses `path` and reveals the Changes tool scrolled to its diff. */
  showChanges: s.showChanges,
  useFocusedPath: s.useFocusedPath,
};

export const scmExtras: SliceExtras = {
  activate: s.activate,
};
