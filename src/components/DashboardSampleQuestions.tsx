"use client";

import { useEffect, useId, useRef, useState } from "react";

export const SAMPLE_QUESTIONS_CHIPS_CLASS =
  "hidden lg:flex flex-wrap items-center justify-center gap-2";
export const SAMPLE_QUESTIONS_DROPDOWN_CLASS = "relative lg:hidden";
export const SAMPLE_QUESTIONS_TRIGGER_CLASS =
  "inline-flex min-h-11 max-w-max items-center gap-1 rounded-md px-2 text-sm text-gray-500 hover:bg-gray-50 hover:text-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-300 disabled:cursor-not-allowed disabled:opacity-40";
export const SAMPLE_QUESTIONS_MENU_CLASS =
  "mx-auto mt-1 w-[min(17.5rem,calc(100vw-2rem))] rounded-xl border border-gray-200 bg-white py-1 shadow-lg";

interface DashboardSampleQuestionsProps {
  suggestions: string[];
  onAsk: (q: string) => void;
  loading?: boolean;
}

/**
 * Dashboard "Try asking" prompts.
 * Desktop (>=1024): the existing chip row, unchanged.
 * Phone: compact content-width trigger + anchored menu; same options and onAsk.
 */
export function DashboardSampleQuestions({
  suggestions,
  onAsk,
  loading = false,
}: DashboardSampleQuestionsProps) {
  const options = suggestions.slice(0, 3);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const menuId = useId();
  const disabled = loading || options.length === 0;

  const ask = (q: string) => {
    if (!q || loading) return;
    onAsk(q);
  };

  const closeMenu = (restoreFocus: boolean) => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  };

  const pick = (q: string) => {
    if (!q || loading) return;
    setOpen(false);
    onAsk(q);
    triggerRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return;

    const onPointer = (event: MouseEvent | TouchEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeMenu(true);
      }
    };

    document.addEventListener("mousedown", onPointer);
    document.addEventListener("touchstart", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("touchstart", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    itemRefs.current[0]?.focus();
  }, [open]);

  const focusItem = (index: number) => {
    const n = options.length;
    if (n === 0) return;
    const i = ((index % n) + n) % n;
    itemRefs.current[i]?.focus();
  };

  const onMenuKeyDown = (event: React.KeyboardEvent) => {
    const current = itemRefs.current.findIndex((el) => el === document.activeElement);
    if (event.key === "ArrowDown") {
      event.preventDefault();
      focusItem(current + 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      focusItem(current <= 0 ? options.length - 1 : current - 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      focusItem(0);
    } else if (event.key === "End") {
      event.preventDefault();
      focusItem(options.length - 1);
    } else if (event.key === "Tab") {
      setOpen(false);
    }
  };

  return (
    <>
      <div className={SAMPLE_QUESTIONS_DROPDOWN_CLASS} ref={rootRef}>
        <div className="flex justify-center">
          <button
            ref={triggerRef}
            type="button"
            id="dashboard-sample-question"
            aria-label="Try asking a sample question"
            aria-haspopup="menu"
            aria-expanded={open}
            aria-controls={open ? menuId : undefined}
            disabled={disabled}
            onClick={() => {
              if (disabled) return;
              setOpen((v) => !v);
            }}
            onKeyDown={(event) => {
              if (disabled) return;
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setOpen(true);
              }
            }}
            className={SAMPLE_QUESTIONS_TRIGGER_CLASS}
          >
            Try asking
            <svg
              className={`h-3.5 w-3.5 text-gray-400 transition-transform ${open ? "rotate-180" : ""}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
              aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>
        </div>
        {open && (
          <div
            id={menuId}
            role="menu"
            aria-labelledby="dashboard-sample-question"
            onKeyDown={onMenuKeyDown}
            className={SAMPLE_QUESTIONS_MENU_CLASS}
          >
            {options.map((q, i) => (
              <button
                key={q}
                type="button"
                role="menuitem"
                ref={(el) => {
                  itemRefs.current[i] = el;
                }}
                onClick={() => pick(q)}
                className="block w-full px-3.5 py-2.5 text-left text-sm leading-snug text-gray-700 hover:bg-gray-50 focus:bg-gray-50 focus:outline-none"
              >
                {q}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className={SAMPLE_QUESTIONS_CHIPS_CLASS}>
        <span className="text-sm text-gray-500">Try asking:</span>
        {options.map((q) => (
          <button
            key={q}
            type="button"
            onClick={() => ask(q)}
            disabled={loading}
            className="rounded-full border border-purple-200 bg-purple-50 px-4 py-2 text-sm font-medium text-purple-700 transition hover:border-purple-300 hover:bg-purple-100 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {q}
          </button>
        ))}
      </div>
    </>
  );
}
