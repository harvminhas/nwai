/**
 * Shared Assets/Debts section layout tokens.
 * Mobile-first; `lg:` restores the accepted >=1024 desktop look.
 */

import { CANONICAL_CHART_HEIGHT, CANONICAL_CHART_MARGIN } from "./canonicalChartConfig";

export const ACCOUNT_PAGE_SHELL =
  "mx-auto max-w-5xl overflow-x-clip px-4 pt-4 pb-8 sm:py-8";

export const ACCOUNT_PAGE_HEADER =
  "mb-4 flex flex-wrap items-start justify-between gap-3 sm:mb-6 lg:gap-4";

export const ACCOUNT_PAGE_TABS_NAV = "-mb-px flex gap-1 lg:gap-6";

export const ACCOUNT_PAGE_TAB_BASE =
  "min-h-11 flex-1 border-b-2 px-2 pb-3 pt-2 text-center text-sm font-medium transition-colors lg:min-h-0 lg:flex-none lg:px-1 lg:pt-0 lg:text-left";

export const ACCOUNT_CARD = "bg-white rounded-lg border border-gray-200 p-4 lg:p-6";

export const ACCOUNT_COMPARISON_ROW =
  "flex flex-col gap-1 text-sm lg:flex-row lg:gap-4";

export const ACCOUNT_TYPE_ROW = "flex items-start justify-between gap-3 mb-1.5 lg:items-center";

export const ACCOUNT_TYPE_LABEL = "min-w-0 flex-1";

export const ACCOUNT_TYPE_AMOUNT = "shrink-0 text-right";

export const ACCOUNT_DETAIL_ROW =
  "flex items-start justify-between gap-3 min-h-11 border-b border-gray-100 py-2.5 last:border-0 lg:min-h-0 lg:items-center lg:py-2";

export const ACCOUNT_DETAIL_LABEL = "min-w-0 flex-1 text-sm text-gray-700 break-words";

export const ACCOUNT_DETAIL_AMOUNT = "shrink-0 text-right lg:whitespace-nowrap";

export const ACCOUNT_DETAIL_PCT = "block text-xs text-gray-500 lg:ml-2 lg:inline";

export const ACCOUNT_CATEGORY_ITEM =
  "flex items-start gap-3 min-h-11 py-2.5 pl-4 pr-3 text-gray-800 transition-colors hover:bg-gray-50 focus-visible:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-violet-400 lg:min-h-0 lg:py-2 lg:pl-9 lg:pr-5";

export const ACCOUNT_CATEGORY_PRIMARY =
  "block break-words text-[13px] leading-5 text-gray-800 lg:truncate";

export const ACCOUNT_CATEGORY_META =
  "mt-0.5 block break-words text-[11px] leading-4 text-gray-400 lg:truncate";

export const ACCOUNT_CATEGORY_AMOUNT =
  "min-w-[4.75rem] shrink-0 text-right text-[13px] leading-5 tabular-nums text-gray-900 lg:w-[7.25rem] lg:min-w-[7.25rem]";

export const ACCOUNT_SWITCHER_MENU =
  "absolute right-0 z-40 mt-2 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-gray-200 bg-white shadow-xl";

export const PHONE_CHART_HEIGHT = 220;
export const PHONE_CHART_MARGIN = { top: 12, right: 20, left: 2, bottom: 8 } as const;
export const PHONE_YAXIS_WIDTH = 44;

export { CANONICAL_CHART_HEIGHT, CANONICAL_CHART_MARGIN };

export function accountPageTabClass(active: boolean): string {
  return `${ACCOUNT_PAGE_TAB_BASE} ${
    active
      ? "border-purple-600 text-purple-600"
      : "border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700"
  }`;
}
