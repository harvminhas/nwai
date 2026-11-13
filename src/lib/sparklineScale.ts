/**
 * Y-domain for a sparkline: the series' own min/max plus a little padding.
 * Not zero-based — a $50k–$51k series should fill the height, not sit as a flat line at the top.
 */
export function sparklineYDomain(values: number[]): { min: number; max: number } {
  if (values.length === 0) return { min: 0, max: 1 };
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo;
  const pad = span < 1e-9 ? Math.max(Math.abs(hi) * 0.05, 1) : span * 0.08;
  return { min: lo - pad, max: hi + pad };
}
