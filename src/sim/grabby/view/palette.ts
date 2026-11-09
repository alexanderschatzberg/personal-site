// Civ colours. The first five come from the approved mock and are tuned per theme; later
// civs reuse those lightness/saturation pairs with the hue rotated by the golden angle, so
// any civ id maps to the same colour every time.
const LIGHT = ['#b4532a', '#2f5fa8', '#8a7314', '#3f7a3c', '#7d4fa0'];
const DARK = ['#e07a52', '#6f9be0', '#c9b04a', '#7fb37a', '#b48fd6'];
const GOLDEN_ANGLE = 137.508;

function hexToHsl(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min, s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

function hslToHex(h: number, s: number, l: number): string {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return '#' + [f(0), f(8), f(4)].map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join('');
}

export function civColor(id: number, dark: boolean): string {
  const base = dark ? DARK : LIGHT;
  const i = ((id % base.length) + base.length) % base.length;
  const round = Math.floor(id / base.length);
  if (round === 0) return base[i];
  const [h, s, l] = hexToHsl(base[i]);
  return hslToHex((((h + round * GOLDEN_ANGLE) % 360) + 360) % 360, s, l);
}
