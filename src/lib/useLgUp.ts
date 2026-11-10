"use client";

import { useEffect, useState } from "react";

/** Tailwind `lg` breakpoint. Starts true so SSR / first paint match desktop. */
export function useLgUp(): boolean {
  const [isLg, setIsLg] = useState(true);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const onChange = () => setIsLg(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  return isLg;
}
