// The slice contract: the only thing the shell and the manifest know about a feature.
// A slice is one folder under src/slices/<id>/. Its index.ts exports the definition(s) and at most
// one owner API object. Everything else in the folder is private (enforced by eslint).

import type { ComponentType, LazyExoticComponent } from "react";
import type { LucideIcon } from "lucide-react";
import type { ReadStore } from "./store";

export type ViewComponent = ComponentType | LazyExoticComponent<ComponentType>;

/** A slice's persisted session value. `decode` is the validation boundary for old or bad JSON. */
export interface PersistSpec<T> {
  readonly key: string;
  snapshot(): T;
  decode(raw: unknown): T | undefined;
  restore(value: T): void | Promise<void>;
  /** Fires when the value worth persisting changes. */
  subscribe(listener: () => void): () => void;
}

interface SliceBase<Id extends string> {
  readonly id: Id;
  readonly title: string;
  readonly icon: LucideIcon;
  /** Reveals this slice's placement, e.g. "Mod+Shift+F". */
  readonly shortcut?: string;
  readonly component: ViewComponent;
  /** Right tools: stay mounted (hidden) when another tab is selected. Left views always stay mounted. */
  readonly keepAlive?: boolean;
  /** Small count shown next to the title, e.g. changed files. */
  readonly useBadge?: () => number | null;
  /** Commands, session, and activation this slice contributes. */
  readonly extras?: SliceExtras;
}

export interface LeftView<Id extends string = string> extends SliceBase<Id> {
  readonly placement: "left";
}
export interface RightTool<Id extends string = string> extends SliceBase<Id> {
  readonly placement: "right";
  /** False hides the tab entirely, e.g. Changes with nothing changed. Omit for always available. */
  readonly available?: ReadStore<boolean>;
}

export const defineLeftView = <Id extends string>(s: Omit<LeftView<Id>, "placement">): LeftView<Id> => ({ ...s, placement: "left" });
export const defineRightTool = <Id extends string>(s: Omit<RightTool<Id>, "placement">): RightTool<Id> => ({ ...s, placement: "right" });

/** Keyboard commands and app-wide pieces a slice contributes regardless of placement. */
export interface SliceExtras {
  readonly commands?: readonly Command[];
  readonly persist?: readonly PersistSpec<any>[]; // eslint-disable-line @typescript-eslint/no-explicit-any
  /** Rendered once at the app root, e.g. a quick-open overlay. */
  readonly overlay?: ComponentType;
  /** Runs once after a workspace opens. Return a cleanup. */
  activate?(): (() => void) | void;
}

export interface Command {
  readonly id: string;
  readonly chord: string;
  run(): void | Promise<void>;
}

export interface MainView {
  readonly component: ViewComponent;
  readonly extras?: SliceExtras;
}

export interface Manifest<L extends readonly LeftView[], R extends readonly RightTool[]> {
  readonly main: MainView;
  readonly left: L;
  readonly right: R;
}

export const defineManifest = <const L extends readonly LeftView[], const R extends readonly RightTool[]>(m: Manifest<L, R>) => m;

/** Every slice's extras, in manifest order. Derived, so there is no second list to keep in sync. */
export function allExtras(m: Manifest<readonly LeftView[], readonly RightTool[]>): SliceExtras[] {
  const seen = new Set<SliceExtras>();
  for (const e of [m.main.extras, ...m.left.map((v) => v.extras), ...m.right.map((v) => v.extras)]) if (e) seen.add(e);
  return [...seen];
}
