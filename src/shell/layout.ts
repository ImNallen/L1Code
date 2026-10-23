// Owns which right tool is showing, column visibility, column sizes, and whether settings replace the workbench.
// Valid ids come from the manifest, so a stale id from an older session falls back to the default.

import type { PersistSpec } from "@/core/slice";
import { createStore, watch, type ReadStore } from "@/core/store";
import { manifest, type LeftViewId, type RightToolId } from "@/slices/manifest";
import { settingsSections, type SettingsSectionId } from "@/slices/settings";

export interface LayoutState {
  readonly right: RightToolId;
  readonly leftOpen: boolean;
  readonly rightOpen: boolean;
  /** Last open width of each side column, in pixels. */
  readonly leftWidth: number;
  readonly rightWidth: number;
  /** Right tools that have been shown at least once; keepAlive tools stay mounted after that. */
  readonly visited: readonly RightToolId[];
  /** Right tools the user closed. Revealing a tool reopens it. */
  readonly closed: readonly RightToolId[];
  /** The settings section shown in place of the left views and the editor, or null for the workbench. */
  readonly settings: SettingsSectionId | null;
}

const leftIds = manifest.left.map((v) => v.id) as LeftViewId[];
const rightIds = manifest.right.map((v) => v.id) as RightToolId[];
const defaultRight: RightToolId = rightIds.includes("terminal" as RightToolId) ? ("terminal" as RightToolId) : rightIds[0]!;

const store = createStore<LayoutState>({
  right: defaultRight,
  leftOpen: true,
  rightOpen: false,
  leftWidth: 270,
  rightWidth: 460,
  visited: [],
  closed: [],
  settings: null,
});
export const layout: ReadStore<LayoutState> = store;

export function showRight(id: RightToolId): void {
  store.update((s) => ({
    ...s,
    right: id,
    rightOpen: true,
    visited: s.visited.includes(id) ? s.visited : [...s.visited, id],
    closed: s.closed.filter((c) => c !== id),
  }));
}

/** Removes a tool's tab. It unmounts and stays closed until revealed again. */
export function closeTool(id: RightToolId): void {
  store.update((s) => (s.closed.includes(id) ? s : { ...s, closed: [...s.closed, id], visited: s.visited.filter((v) => v !== id) }));
}

let lastSection: SettingsSectionId = settingsSections[0]!.id;

/** Shows settings at `section`, or at the section shown last. */
export function openSettings(section: SettingsSectionId = lastSection): void {
  lastSection = section;
  store.update((s) => (s.settings === section ? s : { ...s, settings: section }));
}

export function closeSettings(): void {
  store.update((s) => (s.settings === null ? s : { ...s, settings: null }));
}

export function toggleSettings(): void {
  if (store.get().settings) closeSettings();
  else openSettings();
}

/** Show a left view or right tool by id. Unknown ids are ignored. A left view replaces settings. */
export function revealView(id: string): void {
  if ((leftIds as string[]).includes(id)) {
    closeSettings();
    setColumnOpen("left", true);
  } else if ((rightIds as string[]).includes(id)) showRight(id as RightToolId);
}

/** A right tool's shortcut toggles it: shows it, or hides the column if it is already showing. */
export function toggleView(id: string): void {
  const s = store.get();
  if (s.rightOpen && s.right === id && !(s.closed as string[]).includes(id)) setColumnOpen("right", false);
  else revealView(id);
}

export function setColumnOpen(side: "left" | "right", open: boolean): void {
  store.update((s) => {
    if (side === "left") return { ...s, leftOpen: open };
    return { ...s, rightOpen: open, visited: open && !s.visited.includes(s.right) ? [...s.visited, s.right] : s.visited };
  });
}

export function toggleColumn(side: "left" | "right"): void {
  const s = store.get();
  setColumnOpen(side, side === "left" ? !s.leftOpen : !s.rightOpen);
}

/**
 * A side column was resized, by the user or by us. A drag to zero closes it; a drag open opens it.
 * Programmatic changes already agree with the store, so they are no-ops here.
 */
export function columnResized(side: "left" | "right", px: number): void {
  store.update((s) => {
    const open = px > 0;
    const width = Math.round(px);
    if (side === "left") {
      if (open === s.leftOpen && (!open || width === s.leftWidth)) return s;
      return { ...s, leftOpen: open, leftWidth: open ? width : s.leftWidth };
    }
    if (open === s.rightOpen && (!open || width === s.rightWidth)) return s;
    const visited = open && !s.visited.includes(s.right) ? [...s.visited, s.right] : s.visited;
    return { ...s, rightOpen: open, rightWidth: open ? width : s.rightWidth, visited };
  });
}

type Saved = Pick<LayoutState, "right" | "leftOpen" | "rightOpen" | "leftWidth" | "rightWidth" | "closed">;

export const layoutSpec: PersistSpec<Saved> = {
  key: "layout",
  snapshot: () => {
    const { right, leftOpen, rightOpen, leftWidth, rightWidth, closed } = store.get();
    return { right, leftOpen, rightOpen, leftWidth, rightWidth, closed };
  },
  decode(raw) {
    if (!raw || typeof raw !== "object") return undefined;
    const r = raw as Partial<Saved>;
    const width = (v: unknown, d: number) => (typeof v === "number" && v >= 160 && v <= 2000 ? v : d);
    return {
      right: (rightIds as string[]).includes(r.right as string) ? (r.right as RightToolId) : defaultRight,
      leftOpen: typeof r.leftOpen === "boolean" ? r.leftOpen : true,
      rightOpen: typeof r.rightOpen === "boolean" ? r.rightOpen : false,
      leftWidth: width(r.leftWidth, 270),
      rightWidth: width(r.rightWidth, 460),
      closed: Array.isArray(r.closed) ? r.closed.filter((c): c is RightToolId => (rightIds as string[]).includes(c as string)) : [],
    };
  },
  restore(v) {
    store.update((s) => ({ ...s, ...v, visited: v.rightOpen ? [v.right] : [] }));
  },
  subscribe: (l) => watch(store, (s) => [s.right, s.leftOpen, s.rightOpen, s.leftWidth, s.rightWidth, s.closed.join(",")].join("|"), l),
};
