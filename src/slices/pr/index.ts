// Pull Request slice: the GitHub PR for the current branch, via the `gh` CLI.
// The tab shows only while the branch has a pull request.

import { lazy } from "react";
import { GitPullRequest } from "lucide-react";
import { defineRightTool, type SliceExtras } from "@/core/slice";
import { activate, prAvailable } from "./pr";

export const prTool = defineRightTool({
  id: "pr",
  title: "Pull Request",
  icon: GitPullRequest,
  component: lazy(() => import("./PrTool")),
  available: prAvailable,
});

export const prExtras: SliceExtras = { activate };
