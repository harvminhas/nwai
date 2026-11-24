"use client";

import { useEffect, useState, useRef } from "react";
import { createPortal } from "react-dom";
import {
  ResponsiveContainer, BarChart, Bar, Cell, XAxis, YAxis,
  CartesianGrid, Tooltip, ReferenceLine,
} from "recharts";
import { formatCurrency, getCurrencySymbol } from "@/lib/currencyUtils";
import {
  CATEGORY_COLORS,
  categoryColor,
  CATEGORY_TAXONOMY,
  PARENT_CATEGORIES,
  PICKER_CATEGORIES,
  getParentCategory,
  isSubtype,
  isAssetPurchaseCategory,
  defaultApplyToMerchant,
  PARENTS_WITH_SUBTYPES,
} from "@/lib/categoryTaxonomy";

// Re-export from taxonomy so existing imports keep working
export { CATEGORY_COLORS, categoryColor } from "@/lib/categoryTaxonomy";
export { getParentCategory, isSubtype } from "@/lib/categoryTaxonomy";

export type CashFrequency = "weekly" | "biweekly" | "monthly" | "quarterly" | "annual" | "once";

// Legacy ALL_CATEGORIES — kept for backwards compat. Use PICKER_CATEGORIES for new code.
export const ALL_CATEGORIES = [
  ...PARENT_CATEGORIES,
  // Income re-assignment
  "Income - Salary",
  "Income - Other",
] as const;

// ── RecurringIcon ─────────────────────────────────────────────────────────────

export function RecurringIcon({ active }: { active: boolean }) {
  return (
    <svg className={`h-3.5 w-3.5 ${active ? "text-purple-600" : "text-gray-300"}`}
      fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round"
        d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
    </svg>
  );
}

// ── CategoryPicker (portal, fixed-position, two-level accordion) ──────────────

export type CategorySelectMeta = {
  applyToMerchant: boolean;
  linkAssetId?: string;
  linkAmount?: number;
};

export type CategoryPickerAsset = { id: string; label: string };

interface CategoryPickerProps {
  anchorRef: React.RefObject<HTMLButtonElement | null>;
  current: string;
  onSelect: (cat: string, meta?: CategorySelectMeta) => void;
  onClose: () => void;
  /** `undefined` = default banner; `null` = no banner; string = custom. */
  headerHint?: string | null;
  /** Bearer token — used to load assets when tagging an Asset purchase. */
  authToken?: string | null;
  assets?: CategoryPickerAsset[];
  /** Merchant-level chips have no single txn — hide “only this transaction”. */
  forceMerchantRule?: boolean;
}

export { isAssetPurchaseCategory, defaultApplyToMerchant };

