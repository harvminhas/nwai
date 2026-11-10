/** Phone-only spending category-row layout. Desktop (lg+) restores the original row. */

export const SPENDING_CATEGORY_ROW_CLASS =
  "flex items-center gap-3 p-3 rounded-lg transition-colors";

/** Phone: wrap up to 2 lines inside the left column. Desktop (lg+): original `font-medium text-neutral-900` wrapping. */
export const SPENDING_CATEGORY_NAME_CLASS =
  "min-w-0 break-words line-clamp-2 font-medium text-neutral-900 lg:line-clamp-none lg:break-normal";

export const SPENDING_CATEGORY_SPARKLINE_CLASS = "hidden flex-shrink-0 lg:block";

export const SPENDING_CATEGORY_AMOUNT_COL_CLASS = "flex shrink-0 items-center gap-3";

export const SPENDING_CATEGORY_AMOUNT_CLASS =
  "font-semibold whitespace-nowrap tabular-nums text-neutral-900";

export const SPENDING_CATEGORY_TREND_CLASS = "text-xs whitespace-nowrap tabular-nums";
