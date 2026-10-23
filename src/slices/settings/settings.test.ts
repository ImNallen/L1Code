import { describe, expect, it } from "vitest";
import { defaultSettings, parseSettings, settingsSections } from "./model";

describe("parseSettings", () => {
  it("returns the defaults when nothing is stored", () => {
    expect(parseSettings(null)).toEqual({
      appearanceMode: "system",
      lightTheme: "l1code",
      darkTheme: "l1code",
      uiFontFamily: "",
      uiFontSize: 13,
      editorFontFamily: "",
      editorFontSize: 13,
      editorWordWrap: false,
      terminalFontFamily: "",
      terminalFontSize: 12.5,
    });
  });

  it("keeps valid stored values", () => {
    const stored = {
      appearanceMode: "light",
      lightTheme: "grove",
      darkTheme: "iris",
      uiFontFamily: "Inter",
      uiFontSize: 15,
      editorFontFamily: "Fira Code",
      editorFontSize: 16,
      editorWordWrap: true,
      terminalFontFamily: "Menlo, monospace",
      terminalFontSize: 14,
    };
    expect(parseSettings(JSON.stringify(stored))).toEqual(stored);
  });

  it("keeps font sizes stored before the font families existed", () => {
    const parsed = parseSettings(JSON.stringify({ editorFontSize: 16, editorWordWrap: true, terminalFontSize: 14 }));
    expect(parsed).toEqual({ ...defaultSettings, editorFontSize: 16, editorWordWrap: true, terminalFontSize: 14 });
  });

  it("trims font families and falls back per key for non-strings and overlong names", () => {
    const parsed = parseSettings(JSON.stringify({ uiFontFamily: "  Inter  ", editorFontFamily: 42, terminalFontFamily: "x".repeat(201), uiFontSize: 20 }));
    expect(parsed).toEqual({ ...defaultSettings, uiFontFamily: "Inter" });
  });

  it("falls back to the defaults for unparseable or non-object JSON", () => {
    for (const text of ["{not json", "", "null", "42", '"editorFontSize"', "[16, true]"]) {
      expect(parseSettings(text)).toEqual(defaultSettings);
    }
  });

  it("falls back per key for wrong types and values outside the choices", () => {
    const parsed = parseSettings(JSON.stringify({ editorFontSize: "16", editorWordWrap: true, terminalFontSize: 999 }));
    expect(parsed).toEqual({ ...defaultSettings, editorWordWrap: true });
  });

  it("falls back per key for unknown appearance modes and removed theme ids", () => {
    const parsed = parseSettings(JSON.stringify({ appearanceMode: "sepia", lightTheme: "ocean", darkTheme: "gone" }));
    expect(parsed).toEqual({ ...defaultSettings, lightTheme: "ocean" });
  });

  it("drops unknown keys", () => {
    expect(parseSettings(JSON.stringify({ theme: "light", editorFontSize: 14 }))).toEqual({ ...defaultSettings, editorFontSize: 14 });
  });
});

describe("settingsSections", () => {
  it("lists every setting exactly once, with its default among the choices", () => {
    const defs = settingsSections.flatMap((s) => s.settings);
    const keys = defs.flatMap((d) => (d.kind === "font" ? [d.family, d.size] : [d.key]));
    expect(keys.sort()).toEqual(Object.keys(defaultSettings).sort());
    for (const d of defs) {
      if (d.kind === "font") expect(d.options).toContain(defaultSettings[d.size]);
      else if (d.kind === "pick") expect(d.options).toContain(defaultSettings[d.key]);
    }
  });
});
