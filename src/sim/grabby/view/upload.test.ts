import { describe, expect, it } from 'vitest';
import { MAX_PENDING_RANGES, MAX_PENDING_RANGES_BIG, pendingRangeCap, UploadTracker, type UploadAttr } from './upload';

/**
 * Mimics three r187's BufferAttribute + WebGLAttributes contract: needsUpdate bumps version;
 * at render, a stale attribute uploads everything on its first upload or when it has no
 * ranges, otherwise only its ranges, then clears them; onUpload's callback runs after either.
 */
class FakeAttr implements UploadAttr {
  updateRanges: { start: number; count: number }[] = [];
  version = 0;
  private gpuVersion = -1;
  private cb = () => {};
  constructor(readonly length: number) {}
  addUpdateRange(start: number, count: number) {
    this.updateRanges.push({ start, count });
  }
  clearUpdateRanges() {
    this.updateRanges.length = 0;
  }
  set needsUpdate(v: boolean) {
    if (v) this.version++;
  }
  onUpload(cb: () => void) {
    this.cb = cb;
    return this;
  }
  /** Render: the set of element indices sent to the GPU (null = not uploaded). */
  render(): Set<number> | null {
    if (this.gpuVersion >= this.version && this.gpuVersion >= 0) return null;
    const out = new Set<number>();
    if (this.gpuVersion < 0 || this.updateRanges.length === 0) for (let i = 0; i < this.length; i++) out.add(i);
    else for (const r of this.updateRanges) for (let i = r.start; i < r.start + r.count; i++) out.add(i);
    this.clearUpdateRanges();
    this.gpuVersion = this.version;
    this.cb();
    return out;
  }
}

const span = (a: number, b: number) => Array.from({ length: b - a }, (_, k) => a + k);

describe('upload tracker', () => {
  it('ranges from several seeks before one render all upload (union)', () => {
    const a = new FakeAttr(100);
    const t = new UploadTracker(a);
    a.render(); // initial upload
    t.markRange(0, 3); // tick's seek
    t.markRange(30, 3); // user's seek before the render
    const up = a.render()!;
    for (const i of [...span(0, 3), ...span(30, 33)]) expect(up.has(i)).toBe(true);
  });

  it('a pending full upload is not downgraded by a later partial seek', () => {
    const a = new FakeAttr(100);
    const t = new UploadTracker(a);
    a.render();
    t.markFull(); // theme change
    t.markRange(30, 3); // seek before the render
    expect(a.render()!.size).toBe(100);
  });

  it('after a full upload has gone out, later seeks are partial again', () => {
    const a = new FakeAttr(100);
    const t = new UploadTracker(a);
    a.render();
    t.markFull();
    a.render();
    t.markRange(30, 3);
    expect([...a.render()!]).toEqual(span(30, 33));
  });

  it('a full upload stays pending across renders that skip the attribute (hidden layer)', () => {
    const a = new FakeAttr(100);
    const t = new UploadTracker(a);
    a.render();
    t.markFull();
    // a frame renders without this attribute (layer hidden): no upload, no callback
    t.markRange(30, 3);
    expect(a.render()!.size).toBe(100);
  });

  it('before its first upload, ranges are not recorded (the first upload is everything)', () => {
    const a = new FakeAttr(100);
    const t = new UploadTracker(a);
    t.markRange(30, 3);
    expect(a.updateRanges).toEqual([]);
    expect(a.render()!.size).toBe(100);
    t.markRange(30, 3);
    expect([...a.render()!]).toEqual(span(30, 33));
  });

  it('ranges stay bounded across many commits with no upload (hidden layer), then go full', () => {
    const a = new FakeAttr(100);
    const t = new UploadTracker(a);
    a.render(); // shown once: first upload done
    // hidden: three skips the object, so no render/upload happens while commits continue
    for (let i = 0; i < 10_000; i++) t.markRange(i % 97, 2);
    expect(a.updateRanges.length).toBeLessThanOrEqual(MAX_PENDING_RANGES);
    expect(a.render()!.size).toBe(100); // shown again: one full upload
    t.markRange(30, 3);
    expect([...a.render()!]).toEqual(span(30, 33)); // then partial again
  });

  it('a big buffer allows more pending ranges before a full upload (so a frame of scattered changes stays partial)', () => {
    expect(pendingRangeCap(12_000)).toBe(MAX_PENDING_RANGES); // 4k galaxies × 3: unchanged
    expect(pendingRangeCap(3_000_000)).toBe(MAX_PENDING_RANGES_BIG); // 1M galaxies × 3
    for (let n = 1000; n < 1e7; n *= 3) expect(pendingRangeCap(3 * n)).toBeLessThanOrEqual(pendingRangeCap(9 * n));
    const len = 3_000_000;
    const a = new FakeAttr(len);
    const t = new UploadTracker(a, pendingRangeCap(len));
    a.render();
    // one playback frame at 1M: a few hundred scattered galaxies change colour
    for (let k = 0; k < 300; k++) t.markRange(k * 9973 * 3, 3);
    expect(a.updateRanges.length).toBe(300);
    t.markRange(5, 3);
    let sent = 0;
    a.updateRanges.forEach((r) => (sent += r.count));
    expect(sent).toBe(301 * 3);
  });

  it('a cap still bounds a hidden layer', () => {
    const a = new FakeAttr(100);
    const t = new UploadTracker(a, 10);
    a.render();
    for (let i = 0; i < 10; i++) t.markRange(10 * i, 2);
    expect(a.updateRanges.length).toBe(10);
    t.markRange(3, 1); // the 11th: past the cap, a full upload instead
    expect(a.updateRanges.length).toBe(0);
    for (let i = 0; i < 1000; i++) t.markRange(i % 97, 2);
    expect(a.render()!.size).toBe(100);
  });
});
