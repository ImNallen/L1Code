// Owns the resolved palette: the one store every color consumer reads. It derives from the appearance
// settings and the OS scheme, and it is the only code that writes colors to the document or the native
// window. Importing it touches no DOM; `startAppearance` does.

import { getCurrentWindow } from "@tauri-apps/api/window";
import { createStore, watch, type ReadStore } from "@/core/store";
import type { AppearanceMode } from "./model";
import { paletteCss, resolvePalette, type Palette } from "./palette";
import { settingsState } from "./store";
import type { Scheme } from "./themes";

/** The `<style>` that holds the palette rule. index.html creates it from the cache before first paint. */
export const STYLE_ID = "l1code-palette";
/** The last painted palette rule. Derived output, so a stale value costs one frame before the repaint. */
export const CACHE_KEY = "l1code.palette-css";

/** The OS scheme from the media query. While the mode is fixed, `setTheme` forces it and nothing reads it. */
const system = createStore<Scheme>("dark");
const store = createStore<Palette>(resolvePalette(settingsState.get(), system.get()));
export const paletteState: ReadStore<Palette> = store;

let started = false;

/** Paints the palette and follows changes from then on. Call once before the first render; repeats do nothing. */
export function startAppearance(): void {
  if (started) return;
  started = true;
  const media = matchMedia("(prefers-color-scheme: dark)");
  const scheme = (dark: boolean): Scheme => (dark ? "dark" : "light");
  const recompute = () => store.set(resolvePalette(settingsState.get(), system.get()));
  system.set(scheme(media.matches));
  media.addEventListener("change", (e) => system.set(scheme(e.matches)));
  settingsState.subscribe(recompute);
  system.subscribe(recompute);
  recompute();

  const style = document.getElementById(STYLE_ID) ?? document.head.appendChild(Object.assign(document.createElement("style"), { id: STYLE_ID }));
  const paint = (p: Palette) => {
    const root = document.documentElement;
    const css = paletteCss(p);
    root.classList.add("no-transitions");
    style.textContent = css;
    root.dataset.theme = p.id;
    root.dataset.scheme = p.scheme;
    // Resolve the new colors now, while transitions are off, so nothing animates from the old ones.
    getComputedStyle(root).getPropertyValue("color");
    requestAnimationFrame(() => root.classList.remove("no-transitions"));
    localStorage.setItem(CACHE_KEY, css);
  };
  paint(store.get());
  watch(store, (p) => p, paint);

  // Native chrome (traffic lights, menus) follows the mode. null hands it back to the OS.
  const syncWindow = (mode: AppearanceMode) => void getCurrentWindow().setTheme(mode === "system" ? null : mode).catch(() => {});
  syncWindow(settingsState.get().appearanceMode);
  watch(settingsState, (s) => s.appearanceMode, syncWindow);
}
