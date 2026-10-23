import { describe, expect, it } from "vitest";
import indexHtml from "@/../index.html?raw";
import { CACHE_KEY, STYLE_ID } from "./appearance";
import { contrast } from "./color";
import { paletteCss, palettes, resolvePalette, type Palette } from "./palette";
import { themes } from "./themes";

const all: readonly Palette[] = Object.values(palettes).flatMap((v) => [v.light, v.dark]);
const declarations = (css: string) => Object.fromEntries([...css.matchAll(/(--[\w-]+):([^;]+);/g)].map((m) => [m[1], m[2]]));

// prettier-ignore
const TODAY = {
  "--bg": "#0f1115", "--bg-panel": "#13161b", "--bg-elev": "#191d24", "--bg-input": "#0c0e12", "--bg-hover": "#1e232b", "--bg-active": "#242b36",
  "--bg-selected": "#1f3150", "--border": "#232831", "--border-strong": "#2e3541", "--fg": "#d7dce4", "--fg-muted": "#9aa3b2", "--fg-subtle": "#6b7383",
  "--accent": "#7aa2ff", "--accent-strong": "#9bb8ff", "--accent-bg": "#7aa2ff24", "--on-accent": "#0b1020", "--action": "#7aa2ff",
  "--action-strong": "#9bb8ff", "--on-action": "#0b1020", "--success": "#7ccf9b", "--warning": "#e5c07b", "--danger": "#f2777a", "--added": "#7ccf9b",
  "--modified": "#e5c07b", "--deleted": "#f2777a", "--untracked": "#7ccf9b", "--success-bg": "#7ccf9b26", "--warning-bg": "#e5c07b1a",
  "--warning-line": "#e5c07b4d", "--danger-bg": "#f2777a1f", "--danger-line": "#f2777a80", "--merged": "#b89bff", "--merged-bg": "#b89bff29",
  "--fg-faint": "#20252e", "--sidebar-fg": "#c3c9d4", "--scrollbar": "#ffffff14", "--scrollbar-hover": "#ffffff29", "--shadow": "#00000073",
  "--shadow-strong": "#00000080", "--backdrop": "#00000080", "--backdrop-soft": "#00000040", "--editor-selection": "#2a3b5c",
  "--editor-active-line": "#ffffff08", "--editor-gutter": "#4b5261", "--match-bg": "#7aa2ff2e", "--match-line": "#7aa2ff66", "--search-bg": "#e5c07b40",
  "--search-line": "#e5c07b80", "--search-current": "#e5c07b73", "--syntax-comment": "#6b7383", "--syntax-keyword": "#c792ea",
  "--syntax-string": "#a5d6a7", "--syntax-number": "#f78c6c", "--syntax-fn": "#82aaff", "--syntax-type": "#ffcb6b", "--syntax-prop": "#89ddff",
  "--syntax-tag": "#f07178", "--syntax-constant": "#f78c6c", "--syntax-punct": "#a9b1c1", "--syntax-invalid": "#f2777a",
};

describe("palettes", () => {
  it("compile a light and a dark variant of every theme", () => {
    expect(all.map((p) => `${p.id}/${p.scheme}`).sort()).toEqual(themes.flatMap((t) => [`${t.id}/light`, `${t.id}/dark`]).sort());
  });

  it("keep L1Code dark identical to the dark tokens it replaced", () => {
    expect(declarations(paletteCss(palettes.l1code.dark))).toEqual(TODAY);
    expect(paletteCss(palettes.l1code.dark)).toContain("color-scheme:dark;");
  });

  it("declare the same tokens in every variant", () => {
    for (const p of all) expect(Object.keys(declarations(paletteCss(p))).sort()).toEqual(Object.keys(TODAY).sort());
  });

  it("give xterm only #rrggbb or #rrggbbaa colors", () => {
    for (const p of all) for (const c of Object.values(p.terminal)) expect(c).toMatch(/^#([0-9a-f]{6}|[0-9a-f]{8})$/);
  });
});

describe.each(all.map((p) => [`${p.id} ${p.scheme}`, p] as const))("%s keeps text readable", (_, { ui }) => {
  it.each([
    ["body text", ui.fg, 7],
    ["muted text", ui.fgMuted, 4.5],
    ["subtle text", ui.fgSubtle, 3],
  ] as const)("%s on the canvas and the side panels", (_, color, floor) => {
    expect(contrast(color, ui.bg)).toBeGreaterThanOrEqual(floor);
    expect(contrast(color, ui.bgPanel)).toBeGreaterThanOrEqual(floor);
  });

  it("text on primary buttons and on accent fills", () => {
    expect(contrast(ui.onAction, ui.action)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(ui.onAccent, ui.accent)).toBeGreaterThanOrEqual(4.5);
  });
});

describe("resolvePalette", () => {
  const prefs = { appearanceMode: "system", lightTheme: "grove", darkTheme: "iris" } as const;

  it("follows the OS scheme in system mode", () => {
    expect(resolvePalette(prefs, "dark")).toBe(palettes.iris.dark);
    expect(resolvePalette(prefs, "light")).toBe(palettes.grove.light);
  });

  it("ignores the OS scheme in a fixed mode", () => {
    expect(resolvePalette({ ...prefs, appearanceMode: "light" }, "dark")).toBe(palettes.grove.light);
    expect(resolvePalette({ ...prefs, appearanceMode: "dark" }, "light")).toBe(palettes.iris.dark);
  });
});

describe("stylesheets", () => {
  const sheets = import.meta.glob<string>("/src/**/*.css", { query: "?raw", import: "default", eager: true });
  const palette = Object.keys(declarations(paletteCss(palettes.l1code.dark)));

  it("load as text", () => {
    expect(Object.keys(sheets).length).toBeGreaterThan(5);
    for (const [file, css] of Object.entries(sheets)) expect(css.length, file).toBeGreaterThan(0);
  });

  it("hold no color literals, so the palette is the only source of color", () => {
    for (const [file, css] of Object.entries(sheets)) {
      const literals = css.match(/#[0-9a-f]{3,8}\b|\b(rgba?|hsla?|oklch|oklab)\(/gi) ?? [];
      // The preview iframe's white is the previewed page's own canvas, not app chrome.
      const allowed = file.endsWith("/preview.css") ? ["#fff"] : [];
      expect(literals.filter((l) => !allowed.includes(l)), file).toEqual([]);
    }
  });

  it("read only variables that the palette or a stylesheet declares", () => {
    const all = Object.values(sheets).join("\n");
    const declared = new Set([...palette, ...[...all.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1])]);
    const read = new Set([...all.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]));
    expect([...read].filter((v) => !declared.has(v))).toEqual([]);
  });
});

it("index.html paints the cached palette into the element the runtime repaints", () => {
  const script = indexHtml.match(/<script>([\s\S]*?)<\/script>/)?.[1] ?? "";
  const appended: object[] = [];
  const document = { head: { appendChild: (el: object) => (appended.push(el), el) }, createElement: () => ({}) };
  const localStorage = { getItem: (key: string) => (key === CACHE_KEY ? ":root{--bg:#123456;}" : null) };
  new Function("document", "localStorage", script)(document, localStorage);
  expect(appended).toEqual([{ id: STYLE_ID, textContent: ":root{--bg:#123456;}" }]);
});
