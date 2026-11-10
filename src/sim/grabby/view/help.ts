// The [?] tooltips: one short plain-English text per control, and where to put the popover.
// Facts come only from types.ts and the plan; keep each text to one or two sentences.

export const HELP: Record<string, string> = {
  galaxies:
    'How many points are simulated. Each one stands for many real galaxies: about 2 trillion (Conselice et al. 2016) divided by this number.',
  clumpiness:
    'How strongly galaxies gather into a cosmic web of walls and filaments around empty voids. 0 spreads them evenly; 1 gives the strongest web.',
  pLife:
    'The chance that a single planet produces a grabby civilization at some point. Together with planets per galaxy, it sets how many civilizations arise.',
  speedMin:
    'Slowest expansion speed, as a fraction of the speed of light. Each civilization picks its speed at random between speed min and speed max.',
  speedMax:
    'Fastest expansion speed, as a fraction of the speed of light. Each civilization picks its speed at random between speed min and speed max.',
  temperMean:
    'Average temperament: 0 always leaves others alone, 1 always declares war. Each civilization draws its own value around this average.',
  sizeGly:
    'Side length of the square or cube in billions of light-years (on the sphere, its circumference). The default, 93, is the diameter of the observable universe.',
  webScaleGly:
    'Typical diameter of a void, one cell of the cosmic web, in billions of light-years (real voids are about 0.1–0.3 Gly; the default is larger so the web shows up with a few thousand points). The run keeps at least 8 galaxies per cell on average and at least 3 cells across, so the effective scale can differ, shown under the field.',
  planetsPerGalaxy:
    'Planets in each real galaxy, each with the p(life) chance of producing a grabby civilization. Every simulated point stands for about 2 trillion ÷ galaxies real galaxies, so it holds that many times this many planets.',
  hardSteps:
    'Number of hard, unlikely steps life must pass to become grabby (Hanson et al. 2021). Origin times are drawn with density ∝ tⁿ, so more steps push civilizations later.',
  lifeWindowGyr: 'Civilizations can only arise before this time, in billions of years after the big bang.',
  temperSpread:
    'How much temperaments vary between civilizations: the spread of the normal distribution around the average, clamped to 0–1.',
  mightModel:
    'How a civilization’s might grows with the N galaxies it holds. Power is base × N^α, log is base × ln(1 + N), and frontier counts only its own galaxies near the contested one.',
  mightMin: 'Smallest intrinsic (base) might. Each civilization picks its base might at random between min and max.',
  mightMax: 'Largest intrinsic (base) might. Each civilization picks its base might at random between min and max.',
  mightExponent: 'The exponent α in the power model, where might = base × N^α and N is the number of galaxies held.',
  frontierRadiusGly:
    'For the frontier model: only the civilization’s own galaxies within this distance of the contested galaxy count towards its might, in billions of light-years.',
  defenderBonus: 'Multiplier on the defender’s might in a battle.',
  H0: 'The Hubble constant today, in km/s/Mpc: how fast space is expanding now (default from Planck 2018). 0 means a static universe with no expansion.',
  omegaLambda:
    'The share of dark energy in a flat universe; the rest is matter, and radiation is ignored. The default is from Planck 2018.',
  noExpansion: 'Sets H0 to 0 and applies, so the universe never expands and distances stay fixed.',
};

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Gap between the button and the tip, CSS px. */
const GAP = 4;

/**
 * Viewport position for a tip of size w × h anchored to a [?] button: below it and left-aligned,
 * flipped above when it would run off the bottom, and kept `margin` px inside the screen.
 */
export function placeTip(anchor: Rect, w: number, h: number, vw: number, vh: number, margin: number): { left: number; top: number } {
  const left = Math.max(margin, Math.min(anchor.left, vw - margin - w));
  let top = anchor.bottom + GAP;
  if (top + h > vh - margin) top = Math.max(margin, anchor.top - GAP - h);
  return { left, top };
}
