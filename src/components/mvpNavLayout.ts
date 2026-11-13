/** Phone-only top-bar and drawer layout. Desktop (lg+) nav is unchanged. */

export const NET_WORTH_NAV_ITEMS = [
  { href: "/account/net-worth", label: "Net Worth" },
  { href: "/account/assets", label: "Assets" },
  { href: "/account/liabilities", label: "Debts" },
] as const;

export function isMvpNavActive(
  pathname: string | null | undefined,
  path: string,
): boolean {
  return pathname === path || Boolean(pathname?.startsWith(path + "/"));
}

export function dropdownLinkClass(active: boolean): string {
  return `block rounded-xl px-3 py-2 text-sm ${
    active
      ? "bg-violet-50 font-semibold text-violet-700"
      : "text-gray-700 hover:bg-violet-50 hover:text-violet-700"
  }`;
}

export const DESKTOP_NET_WORTH_PILL_CLASS =
  "relative hidden items-center gap-2.5 whitespace-nowrap rounded-full border border-gray-200 bg-white px-3.5 py-1.5 text-[13px] transition-colors hover:border-gray-300 lg:flex";

export const DESKTOP_NET_WORTH_SKELETON_CLASS =
  "hidden h-8 w-48 animate-pulse rounded-full border border-gray-200 bg-gray-100 lg:block";

export const MOBILE_NET_WORTH_LINK_CLASS =
  "flex min-w-0 shrink items-center justify-end gap-1 lg:hidden";

export const MOBILE_NET_WORTH_SKELETON_CLASS =
  "h-5 w-[7.25rem] shrink-0 animate-pulse rounded bg-gray-100 lg:hidden";

export const MOBILE_NET_WORTH_VALUE_CLASS =
  "whitespace-nowrap text-sm font-bold tabular-nums text-gray-900";

export const MOBILE_NET_WORTH_CHANGE_CLASS =
  "hidden whitespace-nowrap text-[11px] font-semibold tabular-nums sm:inline";

export const DRAWER_PANEL_CLASS =
  "fixed bottom-0 right-0 top-0 z-40 flex w-80 max-w-[86vw] flex-col border-l border-gray-200 bg-white shadow-2xl";

export const DRAWER_HEADER_CLASS =
  "flex items-center justify-between gap-3 px-5 pt-5 pb-3";

export const DRAWER_CLOSE_CLASS =
  "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-gray-600 hover:bg-gray-100";

export const DRAWER_BODY_CLASS = "min-h-0 flex-1 overflow-y-auto px-5 pb-2";

export const DRAWER_NET_WORTH_CARD_CLASS =
  "mb-3 rounded-xl bg-gray-50 px-3 py-2.5 text-sm text-gray-600";

export const DRAWER_SECTION_LABEL_CLASS =
  "mb-1 mt-5 px-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-400";

export const DRAWER_FOOTER_CLASS =
  "mt-auto border-t border-gray-200 px-5 py-4 text-sm text-gray-400";

export function drawerLinkClass(active: boolean): string {
  return `flex min-h-11 items-center rounded-xl px-3 text-[15px] ${
    active
      ? "bg-violet-50 font-semibold text-violet-700"
      : "text-gray-700 hover:bg-gray-50"
  }`;
}
