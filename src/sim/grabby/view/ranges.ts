// Which parts of a per-item GPU buffer to upload after a partial change.

export interface Range {
  start: number;
  count: number;
}

/** Fraction of items changed above which a full upload is cheaper than many small ones. */
export const FULL_UPLOAD_FRACTION = 0.25;

/**
 * Upload ranges (in array elements, i.e. item × itemSize) covering the first `count` item
 * indices, sorted and merged where contiguous. null = upload everything.
 */
export function updateRanges(items: ArrayLike<number>, count: number, total: number, itemSize: number): Range[] | null {
  if (count > total * FULL_UPLOAD_FRACTION) return null;
  const sorted = Int32Array.from({ length: count }, (_, k) => items[k]).sort();
  const out: Range[] = [];
  let lo = -1, hi = -1; // current run [lo, hi] of items
  for (const g of sorted) {
    if (g <= hi + 1 && lo >= 0) hi = Math.max(hi, g);
    else {
      if (lo >= 0) out.push({ start: lo * itemSize, count: (hi - lo + 1) * itemSize });
      lo = hi = g;
    }
  }
  if (lo >= 0) out.push({ start: lo * itemSize, count: (hi - lo + 1) * itemSize });
  return out;
}
