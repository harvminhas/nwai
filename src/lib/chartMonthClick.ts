/**
 * Recharts 3 chart-level click payload (ComposedChart onClick).
 *
 * Recharts 3 does not pass activePayload to this handler. It passes
 * MouseHandlerDataParam: activeIndex / activeLabel from tooltip state.
 * Tooltip trigger defaults to hover, so activeIndex is the hover index —
 * missing if the pointer never moved, and Recharts documents a click
 * path that can reset activeIndex to 0.
 *
 * Pointer X against rendered `circle[data-month]` is the user-facing
 * selection: click the plot, select that month. Recharts state is fallback.
 *
 * Do not use XAxis `activeLabel` alone when dataKey is a short month name
 * ("Jan") — that collides across years.
 */
export type RechartsClickState = {
  activeIndex?: string | number | null;
  activeLabel?: string | number | null;
  activePayload?: Array<{ payload?: { month?: string } }>;
};

export type ChartPointerEvent = {
  clientX?: number;
  currentTarget?: EventTarget | null;
};

export function monthFromNearestPlotX(
  relativeX: number,
  dots: Array<{ month: string; cx: number }>
): string | null {
  if (dots.length === 0 || !Number.isFinite(relativeX)) return null;
  let best = dots[0];
  let bestDist = Math.abs(dots[0].cx - relativeX);
  for (let i = 1; i < dots.length; i++) {
    const dist = Math.abs(dots[i].cx - relativeX);
    if (dist < bestDist) {
      best = dots[i];
      bestDist = dist;
    }
  }
  return best.month;
}

function isQueryElement(
  value: unknown
): value is { getBoundingClientRect: () => DOMRect; querySelectorAll: (selector: string) => ArrayLike<Element> } {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as { getBoundingClientRect?: unknown }).getBoundingClientRect === "function" &&
    typeof (value as { querySelectorAll?: unknown }).querySelectorAll === "function"
  );
}

export function monthFromPointerEvent(
  event: ChartPointerEvent | null | undefined
): string | null {
  if (!event || typeof event.clientX !== "number") return null;
  const target = event.currentTarget;
  if (!isQueryElement(target)) return null;
  const rect = target.getBoundingClientRect();
  const relativeX = event.clientX - rect.left;
  const dots = Array.from(target.querySelectorAll("circle[data-month]"))
    .map((el) => ({
      month: el.getAttribute("data-month") ?? "",
      cx: Number(el.getAttribute("cx")),
    }))
    .filter((d) => d.month && Number.isFinite(d.cx));
  return monthFromNearestPlotX(relativeX, dots);
}

export function monthFromRechartsClick(
  state: RechartsClickState | null | undefined,
  chartData: Array<{ month: string; label?: string }>
): string | null {
  const fromPayload = state?.activePayload?.[0]?.payload?.month;
  if (typeof fromPayload === "string" && fromPayload.length > 0) {
    return fromPayload;
  }

  const idxRaw = state?.activeIndex;
  if (idxRaw !== undefined && idxRaw !== null && idxRaw !== "") {
    const idx = typeof idxRaw === "number" ? idxRaw : Number(idxRaw);
    if (Number.isFinite(idx) && idx >= 0 && idx < chartData.length) {
      return chartData[idx].month;
    }
  }

  const label = state?.activeLabel;
  if (label !== undefined && label !== null && label !== "") {
    const asStr = String(label);
    const byMonth = chartData.find((d) => d.month === asStr);
    if (byMonth) return byMonth.month;
    const matches = chartData.filter((d) => d.label === asStr);
    if (matches.length === 1) return matches[0].month;
  }

  return null;
}

export function monthFromChartInteraction(
  state: RechartsClickState | null | undefined,
  event: ChartPointerEvent | null | undefined,
  chartData: Array<{ month: string; label?: string }>
): string | null {
  return monthFromPointerEvent(event) ?? monthFromRechartsClick(state, chartData);
}
