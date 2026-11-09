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

export class UploadTracker {
  /** A full upload is pending. True until the first upload, which is always full. */
  private full = true;
  /** Ranges added since the last upload. */
  private pending = 0;

  constructor(private attr: UploadAttr) {
    attr.onUpload(() => {
      this.full = false;
      this.pending = 0;
    });
  }

  /** Upload elements [start, start + count) at the next render, on top of anything pending. */
  markRange(start: number, count: number) {
    if (count <= 0) return;
    if (!this.full) {
      if (this.pending >= MAX_PENDING_RANGES) return this.markFull();
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
