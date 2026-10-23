// Owns the resolved palette: the one store every color consumer reads. It derives from the appearance
// settings and the OS scheme, and it is the only code that writes colors and font tokens to the
// document or the native window. Importing it touches no DOM; `startAppearance` does.

import { getCurrentWindow } from "@tauri-apps/api/window";
import { createStore, watch, type ReadStore } from "@/core/store";
import type { AppearanceMode } from "./model";
import { fontsCss } from "./fonts";
import { paletteCss, resolvePalette, type Palette } from "./palette";
import { settingsState } from "./store";
import type { Scheme } from "./themes";

export const STYLE_ID = "l1code-palette";
export const CACHE_KEY = "l1code.palette-css";

const mediaScheme = createStore<Scheme>("dark");
const store = createStore<Palette>(resolvePalette(settingsState.get(), mediaScheme.get()));
export const paletteState: ReadStore<Palette> = store;

let started = false;

/** Paints the palette and fonts and follows changes from then on. Call once before the first render; repeats do nothing. */
export function startAppearance(): void {
  if (started) return;
  started = true;
  const media = matchMedia("(prefers-color-scheme: dark)");
  const scheme = (dark: boolean): Scheme => (dark ? "dark" : "light");
  const recompute = () => store.set(resolvePalette(settingsState.get(), mediaScheme.get()));
  mediaScheme.set(scheme(media.matches));
  media.addEventListener("change", (e) => mediaScheme.set(scheme(e.matches)));
  settingsState.subscribe(recompute);
  mediaScheme.subscribe(recompute);
  recompute();

  const style = document.getElementById(STYLE_ID) ?? document.head.appendChild(Object.assign(document.createElement("style"), { id: STYLE_ID }));
  const paint = () => {
    const root = document.documentElement;
    const p = store.get();
    const css = paletteCss(p) + fontsCss(settingsState.get());
    root.classList.add("no-transitions");
    style.textContent = css;
    root.dataset.theme = p.id;
    root.dataset.scheme = p.scheme;
    // Resolve the new colors now, while transitions are off, so nothing animates from the old ones.
    getComputedStyle(root).getPropertyValue("color");
    requestAnimationFrame(() => root.classList.remove("no-transitions"));
    localStorage.setItem(CACHE_KEY, css);
  };
  paint();
  watch(store, (p) => p, paint);
  watch(settingsState, fontsCss, paint);

  const syncWindow = (mode: AppearanceMode) => void getCurrentWindow().setTheme(mode === "system" ? null : mode).catch(() => {});
  syncWindow(settingsState.get().appearanceMode);
  watch(settingsState, (s) => s.appearanceMode, syncWindow);
}
