"use client";

import { useSyncExternalStore } from "react";

/**
 * Subscribe to a min-width media query. SSR snapshot is false (phone-first)
 * so Assets/Debts charts do not paint the squeezed desktop Y-axis on phones.
 * Desktop >=1024 hydrates to the accepted canonical chart layout.
 */
function minWidthMql(px: number): MediaQueryList | null {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return null;
  return window.matchMedia(`(min-width: ${px}px)`);
}

export function useMediaMinWidth(px: number): boolean {
  return useSyncExternalStore(
    (onStoreChange) => {
      const mq = minWidthMql(px);
      if (!mq) return () => {};
      mq.addEventListener("change", onStoreChange);
      return () => mq.removeEventListener("change", onStoreChange);
    },
    () => minWidthMql(px)?.matches ?? false,
    () => false
  );
}

export const DESKTOP_LG_PX = 1024;

export function useIsDesktopLg(): boolean {
  return useMediaMinWidth(DESKTOP_LG_PX);
}
