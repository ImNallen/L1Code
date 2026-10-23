// Compiles each theme variant into one complete, typed palette and resolves which one is showing.
// Everything that paints a color reads a `Palette`: CSS through `paletteCss`, canvas consumers directly.

import { BLACK, contrast, hex, INK, lab, mix, WHITE, ZINC, type Hex, type Lab } from "./color";
import { schemeColors, themes, type AnsiColors, type Scheme, type Seeds, type SyntaxColors, type ThemeId } from "./themes";

/** Every app color token. Each key is a variable on `<html>` in kebab case: bgPanel is --bg-panel. */
export interface UiColors {
  bg: Hex; bgPanel: Hex; bgElev: Hex; bgInput: Hex; bgHover: Hex; bgActive: Hex; bgSelected: Hex;
  border: Hex; borderStrong: Hex;
  fg: Hex; fgMuted: Hex; fgSubtle: Hex; fgFaint: Hex; sidebarFg: Hex;
  accent: Hex; accentStrong: Hex; accentBg: Hex; onAccent: Hex; action: Hex; actionStrong: Hex; onAction: Hex;
  success: Hex; successBg: Hex; warning: Hex; warningBg: Hex; warningLine: Hex; danger: Hex; dangerBg: Hex; dangerLine: Hex;
  merged: Hex; mergedBg: Hex; added: Hex; modified: Hex; deleted: Hex; untracked: Hex;
  scrollbar: Hex; scrollbarHover: Hex; shadow: Hex; shadowStrong: Hex; backdrop: Hex; backdropSoft: Hex;
  editorSelection: Hex; editorActiveLine: Hex; editorGutter: Hex;
  matchBg: Hex; matchLine: Hex; searchBg: Hex; searchLine: Hex; searchCurrent: Hex;
}

/** Structurally an xterm `ITheme`, so the terminal assigns it as is. */
export type TerminalColors = AnsiColors & {
  readonly [K in "background" | "foreground" | "cursor" | "cursorAccent" | "selectionBackground"]: Hex;
};

export interface Palette {
  readonly id: ThemeId;
  readonly scheme: Scheme;
  readonly ui: Readonly<UiColors>;
  readonly syntax: SyntaxColors;
  readonly terminal: TerminalColors;
  /** Theme card orb: canvas 20% toward white (light) or zinc-950 (dark), lit by the accent and a 45% action glow. */
  readonly orb: { readonly fill: Hex; readonly accent: Hex; readonly glow: Hex };
}

