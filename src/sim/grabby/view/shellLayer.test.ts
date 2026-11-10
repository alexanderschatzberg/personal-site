// Round 7 review, finding 3: the galaxies' translucent dots write no depth, so shells drawn after
// them used to blend over near galaxies even from behind. A depth-only pass of the same dots,
// drawn after the coloured dots and before every shell, lets the depth test keep a far shell off
// a near galaxy, while a near shell still tints the galaxies behind it.
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { POINTS_DEPTH_ORDER, POINTS_RENDER_ORDER, pointsDepthMaterial, shellRenderOrder, syncPointsDepth } from './shellLayer';

describe('draw order: galaxies vs shells (round 7 review, finding 3)', () => {
  const dots = new THREE.PointsMaterial({ size: 2.5, sizeAttenuation: false, vertexColors: true, map: new THREE.Texture(), alphaTest: 0.45, opacity: 0.9, transparent: true, depthWrite: false });

  it('the dots, then their depth-only pass, then every shell back to front', () => {
    expect(POINTS_RENDER_ORDER).toBeLessThan(POINTS_DEPTH_ORDER);
    for (const i of [0, 1, 5, 40]) {
      expect(shellRenderOrder(i, 'old')).toBeGreaterThan(POINTS_DEPTH_ORDER);
      expect(shellRenderOrder(i, 'old')).toBeLessThan(shellRenderOrder(i, 'cur'));
      expect(shellRenderOrder(i, 'cur')).toBeLessThan(shellRenderOrder(i + 1, 'old'));
    }
  });

  it('the depth pass writes depth only, over exactly the footprint of the coloured dots', () => {
    const d = pointsDepthMaterial(dots);
    expect(d.colorWrite).toBe(false);
    expect(d.depthWrite).toBe(true);
    expect(d.depthTest).toBe(true);
    // In the transparent list, so renderOrder puts it after the (translucent) dots.
    expect(d.transparent).toBe(true);
    for (const k of ['size', 'sizeAttenuation', 'map', 'alphaTest', 'opacity'] as const) expect(d[k]).toBe(dots[k]);
    // Theme / count changes restyle the dots; the depth pass follows.
    dots.size = 1.5;
    dots.opacity = 0.6;
    dots.alphaTest = 0.3;
    syncPointsDepth(dots, d);
    for (const k of ['size', 'alphaTest', 'opacity'] as const) expect(d[k]).toBe(dots[k]);
  });
});
