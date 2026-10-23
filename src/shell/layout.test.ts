import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), Channel: class {} }));

const { closeSettings, layout, openSettings, revealView, toggleSettings } = await import("./layout");

describe("settings route", () => {
  beforeEach(() => closeSettings());

  it("opens at the first section, then at the section shown last", () => {
    openSettings();
    expect(layout.get().settings).toBe("appearance");
    openSettings("terminal");
    closeSettings();
    expect(layout.get().settings).toBeNull();
    openSettings();
    expect(layout.get().settings).toBe("terminal");
  });

  it("toggles between settings and the workbench", () => {
    toggleSettings();
    expect(layout.get().settings).not.toBeNull();
    toggleSettings();
    expect(layout.get().settings).toBeNull();
  });

  it("closes when a left view is revealed, but not for a right tool", () => {
    openSettings("editor");
    revealView("terminal");
    expect(layout.get().settings).toBe("editor");
    revealView("explorer");
    expect(layout.get().settings).toBeNull();
    expect(layout.get().leftOpen).toBe(true);
  });
});
