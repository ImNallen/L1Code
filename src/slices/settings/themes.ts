// The built-in themes, and the colors that follow light or dark but not the theme. Theme ids, the
// settings options, the theme cards, and the compiled palettes all derive from `themes`.

import type { Hex, Seed } from "./color";
import type { UiColors } from "./palette";

export type Scheme = "light" | "dark";

/** canvas is --bg (editor, main area); sidebar is --bg-panel (side columns, terminal). */
export interface Seeds {
  readonly canvas: Seed;
  readonly sidebar: Seed;
  readonly text: Seed;
  readonly border: Seed;
  readonly accent: Seed;
  readonly action?: Seed;
  readonly surface?: Seed;
  readonly overrides?: Partial<UiColors>;
}

export interface ThemeDef {
  readonly id: string;
  readonly label: string;
  readonly variants: Readonly<Record<Scheme, Seeds>>;
}

const LT = [0.222, 0.034, 329.0] as const;
const DT = [0.99, 0.008, 325.6] as const;

// prettier-ignore
export const themes = [
  { id: "l1code", label: "L1Code", variants: {
    light: { canvas: "#fbfbfc", sidebar: "#f2f3f5", text: "#1f2329", border: "#e1e4e8", accent: "#3b6fe0", surface: "#ffffff" },
    dark: { canvas: "#0f1115", sidebar: "#13161b", text: "#d7dce4", border: "#232831", accent: "#7aa2ff", overrides: {
      bgElev: "#191d24", bgInput: "#0c0e12", bgHover: "#1e232b", bgActive: "#242b36", bgSelected: "#1f3150", borderStrong: "#2e3541",
      fgMuted: "#9aa3b2", fgSubtle: "#6b7383", fgFaint: "#20252e", sidebarFg: "#c3c9d4", accentStrong: "#9bb8ff", actionStrong: "#9bb8ff",
      editorSelection: "#2a3b5c", editorGutter: "#4b5261" } } } },
  { id: "t3-chat", label: "T3 Chat", variants: {
    light: { canvas: [.982, .010, 325.6], sidebar: [.928, .031, 322.6], text: [.325, .116, 325.0], border: [.923, .021, 328.1], accent: [.591, .217, 0.58], surface: [.971, .012, 321.9] },
    dark: { canvas: [.228, .020, 307.5], sidebar: [.185, .019, 322.2], text: [.980, .004, 301.4], border: [.266, .015, 302.4], accent: [.460, .185, 4.1] } } },
  { id: "grove", label: "Grove", variants: {
    light: { canvas: [.972, .005, 157.2], sidebar: [.936, .014, 163.6], text: LT, border: [.864, .013, 167.3], accent: [.523, .112, 158.1], action: [.535, .106, 77.5] },
    dark: { canvas: [.260, .021, 162.8], sidebar: [.309, .032, 160.9], text: DT, border: [.457, .044, 161.0], accent: [.796, .133, 157.3], action: [.791, .129, 83.3] } } },
  { id: "ocean", label: "Ocean", variants: {
    light: { canvas: [.974, .002, 241.6], sidebar: [.939, .011, 241.7], text: LT, border: [.867, .013, 252.4], accent: [.536, .120, 247.0], action: [.493, .081, 201.6] },
    dark: { canvas: [.242, .024, 250.6], sidebar: [.290, .032, 247.3], text: DT, border: [.438, .039, 245.4], accent: [.758, .105, 241.5], action: [.793, .105, 199.9] } } },
  { id: "ember", label: "Ember", variants: {
    light: { canvas: [.976, .002, 60.7], sidebar: [.942, .011, 50.8], text: LT, border: [.870, .013, 39.4], accent: [.552, .129, 44.7], action: [.516, .161, 24.8] },
    dark: { canvas: [.245, .019, 42.0], sidebar: [.293, .029, 46.9], text: DT, border: [.440, .040, 48.8], accent: [.762, .124, 52.1], action: [.747, .135, 29.4] } } },
  { id: "iris", label: "Iris", variants: {
    light: { canvas: [.976, .003, 303.2], sidebar: [.941, .014, 300.5], text: LT, border: [.869, .018, 303.9], accent: [.525, .153, 294.2], action: [.516, .185, 340.8] },
    dark: { canvas: [.225, .031, 293.7], sidebar: [.266, .044, 294.1], text: DT, border: [.408, .058, 295.9], accent: [.671, .169, 293.9], action: [.789, .130, 337.6] } } },
] as const satisfies readonly ThemeDef[];

export type ThemeId = (typeof themes)[number]["id"];
export const themeIds: readonly ThemeId[] = themes.map((t) => t.id);

type SyntaxName = "comment" | "keyword" | "string" | "number" | "fn" | "type" | "prop" | "tag" | "constant" | "punct" | "invalid";
export type SyntaxColors = { readonly [K in SyntaxName]: Hex };

type AnsiName = "black" | "red" | "green" | "yellow" | "blue" | "magenta" | "cyan" | "white";
type Bright<N extends string> = `bright${Capitalize<N>}`;
export type AnsiColors = { readonly [K in AnsiName | Bright<AnsiName>]: Hex };

interface SchemeColors {
  readonly status: { readonly success: Hex; readonly warning: Hex; readonly danger: Hex; readonly merged: Hex };
  readonly syntax: SyntaxColors;
  readonly ansi: AnsiColors;
}

// prettier-ignore
export const schemeColors: Readonly<Record<Scheme, SchemeColors>> = {
  dark: {
    status: { success: "#7ccf9b", warning: "#e5c07b", danger: "#f2777a", merged: "#b89bff" },
    syntax: { comment: "#6b7383", keyword: "#c792ea", string: "#a5d6a7", number: "#f78c6c", fn: "#82aaff", type: "#ffcb6b", prop: "#89ddff", tag: "#f07178", constant: "#f78c6c", punct: "#a9b1c1", invalid: "#f2777a" },
    ansi: { black: "#1e232b", red: "#f2777a", green: "#7ccf9b", yellow: "#e5c07b", blue: "#7aa2ff", magenta: "#c792ea", cyan: "#6cc4d8", white: "#d7dce4",
      brightBlack: "#6b7383", brightRed: "#ff8f91", brightGreen: "#98e0b2", brightYellow: "#f0d398", brightBlue: "#9bb8ff", brightMagenta: "#dbaaf5", brightCyan: "#8ad8ea", brightWhite: "#ffffff" },
  },
  light: {
    status: { success: "#1a7f37", warning: "#9a6700", danger: "#cf222e", merged: "#8250df" },
    syntax: { comment: "#6e7781", keyword: "#8250df", string: "#116329", number: "#b35900", fn: "#0550ae", type: "#953800", prop: "#0a6b7a", tag: "#c0283d", constant: "#b35900", punct: "#57606a", invalid: "#cf222e" },
    ansi: { black: "#24292f", red: "#cf222e", green: "#116329", yellow: "#9a6700", blue: "#0969da", magenta: "#8250df", cyan: "#1b7c83", white: "#6e7781",
      brightBlack: "#57606a", brightRed: "#a40e26", brightGreen: "#1a7f37", brightYellow: "#633c01", brightBlue: "#218bff", brightMagenta: "#a475f9", brightCyan: "#3192aa", brightWhite: "#8c959f" },
  },
};
