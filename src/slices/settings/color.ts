// OKLab color math for compiling themes: parse seeds, mix, print sRGB hex, and measure contrast. Pure.

export type Hex = `#${string}`;
export type Oklch = readonly [l: number, c: number, h: number];
export type Seed = Hex | Oklch;
export type Lab = readonly [number, number, number];

const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const gam = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
const channels = (h: Hex) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as [number, number, number];

export function lab(seed: Seed): Lab {
  if (typeof seed !== "string") {
    const [l, c, h] = seed;
    const r = (h * Math.PI) / 180;
    return [l, c * Math.cos(r), c * Math.sin(r)];
  }
  const [r, g, b] = channels(seed).map(lin) as [number, number, number];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

export const mix = (a: Lab, b: Lab, t: number): Lab => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

export function hex([L, A, B]: Lab, alpha = 1): Hex {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  const rgb = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map(gam);
  const bytes = alpha < 1 ? [...rgb, alpha] : rgb;
  return `#${bytes.map((c) => Math.round(Math.min(1, Math.max(0, c)) * 255).toString(16).padStart(2, "0")).join("")}`;
}

export function over(top: Hex, under: Hex): Hex {
  const a = parseInt(top.slice(7, 9) || "ff", 16) / 255;
  const below = channels(under);
  const bytes = channels(top).map((c, i) => Math.round((c * a + below[i]! * (1 - a)) * 255));
  return `#${bytes.map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

export function contrast(a: Hex, b: Hex): number {
  const y = (h: Hex) => {
    const [r, g, bl] = channels(h).map(lin) as [number, number, number];
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [y(a), y(b)].sort((x, z) => z - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

export function legible(c: Lab, target: Lab, backgrounds: readonly Hex[], floor: number): Lab {
  const at = (t: number): Lab => [c[0] + (target[0] - c[0]) * t, c[1], c[2]];
  const passes = (t: number) => backgrounds.every((bg) => contrast(hex(at(t)), bg) >= floor);
  if (passes(0)) return c;
  let [lo, hi] = [0, 1];
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (passes(mid)) hi = mid;
    else lo = mid;
  }
  return at(hi);
}

export const WHITE = lab("#ffffff");
export const BLACK = lab("#000000");
export const INK = lab("#0b1020");
export const ZINC = lab("#09090b");
