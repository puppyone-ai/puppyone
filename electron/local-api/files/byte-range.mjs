/**
 * Parses one RFC-style byte range. Multi-range requests are intentionally not
 * supported by the local capability transport.
 */
export function parseSingleByteRange(rangeHeader, size) {
  if (typeof rangeHeader !== "string" || rangeHeader.trim().length === 0) return null;

  const match = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader.trim());
  if (!match || size <= 0) return { unsatisfiable: true };

  const [, startValue, endValue] = match;
  if (!startValue && !endValue) return { unsatisfiable: true };

  if (!startValue) {
    const suffixLength = Number(endValue);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) {
      return { unsatisfiable: true };
    }
    return {
      start: Math.max(size - suffixLength, 0),
      end: size - 1,
    };
  }

  const start = Number(startValue);
  const end = endValue ? Number(endValue) : size - 1;
  if (
    !Number.isSafeInteger(start)
    || !Number.isSafeInteger(end)
    || start < 0
    || end < start
    || start >= size
  ) {
    return { unsatisfiable: true };
  }

  return {
    start,
    end: Math.min(end, size - 1),
  };
}
