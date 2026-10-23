import { describe, expect, it } from "vitest";
import { fontsCss, fontStack } from "./fonts";
import { defaultSettings } from "./model";

const UI = '-apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", sans-serif';
const MONO = '"JetBrains Mono", "SF Mono", ui-monospace, Menlo, monospace';

describe("fontStack", () => {
  it("is the default stack when no family is chosen", () => {
    expect(fontStack("ui", defaultSettings)).toBe(UI);
    expect(fontStack("editor", defaultSettings)).toBe(MONO);
  });

  it("quotes chosen families ahead of the default stack, leaving generic families bare", () => {
    expect(fontStack("ui", { ...defaultSettings, uiFontFamily: "IBM Plex Sans" })).toBe(`"IBM Plex Sans", ${UI}`);
    expect(fontStack("editor", { ...defaultSettings, editorFontFamily: "'Fira Code', monospace" })).toBe(`"Fira Code", monospace, ${MONO}`);
  });

  it("drops quotes and backslashes so a family can't escape its string", () => {
    expect(fontStack("ui", { ...defaultSettings, uiFontFamily: 'Evil"; } body { x\\' })).toBe(`"Evil; } body { x", ${UI}`);
  });

  it("ignores a family list with no names", () => {
    expect(fontStack("ui", { ...defaultSettings, uiFontFamily: " , ," })).toBe(UI);
  });

  it("makes the terminal follow the editor until it has its own family", () => {
    const editor = { ...defaultSettings, editorFontFamily: "Fira Code" };
    expect(fontStack("terminal", defaultSettings)).toBe(MONO);
    expect(fontStack("terminal", editor)).toBe(`"Fira Code", ${MONO}`);
    expect(fontStack("terminal", { ...editor, terminalFontFamily: "Menlo" })).toBe(`"Menlo", "Fira Code", ${MONO}`);
  });
});

describe("fontsCss", () => {
  const declarations = (css: string) => Object.fromEntries([...css.matchAll(/(--[\w-]+):([^;]+);/g)].map((m) => [m[1], m[2]]));

  it("declares the font tokens styles.css used to hold, at their old values by default", () => {
    expect(declarations(fontsCss(defaultSettings))).toEqual({
      "--font-ui": UI,
      "--font-mono": MONO,
      "--editor-font-size": "13px",
      "--text-xs": "11px",
      "--text-sm": "12px",
      "--text-md": "13px",
    });
  });

  it("scales the text tokens from the interface size and code text from the editor font", () => {
    const css = declarations(fontsCss({ ...defaultSettings, uiFontSize: 16, editorFontFamily: "Fira Code", editorFontSize: 18 }));
    expect(css).toMatchObject({ "--text-xs": "14px", "--text-sm": "15px", "--text-md": "16px", "--editor-font-size": "18px" });
    expect(css["--font-mono"]).toBe(`"Fira Code", ${MONO}`);
  });

  it("is one :root rule", () => {
    expect(fontsCss(defaultSettings)).toMatch(/^:root\{[^{}]*\}$/);
  });
});
