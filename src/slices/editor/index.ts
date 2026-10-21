// Editor slice: open documents, tabs, save, and external-change reconciliation.
// Public surface: `editor` (owner API) and `editorExtras` (commands, session, activation).

import { lazy } from "react";
import type { SliceExtras } from "@/core/slice";
import * as docs from "./documents";

export type { OpenOptions } from "./documents";

export const editor = {
  /** Focus the tab for `path`, or read it from disk and open it. Resolves false if it can't be edited. */
  open: docs.openDocument,
  /** Save `path`, or the active document. No-op when clean. */
  save: docs.saveDocument,
  saveAll: docs.saveAll,
  /** Close a tab, asking about unsaved changes. Resolves false if the user cancels. */
  close: docs.closeDocument,
  /** Close every tab with one prompt. Resolves false if the user cancels. */
  closeAll: docs.closeAllDocuments,
  /** A file or folder was renamed inside the app: retarget open tabs, keeping drafts. */
  moved: docs.moveDocuments,
  activePath: docs.activePath,
  useActivePath: docs.useActivePath,
  /** Fires on any document change; pair with `watch` and `activePath` to track the active tab. */
  subscribeActive: (listener: () => void) => docs.docsState.subscribe(listener),
  hasDirty: docs.hasDirty,
};

export const EditorMain = lazy(() => import("./EditorPane"));

export const editorExtras: SliceExtras = {
  commands: [
    { id: "editor.save", chord: "Mod+s", run: () => docs.saveDocument() },
    { id: "editor.saveAll", chord: "Mod+Alt+s", run: () => docs.saveAll() },
    { id: "editor.close", chord: "Mod+w", run: () => docs.closeActive() },
    { id: "editor.nextTab", chord: "Ctrl+Tab", run: () => docs.cycleTab(1) },
    { id: "editor.prevTab", chord: "Ctrl+Shift+Tab", run: () => docs.cycleTab(-1) },
  ],
  persist: [docs.sessionSpec],
  activate: docs.activate,
};
