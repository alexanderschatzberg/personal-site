import { describe, expect, it } from 'vitest';
import { ADVANCED, BASIC } from './fields';
import { HELP, placeTip } from './help';

/** Sentences in a help text ("et al." is not a sentence end). */
const sentences = (s: string) => s.replace(/et al\./g, 'et al').split(/[.!?](?:\s|$)/).filter((x) => x.trim()).length;

describe('help text', () => {
  it('every control in the advanced drawer has help', () => {
    for (const k of ADVANCED) expect(HELP[k]?.trim(), k).toBeTruthy();
  });

  it('clumpiness, p(life), temperament and speed have help too', () => {
    for (const k of ['clumpiness', 'pLife', 'temperMean', 'speedMin', 'speedMax']) {
      expect((BASIC as readonly string[]).includes(k), k).toBe(true);
      expect(HELP[k]?.trim(), k).toBeTruthy();
    }
  });

  it('each text is one or two sentences', () => {
    for (const [k, text] of Object.entries(HELP)) {
      const n = sentences(text);
      expect(n, k).toBeGreaterThanOrEqual(1);
      expect(n, k).toBeLessThanOrEqual(2);
    }
  });

  it('cites Planck 2018 for H0 and ΩΛ and Hanson et al. 2021 for hard steps', () => {
    expect(HELP.H0).toContain('Planck 2018');
    expect(HELP.omegaLambda).toContain('Planck 2018');
    expect(HELP.hardSteps).toContain('Hanson et al. 2021');
  });

  it('planets per galaxy counts planets per real galaxy, as the engine does (q uses REAL_GALAXIES / n)', () => {
    expect(HELP.planetsPerGalaxy).toMatch(/real galax/);
    expect(HELP.planetsPerGalaxy).not.toMatch(/simulated galaxy/);
  });

  it('has nothing for the hidden safety cap', () => {
    expect(HELP.tEndGyr).toBeUndefined();
  });
});

describe('tooltip placement', () => {
  const vw = 360, vh = 640, m = 8;

  it('sits below the button, left-aligned, when there is room', () => {
    expect(placeTip({ left: 40, top: 100, right: 60, bottom: 120 }, 200, 80, vw, vh, m)).toEqual({ left: 40, top: 124 });
  });

  it('stays inside the screen near the right edge and the bottom', () => {
    const p = placeTip({ left: 330, top: 600, right: 350, bottom: 620 }, 200, 80, vw, vh, m);
    expect(p.left + 200).toBeLessThanOrEqual(vw - m);
    expect(p.left).toBeGreaterThanOrEqual(m);
    expect(p.top).toBe(600 - 4 - 80); // flipped above the button
  });

  it('a tip wider than the screen is pinned to the left margin', () => {
    expect(placeTip({ left: 100, top: 10, right: 120, bottom: 30 }, 500, 40, vw, vh, m).left).toBe(m);
  });
});
