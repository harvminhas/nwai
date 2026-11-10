import type { ReactNode } from "react";

/** Keep currency values on one line. Labels may wrap; amounts must not. */
export const INTACT_AMOUNT_CLASS = "shrink-0 whitespace-nowrap tabular-nums";

export function IntactAmount({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span className={`${INTACT_AMOUNT_CLASS} ${className}`.trim()}>
      {children}
    </span>
  );
}
