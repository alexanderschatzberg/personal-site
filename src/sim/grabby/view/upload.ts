// Which parts of a GPU buffer attribute to send at the next render, accumulated over every
// change since the last upload. three r187 uploads at render time — everything when the
// attribute has no update ranges, else only the ranges, which it then clears — and calls the
// attribute's onUpload callback after either. So between uploads, ranges must add up (never be
// cleared), and once a full upload is pending no range may be added (that would shrink it).

/** The part of THREE.BufferAttribute this uses. */
export interface UploadAttr {
  addUpdateRange(start: number, count: number): void;
  clearUpdateRanges(): void;
  set needsUpdate(v: boolean);
  onUpload(cb: () => void): unknown;
}

/** Pending ranges past which a full upload is cheaper than tracking more. A hidden layer is
 *  never uploaded (three skips invisible objects), so without this cap ranges would pile up
 *  for as long as it stays hidden. */
export const MAX_PENDING_RANGES = 64;
/** Most pending ranges for a big buffer (three merges adjacent ones before bufferSubData). */
export const MAX_PENDING_RANGES_BIG = 1024;
/** Rough cost of one bufferSubData call, in buffer elements uploaded (a display guess, not
 *  measured): a buffer allows one pending range per this many elements, within the caps above. */
export const RANGE_COST_ELEMENTS = 2048;

/** Pending ranges a buffer of `elements` allows before going full. Small buffers keep the old
 *  cap of 64; a 1M-galaxy colour buffer allows MAX_PENDING_RANGES_BIG, so one playback frame's
 *  few hundred scattered changes stay a partial upload instead of resending all 12 MB. */
export function pendingRangeCap(elements: number): number {
  return Math.max(MAX_PENDING_RANGES, Math.min(MAX_PENDING_RANGES_BIG, Math.floor(elements / RANGE_COST_ELEMENTS)));
}

export class UploadTracker {
  /** A full upload is pending. True until the first upload, which is always full. */
  private full = true;
  /** Ranges added since the last upload. */
  private pending = 0;

  constructor(
    private attr: UploadAttr,
    /** Pending ranges past which the next mark goes full. */
    private maxRanges = MAX_PENDING_RANGES,
  ) {
    attr.onUpload(() => {
      this.full = false;
      this.pending = 0;
    });
  }

  /** Upload elements [start, start + count) at the next render, on top of anything pending. */
  markRange(start: number, count: number) {
    if (count <= 0) return;
    if (!this.full) {
      if (this.pending >= this.maxRanges) return this.markFull();
      this.attr.addUpdateRange(start, count);
      this.pending++;
    }
    this.attr.needsUpdate = true;
  }

  /** Upload everything at the next render. */
  markFull() {
    this.full = true;
    this.pending = 0;
    this.attr.clearUpdateRanges();
    this.attr.needsUpdate = true;
  }
}