export function CategoryPicker({
  anchorRef,
  current,
  onSelect,
  onClose,
  headerHint,
  authToken,
  assets: assetsProp,
  forceMerchantRule = false,
}: CategoryPickerProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<React.CSSProperties>({ visibility: "hidden" });
  const [pendingAssetCat, setPendingAssetCat] = useState<string | null>(null);
  const [applyToMerchant, setApplyToMerchant] = useState(false);
  const [linkAssetId, setLinkAssetId] = useState<string>("");
  const [linkAmount, setLinkAmount] = useState("");
  const [loadedAssets, setLoadedAssets] = useState<CategoryPickerAsset[] | null>(null);

  // All parents collapsed by default; only pre-expand the current selection's parent
  const currentParent = getParentCategory(current).toLowerCase();
  const currentIsSubtype = current.toLowerCase() !== currentParent;
  const [expanded, setExpanded] = useState<Set<string>>(() =>
    // Only pre-expand if the current value is actually a subtype (not a parent)
    currentIsSubtype ? new Set([currentParent]) : new Set()
  );

  useEffect(() => {
    if (!anchorRef.current) return;
    const rect = anchorRef.current.getBoundingClientRect();
    const PADDING = 12;
    const spaceBelow = window.innerHeight - rect.bottom - PADDING;
    const spaceAbove = rect.top - PADDING;
    const openBelow = spaceBelow >= spaceAbove || spaceBelow >= 200;
    const maxHeight = Math.max(openBelow ? spaceBelow : spaceAbove, 160);

    setStyle({
      position: "fixed",
      top: openBelow ? rect.bottom + PADDING : undefined,
      bottom: openBelow ? undefined : window.innerHeight - rect.top + PADDING,
      left: Math.min(rect.left, window.innerWidth - 232),
      width: 224,
      maxHeight,
      zIndex: 9999,
      visibility: "visible",
    });
  }, [anchorRef]);

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (
        menuRef.current && !menuRef.current.contains(e.target as Node) &&
        anchorRef.current && !anchorRef.current.contains(e.target as Node)
      ) onClose();
    }
    function onScroll(e: Event) {
      if (menuRef.current && menuRef.current.contains(e.target as Node)) return;
      onClose();
    }
    document.addEventListener("mousedown", handle);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", handle);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [onClose, anchorRef]);

  const toggleExpand = (parent: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(parent)) next.delete(parent);
      else next.add(parent);
      return next;
    });
  };

  const bannerText = headerHint === undefined ? "Change category · saves as rule" : headerHint;
  const assets = assetsProp ?? loadedAssets ?? [];

  useEffect(() => {
    if (!pendingAssetCat || assetsProp || !authToken) return;
    let cancelled = false;
    fetch("/api/user/assets", { headers: { Authorization: `Bearer ${authToken}` } })
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        const list = Array.isArray(j.assets)
          ? (j.assets as Array<{ id: string; label: string }>).map((a) => ({ id: a.id, label: a.label }))
          : [];
        setLoadedAssets(list);
      })
      .catch(() => {
        if (!cancelled) setLoadedAssets([]);
      });
    return () => { cancelled = true; };
  }, [pendingAssetCat, assetsProp, authToken]);

  function pickCategory(cat: string) {
    if (isAssetPurchaseCategory(cat)) {
      setPendingAssetCat(cat);
      setApplyToMerchant(forceMerchantRule);
      setLinkAssetId("");
      setLinkAmount("");
      return;
    }
    if (isAssetPurchaseCategory(current) && !forceMerchantRule) {
      // Moving off an Asset purchase tag: overwrite this transaction's override.
      // A merchant rule would be shadowed by that override and nothing would change.
      onSelect(cat, { applyToMerchant: false });
      return;
    }
    onSelect(cat);
  }

  function confirmAssetPurchase() {
    if (!pendingAssetCat) return;
    const amount = parseFloat(linkAmount);
    onSelect(pendingAssetCat, {
      applyToMerchant,
      ...(linkAssetId
        ? {
            linkAssetId,
            ...(Number.isFinite(amount) && amount > 0 ? { linkAmount: amount } : {}),
          }
        : {}),
    });
  }

  return createPortal(
    <div ref={menuRef} style={{ ...style, width: pendingAssetCat ? 260 : (style.width ?? 224) }}
      className="rounded-xl border border-gray-200 bg-white shadow-xl ring-1 ring-black/5 flex flex-col overflow-hidden">
      {pendingAssetCat ? (
        <div className="flex flex-col overflow-hidden">
          <div className="shrink-0 border-b border-gray-100 px-3 py-2">
            <button
              type="button"
              onClick={() => setPendingAssetCat(null)}
              className="text-[11px] font-medium text-indigo-600 hover:text-indigo-800"
            >
              ← Categories
            </button>
            <p className="mt-1 text-sm font-semibold text-gray-900">{pendingAssetCat}</p>
            <p className="text-[11px] text-gray-500">Not spending — money moved into something you own.</p>
          </div>
          <div className="overflow-y-auto flex-1 px-3 py-2 space-y-3">
            <fieldset>
              <legend className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Apply to</legend>
              {!forceMerchantRule && (
              <label className="mt-1 flex items-start gap-2 text-sm text-gray-800">
                <input
                  type="radio"
                  name="asset-scope"
                  checked={!applyToMerchant}
                  onChange={() => setApplyToMerchant(false)}
                  className="mt-1"
                />
                <span>Only this transaction</span>
              </label>
              )}
              <label className="mt-1 flex items-start gap-2 text-sm text-gray-800">
                <input
                  type="radio"
                  name="asset-scope"
                  checked={applyToMerchant}
                  onChange={() => setApplyToMerchant(true)}
                  className="mt-1"
                />
                <span>All from this merchant</span>
              </label>
            </fieldset>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Link to asset</p>
              <p className="mt-0.5 text-[11px] text-gray-500">Optional. You can skip this.</p>
              {assets.length === 0 ? (
                <p className="mt-1 text-xs text-gray-500">No assets yet — skip, or add one on the Assets page.</p>
              ) : (
                <ul className="mt-1 max-h-36 space-y-0.5 overflow-y-auto">
                  {assets.map((asset) => (
                    <li key={asset.id}>
                      <button
                        type="button"
                        onClick={() => setLinkAssetId((id) => (id === asset.id ? "" : asset.id))}
                        className={`flex w-full items-center rounded-lg px-2 py-1.5 text-left text-sm ${
                          linkAssetId === asset.id
                            ? "bg-indigo-50 font-semibold text-indigo-900"
                            : "text-gray-700 hover:bg-gray-50"
                        }`}
                      >
                        {linkAssetId === asset.id ? "Link to asset: " : ""}{asset.label}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {linkAssetId && (
                <label className="mt-2 block text-[11px] text-gray-500">
                  Part of this amount (optional)
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={linkAmount}
                    onChange={(e) => setLinkAmount(e.target.value)}
                    className="mt-1 w-full rounded-md border border-gray-200 px-2 py-1 text-sm text-gray-900"
                    placeholder="Whole transaction"
                  />
                </label>
              )}
            </div>
          </div>
          <div className="shrink-0 border-t border-gray-100 p-2">
            <button
              type="button"
              onClick={confirmAssetPurchase}
              className="w-full rounded-lg bg-indigo-600 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
            >
              Save
            </button>
          </div>
        </div>
      ) : (
      <>
      {bannerText !== null && bannerText !== "" && (
      <p className="shrink-0 px-3 pb-1.5 pt-2 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
        {bannerText}
      </p>
      )}
      <div className="overflow-y-auto flex-1">
        {/* ── Standard categories (two-level) ── */}
        {(Object.entries(CATEGORY_TAXONOMY) as [string, readonly string[]][]).map(([parent, subtypes]) => {
          const parentLower  = parent.toLowerCase();
          const color        = categoryColor(parentLower);
          const isActivePar  = current.toLowerCase() === parentLower;
          const hasExpanded  = expanded.has(parentLower);
          const hasSubs      = subtypes.length > 0;

          return (
            <div key={parent}>
              {/* Parent row */}
              <div className="flex items-center">
                <button
                  onClick={() => pickCategory(parent)}
                  className={`flex flex-1 items-center gap-2.5 px-3 py-2 text-left text-sm transition hover:bg-gray-50 ${
                    isActivePar ? "font-semibold text-gray-900" : "text-gray-700"
                  }`}
                >
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />
                  <span className="flex-1">{parent}</span>
                  {isActivePar && <span className="text-xs text-gray-400">latest</span>}
                </button>
                {hasSubs && (
                  <button
                    onClick={() => toggleExpand(parentLower)}
                    className="shrink-0 px-2 py-2 text-gray-400 hover:text-gray-600 transition"
                    aria-label={hasExpanded ? "Collapse subtypes" : "Expand subtypes"}
                  >
                    <svg className={`h-3 w-3 transition-transform ${hasExpanded ? "rotate-180" : ""}`}
                      fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                )}
              </div>

              {/* Subtype rows (indented, visible when expanded) */}
              {hasSubs && hasExpanded && (
                <div className="border-l-2 ml-5 border-gray-100">
                  {subtypes.map((sub) => {
                    const subColor   = categoryColor(sub.toLowerCase());
                    const isActiveSub = current.toLowerCase() === sub.toLowerCase();
                    return (
                      <button
                        key={sub}
                        onClick={() => pickCategory(sub)}
                        className={`flex w-full items-center gap-2.5 pl-3 pr-3 py-1.5 text-left text-[13px] transition hover:bg-gray-50 ${
                          isActiveSub ? "font-semibold text-gray-900" : "text-gray-600"
                        }`}
                      >
                        <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: subColor }} />
                        <span className="flex-1">{sub}</span>
                        {isActiveSub && <span className="text-xs text-gray-400">latest</span>}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}

        {/* ── Income re-assignment section ── */}
        <div className="mx-3 my-1 border-t border-gray-100 pt-1">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-green-600 pb-1">
            Move to Income
          </p>
        </div>
        {(["Income - Salary", "Income - Other"] as const).map((cat) => {
          const isActive = cat.toLowerCase() === current.toLowerCase();
          return (
            <button key={cat} onClick={() => onSelect(cat)}
              className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition hover:bg-gray-50 ${
                isActive ? "font-semibold text-green-700" : "text-green-700"
              }`}>
              <span className="h-2 w-2 shrink-0 rounded-full bg-green-400" />
              <span className="flex-1">{cat}</span>
              {isActive && <span className="text-xs text-gray-400">latest</span>}
            </button>
          );
        })}
      </div>
      </>
      )}
    </div>,
    document.body
  );
}

// Silence unused-import warnings for consumers that import these from here
// (they're re-exported above)
void PARENTS_WITH_SUBTYPES;
void PICKER_CATEGORIES;
void isSubtype;

export type PersistCategoryChangeInput = {
  token: string;
  category: string;
  merchant: string;
  applyToMerchant: boolean;
  amount: number;
  date?: string;
  stmtId?: string;
  accountSlug?: string;
  fingerprint?: string;
  linkAssetId?: string;
  linkAmount?: number;
};

/** Save a recategorize: this-txn override or merchant rule, then optional funds link. */
export async function persistCategoryChange(
  input: PersistCategoryChangeInput,
): Promise<{ ok: boolean; error?: string }> {
  const headers = { Authorization: `Bearer ${input.token}`, "Content-Type": "application/json" };
  try {
    if (input.applyToMerchant) {
      const res = await fetch("/api/user/category-rules", {
        method: "PUT",
        headers,
        body: JSON.stringify({ merchant: input.merchant, category: input.category }),
      });
      if (!res.ok) return { ok: false, error: "Failed to save rule" };
    } else {
      const stmtId = input.stmtId || input.accountSlug;
      if (!stmtId) return { ok: false, error: "Missing transaction id" };
      const res = await fetch("/api/user/txn-category", {
        method: "PUT",
        headers,
        body: JSON.stringify({
          stmtId,
          accountSlug: input.accountSlug,
          date: input.date,
          amount: input.amount,
          merchant: input.merchant,
          category: input.category,
        }),
      });
      if (!res.ok) return { ok: false, error: "Failed to save category" };
    }

    if (input.linkAssetId && (input.fingerprint || (input.accountSlug && input.date))) {
      const res = await fetch("/api/user/tx-links", {
        method: "POST",
        headers,
        body: JSON.stringify({
          fingerprint: input.fingerprint,
          accountSlug: input.accountSlug,
          date: input.date,
          txnAmount: input.amount,
          merchant: input.merchant,
          hubId: input.linkAssetId,
          role: "funds",
          ...(input.linkAmount != null ? { amount: input.linkAmount } : {}),
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        return { ok: true, error: typeof j.error === "string" ? j.error : "Category saved; could not link asset" };
      }
    }
    return { ok: true };
  } catch {
    return { ok: false, error: "Failed to save" };
  }
}

// ── Date helpers ──────────────────────────────────────────────────────────────

export function monthLabel(ym: string) {
  const [y, m] = ym.split("-");
  if (!m) return ym;
  return new Date(parseInt(y), parseInt(m) - 1, 1).toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

export function shortMonth(ym: string) {
  const [y, m] = ym.split("-");
  if (!m) return ym;
  return new Date(parseInt(y), parseInt(m) - 1, 1).toLocaleDateString("en-US", { month: "short" });
}

// ── SpendingChart ─────────────────────────────────────────────────────────────

export type HistoryPoint = { yearMonth: string; netWorth: number; expensesTotal?: number; coreExpensesTotal?: number };

export function SpendingChart({ history, avg, median, selectedMonth, effectiveExp, onMonthClick, homeCurrency = "USD" }: {
  history: HistoryPoint[];
  avg: number | null;
  median: number | null;
  selectedMonth: string | null;
  effectiveExp: (h: HistoryPoint) => number;
  onMonthClick?: (ym: string) => void;
  homeCurrency?: string;
}) {
  const data = history
    .filter((h) => (h.expensesTotal ?? 0) > 0)
    .map((h) => ({
      ym: h.yearMonth,
      label: shortMonth(h.yearMonth),
      amount: effectiveExp(h),
    }));

  if (data.length === 0) return null;

  const sym = getCurrencySymbol(homeCurrency);

  function CustomTooltip({ active, payload }: { active?: boolean; payload?: { payload: { ym: string; amount: number } }[] }) {
    if (!active || !payload?.length) return null;
    const { ym, amount } = payload[0].payload;
    return (
      <div className="rounded-lg border border-gray-100 bg-white px-3 py-2 shadow-lg text-xs">
        <p className="font-semibold text-gray-800">{monthLabel(ym)}</p>
        <p className="text-gray-600">{formatCurrency(amount, homeCurrency, undefined, true)}</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="mb-0.5 flex items-center justify-between">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">Monthly Spending</p>
        {onMonthClick && (
          <p className="text-[10px] text-gray-300">tap a bar to select month</p>
        )}
      </div>
      {median !== null && (
        <p className="mb-4 text-sm font-medium text-gray-600">
          {data.length}-month median{" "}
          <span className="font-bold text-gray-900">{formatCurrency(median, homeCurrency, undefined, true)} / mo</span>
          {avg !== null && avg !== median && (
            <span className="ml-2 text-xs text-gray-400">(avg {formatCurrency(avg, homeCurrency, undefined, true)})</span>
          )}
        </p>
      )}
      <ResponsiveContainer width="100%" height={140}>
          <BarChart
          data={data}
          barSize={22}
          margin={{ top: 4, right: 4, left: -8, bottom: 0 }}
          style={{ outline: "none" }}
          tabIndex={-1}
        >
          <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="#f3f4f6" />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#9ca3af" }} axisLine={false} tickLine={false} />
          <YAxis width={52} tick={{ fontSize: 10, fill: "#9ca3af" }} axisLine={false} tickLine={false}
            tickFormatter={(v: number) => v >= 1000 ? `${sym}${Math.round(v / 1000)}k` : `${sym}${v}`} />
          <Tooltip content={<CustomTooltip />} cursor={false} />
          {median !== null && (
            <ReferenceLine y={median} stroke="#a78bfa" strokeDasharray="4 3" strokeWidth={1.5}
              label={{ value: "median", position: "right", fontSize: 10, fill: "#a78bfa" }} />
          )}
          <Bar
            dataKey="amount"
            radius={[4, 4, 0, 0]}
            label={false}
            activeBar={false}
            style={onMonthClick ? { cursor: "pointer" } : undefined}
            onClick={(barData) => onMonthClick?.((barData as unknown as { ym: string }).ym)}
          >
            {data.map((entry) => (
              <Cell key={entry.ym} fill={entry.ym === selectedMonth ? "#7c3aed" : "#c4b5fd"} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
