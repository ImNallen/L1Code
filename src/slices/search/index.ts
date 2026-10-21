// Search slice: workspace text search streamed from Rust, grouped by file.
// Public surface: `searchView` (definition) and `searchExtras` (session).

import { lazy } from "react";
import { Search } from "lucide-react";
import { defineLeftView, type SliceExtras } from "@/core/slice";
import { sessionSpec } from "./search";

export const searchView = defineLeftView({
  id: "search",
  title: "Search",
  icon: Search,
  shortcut: "Mod+Shift+F",
  component: lazy(() => import("./SearchView")),
});

export const searchExtras: SliceExtras = {
  persist: [sessionSpec],
};
