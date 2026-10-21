// Preview slice: an iframe pointed at a dev server, with an "open in browser" fallback.
// Public surface: `previewTool` (definition), `preview` (owner API), `previewExtras` (session).

import { lazy } from "react";
import { Globe } from "lucide-react";
import { defineRightTool, type SliceExtras } from "@/core/slice";
import { openPreview, sessionSpec } from "./state";

export const previewTool = defineRightTool({
  id: "preview",
  title: "Preview",
  icon: Globe,
  component: lazy(() => import("./PreviewTool")),
  keepAlive: true,
});

export const preview = {
  /** Show `url` (shorthand like `3000` is accepted) and reveal the Preview tool. */
  open: openPreview,
};

export const previewExtras: SliceExtras = {
  persist: [sessionSpec],
};
