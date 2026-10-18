/** A single bounded byte range. null means no Range header; invalid input throws. */
export function byteRange(value: string | undefined, size: number): { start: number; end: number } | null {
  if (value === undefined) return null;
  if (!Number.isSafeInteger(size) || size <= 0 || value.length > 100) throw new Error('range');
  const m = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!m || (!m[1] && !m[2])) throw new Error('range');
  const first = m[1] ? Number(m[1]) : null,
    last = m[2] ? Number(m[2]) : null;
  if ((first !== null && !Number.isSafeInteger(first)) || (last !== null && !Number.isSafeInteger(last)))
    throw new Error('range');
  if (first === null) {
    if (last === null || last <= 0) throw new Error('range');
    return { start: Math.max(0, size - last), end: size - 1 };
  }
  if (first >= size || (last !== null && last < first)) throw new Error('range');
  return { start: first, end: Math.min(last ?? size - 1, size - 1) };
}
