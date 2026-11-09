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

export class UploadTracker {
  /** A full upload is pending. True until the first upload, which is always full. */
  private full = true;

  constructor(private attr: UploadAttr) {
    attr.onUpload(() => {
      this.full = false;
    });
  }

  /** Upload elements [start, start + count) at the next render, on top of anything pending. */
  markRange(start: number, count: number) {
    if (count <= 0) return;
    if (!this.full) this.attr.addUpdateRange(start, count);
    this.attr.needsUpdate = true;
  }

  /** Upload everything at the next render. */
  markFull() {
    this.full = true;
    this.attr.clearUpdateRanges();
    this.attr.needsUpdate = true;
  }
}
