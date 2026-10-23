import { describe, expect, it } from "vitest";
import { defaultSettings, parseSettings, settingsSections } from "./model";

describe("parseSettings", () => {
  it("returns the defaults when nothing is stored", () => {
    expect(parseSettings(null)).toEqual({ editorFontSize: 13, editorWordWrap: false, terminalFontSize: 12.5 });
  });

  it("keeps valid stored values", () => {
    const stored = { editorFontSize: 16, editorWordWrap: true, terminalFontSize: 14 };
    expect(parseSettings(JSON.stringify(stored))).toEqual(stored);
  });

  it("falls back to the defaults for unparseable or non-object JSON", () => {
    for (const text of ["{not json", "", "null", "42", '"editorFontSize"', "[16, true]"]) {
      expect(parseSettings(text)).toEqual(defaultSettings);
    }
  });

  it("falls back per key for wrong types and values outside the choices", () => {
    const parsed = parseSettings(JSON.stringify({ editorFontSize: "16", editorWordWrap: true, terminalFontSize: 999 }));
    expect(parsed).toEqual({ editorFontSize: 13, editorWordWrap: true, terminalFontSize: 12.5 });
  });

  it("drops unknown keys", () => {
    expect(parseSettings(JSON.stringify({ theme: "light", editorFontSize: 14 }))).toEqual({ ...defaultSettings, editorFontSize: 14 });
  });
});

describe("settingsSections", () => {
  it("lists every setting exactly once, with its default among the choices", () => {
    const defs = settingsSections.flatMap((s) => s.settings);
    expect(defs.map((d) => d.key).sort()).toEqual(Object.keys(defaultSettings).sort());
    for (const d of defs) if (d.kind === "choice") expect(d.options).toContain(defaultSettings[d.key]);
  });
});
