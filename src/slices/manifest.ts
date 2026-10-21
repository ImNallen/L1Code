// THE list of features. The shell derives the left segments, right tabs, shortcuts, valid layout
// ids, commands, session specs, and activation order from this object alone.
// Adding a view or tool = one import + one array entry here.

import { defineManifest } from "@/core/slice";
import { EditorMain, editorExtras } from "@/slices/editor";
import { explorerExtras, explorerView } from "@/slices/explorer";
import { prExtras, prTool } from "@/slices/pr";
import { previewExtras, previewTool } from "@/slices/preview";
import { changesTool, scmExtras } from "@/slices/scm";
import { terminalExtras, terminalTool } from "@/slices/terminal";

export const manifest = defineManifest({
  main: { component: EditorMain, extras: editorExtras },
  left: [{ ...explorerView, extras: explorerExtras }],
  right: [
    { ...previewTool, extras: previewExtras },
    { ...prTool, extras: prExtras },
    { ...terminalTool, extras: terminalExtras },
    { ...changesTool, extras: scmExtras },
  ],
});

export type LeftViewId = (typeof manifest.left)[number]["id"];
export type RightToolId = (typeof manifest.right)[number]["id"];
