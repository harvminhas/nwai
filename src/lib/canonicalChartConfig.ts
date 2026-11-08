/**
 * Canonical chart visual configuration
 * Extracted from ACTUAL /account/net-worth page (src/app/account/net-worth/page.tsx:334-449)
 * All line charts should use these exact visual properties for consistency
 */

import type { CSSProperties } from "react";

/**
 * Canonical chart margin - from actual net-worth page line 357
 */
export const CANONICAL_CHART_MARGIN = {
  top: 20,
  right: 10,
  left: 10,
  bottom: 0,
} as const;

/**
 * Canonical CartesianGrid configuration - from line 365
 */
export const CANONICAL_GRID_CONFIG = {
  strokeDasharray: "3 3",
  stroke: "#e5e7eb",
  vertical: false,
} as const;

/**
 * Canonical XAxis configuration - from lines 366-370
 */
export const CANONICAL_XAXIS_CONFIG = {
  tick: { fontSize: 12, fill: "#6b7280" },
  axisLine: { stroke: "#e5e7eb" },
  tickLine: { stroke: "#e5e7eb" },
} as const;

/**
 * Canonical YAxis configuration - from lines 371-394
 */
export const CANONICAL_YAXIS_CONFIG = {
  tick: { fontSize: 12, fill: "#6b7280" },
  axisLine: { stroke: "#e5e7eb" },
  tickLine: { stroke: "#e5e7eb" },
} as const;

/**
 * Canonical Tooltip content style - from lines 400-412
 * Custom tooltip with white bg, gray border, shadow
 */
export const CANONICAL_TOOLTIP_STYLE = {
  backgroundColor: "white",
  border: "1px solid #e5e7eb",
  borderRadius: "8px",
  boxShadow: "0 10px 15px -3px rgb(0 0 0 / 0.1)",
  padding: "0.75rem",
} as const;

/**
 * Canonical Line configuration - from lines 425-447
 * Green (#10b981) emerald-500, strokeWidth 2
 * Selected dots: 6px, ordinary: 4px
 */
export const CANONICAL_LINE_CONFIG = {
  type: "monotone" as const,
  strokeWidth: 2,
  activeDot: { r: 6, fill: "#059669", stroke: "#fff", strokeWidth: 2 },
} as const;

/**
 * Canonical chart height - from line 335 (actual net-worth uses 340px)
 */
export const CANONICAL_CHART_HEIGHT = 340;

/**
 * Canonical dot configuration
 * Selected: 6px radius, ordinary: 4px
 */
export const CANONICAL_DOT_CONFIG = {
  selected: { r: 6, strokeWidth: 3 },
  ordinary: { r: 4, strokeWidth: 2 },
} as const;

/**
 * Get canonical line color based on chart type
 * From actual implementations:
 * - net-worth: #10b981 (emerald-500)
 * - spending: #10b981 (emerald-500)
 * - forecast: #2563eb (blue-600)
 */
export function getCanonicalLineColor(chartType: "balance" | "spending" | "income" | "forecast"): string {
  switch (chartType) {
    case "balance":
    case "spending":
      return "#10b981"; // emerald-500 (actual canonical)
    case "income":
      return "#7c3aed"; // purple-600
    case "forecast":
      return "#2563eb"; // blue-600
    default:
      return "#10b981";
  }
}
