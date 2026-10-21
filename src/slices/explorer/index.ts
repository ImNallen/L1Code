// Explorer slice: the workspace path index, the file tree, and quick open.

import { lazy } from "react";
import { FolderTree } from "lucide-react";
import { defineLeftView, type SliceExtras } from "@/core/slice";
import { watch } from "@/core/store";
import { onFsBatch } from "@/core/workspace";
import { editor } from "@/slices/editor";
import { scm } from "@/slices/scm";
import { toggleQuickOpen } from "./quickOpenState";
import { applyFsBatch, applyGitStatus, dispose, load, reveal } from "./tree";

export const explorerView = defineLeftView({
  id: "explorer",
  title: "Explorer",
  icon: FolderTree,
  shortcut: "Mod+Shift+E",
  component: lazy(() => import("./ExplorerView")),
  keepAlive: true,
});

export const explorer = {
  /** Expand to `path` and scroll it into view. */
  reveal,
};

export const explorerExtras: SliceExtras = {
  commands: [{ id: "explorer.quickOpen", chord: "Mod+p", run: toggleQuickOpen }],
  overlay: lazy(() => import("./QuickOpen")),
  activate() {
    void load().then(() => applyGitStatus(scm.state.get().status));
    const offFs = onFsBatch(applyFsBatch);
    const offGit = watch(scm.state, (s) => s.status, applyGitStatus);
    const offActive = watch(
      { get: editor.activePath, subscribe: (l) => editor.subscribeActive(l) },
      (p) => p,
      (p) => p && reveal(p),
    );
    return () => {
      offFs();
      offGit();
      offActive();
      dispose();
    };
  },
};
