/** Phone-first Daily spend layout. Desktop (lg+) is a two-column read view. */

export const PAGE_CLASS = "min-h-screen overflow-x-hidden bg-gray-50 pb-12";
export const PAGE_INNER_CLASS = "mx-auto max-w-6xl min-w-0 px-4 py-8";
export const HEADER_CLASS = "mb-6 flex min-w-0 flex-wrap items-start justify-between gap-3";
export const TITLE_CLASS = "text-2xl font-semibold text-gray-900";
export const SUBTITLE_CLASS = "mt-1 text-sm text-gray-600";
export const COLUMNS_CLASS = "grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]";
export const STACK_CLASS = "flex min-w-0 flex-col gap-4";
export const CARD_CLASS = "min-w-0 overflow-hidden rounded-2xl border border-gray-200 bg-white p-5";
export const RANGE_TOGGLE_CLASS =
  "flex shrink-0 rounded-full border border-gray-200 bg-white p-1 text-sm";
export const THEME_ROW_CLASS =
  "flex min-w-0 w-full items-start gap-3 py-3 text-left hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-violet-400";
export const THEME_NAME_CLASS = "min-w-0 break-words text-sm font-medium text-gray-900";
export const THEME_AMOUNT_CLASS = "shrink-0 whitespace-nowrap text-right tabular-nums";
export const THEME_CHEVRON_CLASS = "mt-1.5 h-4 w-4 shrink-0 text-gray-300";

/** Desktop: centred ~560px dialog. Mobile: 90% bottom sheet, no horizontal overflow. */
export const MODAL_BACKDROP_CLASS = "fixed inset-0 bg-black/50";
export const MODAL_SHELL_CLASS =
  "fixed inset-0 z-50 flex items-end justify-center lg:items-center lg:p-4";
export const MODAL_PANEL_CLASS =
  "relative z-10 flex min-w-0 w-full max-w-full flex-col overflow-hidden bg-white shadow-xl max-lg:h-[90%] max-lg:rounded-t-2xl lg:max-h-[min(90vh,800px)] lg:max-w-[560px] lg:rounded-2xl";
export const MODAL_BODY_CLASS =
  "min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-y-contain px-5 py-4";
export const MODAL_FOOTER_CLASS =
  "shrink-0 border-t border-gray-100 bg-white px-5 py-3";
export const MODAL_HANDLE_CLASS =
  "mx-auto mt-2 mb-1 h-1 w-10 shrink-0 rounded-full bg-gray-300 lg:hidden";