export function compile(id: ThemeId, scheme: Scheme, seeds: Seeds): Palette {
  const dark = scheme === "dark";
  const fixed = schemeColors[scheme];
  const canvas = lab(seeds.canvas), sidebar = lab(seeds.sidebar), text = lab(seeds.text), border = lab(seeds.border);
  const accent = lab(seeds.accent), action = lab(seeds.action ?? seeds.accent), surface = lab(seeds.surface ?? seeds.canvas);
  const ok = lab(fixed.status.success), warn = lab(fixed.status.warning), bad = lab(fixed.status.danger), merged = lab(fixed.status.merged);
  /** Hover, active, and selected rows sit on the side panels. */
  const toward = (c: Lab, t: number) => hex(mix(sidebar, c, t));
  const ink = (on: Lab) => (contrast(hex(on), hex(INK)) >= contrast(hex(on), hex(WHITE)) ? hex(INK) : hex(WHITE));
  /** Translucent overlays lighten in dark schemes and darken with the text color in light ones. */
  const veil = dark ? WHITE : text;
  const ui: UiColors = {
    bg: hex(canvas),
    bgPanel: hex(sidebar),
    bgElev: hex(dark ? mix(surface, text, 0.06) : mix(surface, WHITE, 0.6)),
    bgInput: hex(dark ? mix(canvas, INK, 0.25) : mix(canvas, WHITE, 0.7)),
    bgHover: toward(text, dark ? 0.06 : 0.05),
    bgActive: toward(text, dark ? 0.11 : 0.09),
    bgSelected: toward(accent, dark ? 0.24 : 0.14),
    border: hex(border),
    borderStrong: hex(mix(border, text, dark ? 0.08 : 0.1)),
    fg: hex(text),
    fgMuted: hex(mix(text, canvas, dark ? 0.32 : 0.28)),
    fgSubtle: hex(mix(text, canvas, dark ? 0.52 : 0.42)),
    fgFaint: hex(mix(canvas, text, dark ? 0.09 : 0.07)),
    sidebarFg: hex(mix(text, sidebar, 0.1)),
    accent: hex(accent),
    accentStrong: hex(mix(accent, dark ? WHITE : INK, 0.2)),
    accentBg: hex(accent, 0.14),
    onAccent: ink(accent),
    action: hex(action),
    actionStrong: hex(mix(action, dark ? WHITE : INK, 0.2)),
    onAction: ink(action),
    success: hex(ok),
    successBg: hex(ok, 0.15),
    warning: hex(warn),
    warningBg: hex(warn, 0.1),
    warningLine: hex(warn, 0.3),
    danger: hex(bad),
    dangerBg: hex(bad, 0.12),
    dangerLine: hex(bad, 0.5),
    merged: hex(merged),
    mergedBg: hex(merged, 0.16),
    added: hex(ok),
    modified: hex(warn),
    deleted: hex(bad),
    untracked: hex(ok),
    scrollbar: hex(veil, dark ? 0.08 : 0.14),
    scrollbarHover: hex(veil, dark ? 0.16 : 0.26),
    shadow: hex(BLACK, dark ? 0.45 : 0.12),
    shadowStrong: hex(BLACK, dark ? 0.5 : 0.18),
    backdrop: hex(BLACK, dark ? 0.5 : 0.25),
    backdropSoft: hex(BLACK, dark ? 0.25 : 0.1),
    editorSelection: hex(mix(canvas, accent, dark ? 0.28 : 0.2)),
    editorActiveLine: hex(veil, dark ? 0.03 : 0.035),
    editorGutter: hex(mix(text, canvas, 0.65)),
    matchBg: hex(accent, 0.18),
    matchLine: hex(accent, 0.4),
    searchBg: hex(warn, 0.25),
    searchLine: hex(warn, 0.5),
    searchCurrent: hex(warn, 0.45),
    ...seeds.pin,
  };
  return {
    id,
    scheme,
    ui,
    syntax: fixed.syntax,
    terminal: {
      ...fixed.ansi,
      background: ui.bgPanel,
      foreground: ui.fg,
      cursor: ui.accent,
      cursorAccent: ui.bgPanel,
      selectionBackground: hex(accent, 0.3),
    },
    orb: { fill: hex(mix(canvas, dark ? ZINC : WHITE, 0.2)), accent: ui.accent, glow: hex(action, 0.45) },
  };
}

/** All twelve palettes, compiled once. Interned, so a store holding one changes identity only when the colors do. */
export const palettes = Object.fromEntries(
  themes.map((t) => [t.id, { light: compile(t.id, "light", t.variants.light), dark: compile(t.id, "dark", t.variants.dark) }]),
) as { readonly [I in ThemeId]: Readonly<Record<Scheme, Palette>> };

export interface AppearancePrefs {
  readonly appearanceMode: "system" | Scheme;
  readonly lightTheme: ThemeId;
  readonly darkTheme: ThemeId;
}

export function resolvePalette(prefs: AppearancePrefs, system: Scheme): Palette {
  const scheme = prefs.appearanceMode === "system" ? system : prefs.appearanceMode;
  return palettes[scheme === "light" ? prefs.lightTheme : prefs.darkTheme][scheme];
}

const kebab = (k: string) => k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

export function paletteCss(p: Palette): string {
  const ui = Object.entries(p.ui).map(([k, v]) => `--${kebab(k)}:${v};`);
  const syntax = Object.entries(p.syntax).map(([k, v]) => `--syntax-${k}:${v};`);
  return `:root{color-scheme:${p.scheme};${ui.join("")}${syntax.join("")}}`;
}
