// The font surfaces: what each one is called, which settings hold its family and size, and the stack
// it falls back to. Fonts reach CSS only through `fontsCss`, as colors reach it through `paletteCss`.

import type { FamilyKey, KeyOf, Settings } from "./model";

export type FontSurface = "ui" | "editor" | "terminal";

export interface FontDef {
  readonly kind: "font";
  readonly surface: FontSurface;
  readonly label: string;
  readonly description: string;
  readonly family: FamilyKey;
  readonly size: KeyOf<number>;
  readonly options: readonly number[];
  /** Lists only fixed-width families in the picker. */
  readonly mono: boolean;
  readonly fallback: (s: Settings) => string;
}

const UI_STACK = '-apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", sans-serif';
const MONO_STACK = '"JetBrains Mono", "SF Mono", ui-monospace, Menlo, monospace';

export const fontSurfaces = {
  ui: {
    kind: "font",
    surface: "ui",
    label: "Interface",
    description: "Sidebars, tabs, menus, and settings.",
    family: "uiFontFamily",
    size: "uiFontSize",
    options: [11, 12, 13, 14, 15, 16],
    mono: false,
    fallback: () => UI_STACK,
  },
  editor: {
    kind: "font",
    surface: "editor",
    label: "Editor",
    description: "The code editor, diffs, and other code.",
    family: "editorFontFamily",
    size: "editorFontSize",
    options: [11, 12, 13, 14, 15, 16, 18, 20],
    mono: true,
    fallback: () => MONO_STACK,
  },
  terminal: {
    kind: "font",
    surface: "terminal",
    label: "Terminal",
    description: "Terminal sessions. The default follows the editor font.",
    family: "terminalFontFamily",
    size: "terminalFontSize",
    options: [11, 12, 12.5, 13, 14, 15, 16, 18],
    mono: true,
    fallback: (s) => fontStack("editor", s),
  },
} as const satisfies Readonly<Record<FontSurface, FontDef>>;

const GENERIC = /^(serif|sans-serif|monospace|cursive|fantasy|math|emoji|system-ui|ui-(serif|sans-serif|monospace|rounded)|-apple-system)$/i;

/**
 * A stored family list as CSS. Every name but a generic family is quoted, and quotes and backslashes
 * are dropped, so no stored text can end the string and escape into the stylesheet.
 */
export function familyCss(list: string): string {
  return list
    .split(",")
    .map((name) => name.replace(/["'\\\n\r]/g, "").trim())
    .filter(Boolean)
    .map((name) => (GENERIC.test(name) ? name : `"${name}"`))
    .join(", ");
}

/** The surface's chosen families, then its default stack. */
export function fontStack(surface: FontSurface, s: Settings): string {
  const def: FontDef = fontSurfaces[surface];
  const custom = familyCss(s[def.family]);
  return custom ? `${custom}, ${def.fallback(s)}` : def.fallback(s);
}

export function fontsCss(s: Settings): string {
  const base = s.uiFontSize;
  return (
    `:root{--font-ui:${fontStack("ui", s)};--font-mono:${fontStack("editor", s)};` +
    `--editor-font-size:${s.editorFontSize}px;--text-xs:${base - 2}px;--text-sm:${base - 1}px;--text-md:${base}px;}`
  );
}
