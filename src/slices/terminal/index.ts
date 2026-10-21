// Terminal slice: tabs of shells whose PTYs live in Rust and survive reloads.
// Public surface: `terminalTool` (definition), `terminal` (owner API), `terminalExtras` (activation).

import { lazy } from "react";
import { SquareTerminal } from "lucide-react";
import { reveal } from "@/core/reveal";
import { defineRightTool, type SliceExtras } from "@/core/slice";
import { activate, openSession } from "./sessions";

export const terminalTool = defineRightTool({
  id: "terminal",
  title: "Terminal",
  icon: SquareTerminal,
  shortcut: "Ctrl+`",
  component: lazy(() => import("./TerminalTool")),
  keepAlive: true,
});

export const terminal = {
  /** Start a new shell (in `cwd`, workspace-relative, or the root) and reveal the Terminal tool. */
  async open(opts?: { cwd?: string }): Promise<void> {
    reveal("terminal");
    await openSession(opts?.cwd);
  },
};

export const terminalExtras: SliceExtras = {
  activate,
};
