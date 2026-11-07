"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import type { AssetsSummary, AssetAccount } from "@/lib/assetsSummary";
import type { ManualAsset, AssetCategory } from "@/lib/types";
import { formatCurrency } from "@/lib/currencyUtils";
import { formatAccountLast4 } from "@/lib/rangeUtils";
import { getFirebaseClient } from "@/lib/firebase";
import { formatLastTransactionDate } from "@/lib/formatLastTransactionDate";
import { CategoryListRow } from "@/app/account/spending/CategoryListRow";
import { triggerProfileRefetch } from "@/lib/profileRefetch";

const GROUP_COLOR: Record<string, string> = {
  cash: "bg-blue-500",
  investments: "bg-purple-500",
  registered: "bg-teal-500",
  property: "bg-amber-500",
  other: "bg-gray-400",
};

interface CategoriesTabProps {
  summary: AssetsSummary;
}

/**
 * Top level of the Assets drill-down, mirroring Spending:
 *   categories -> /account/assets/category/[type] -> /account/accounts/[slug]
 *
 * Clicking a row expands it in place; clicking the name opens the category page.
 */
export function CategoriesTab({ summary }: CategoriesTabProps) {
  const { groups, currency, totalAssets } = summary;
  const router = useRouter();
  const searchParams = useSearchParams();
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const [showAdd, setShowAdd] = useState(false);
  const [addLabel, setAddLabel] = useState("");
  const [addCategory, setAddCategory] = useState<AssetCategory>("property");
  const [addValue, setAddValue] = useState("");
  const [addLink, setAddLink] = useState("");
  const [addStartDate, setAddStartDate] = useState("");
  const [addSaving, setAddSaving] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  // Pre-fill when arriving from a mortgage/loan page ("Add asset" there).
  const linkedFromQuery = searchParams.get("link") ?? "";
  useEffect(() => {
    if (searchParams.get("add") === "1" || searchParams.get("link")) {
      setShowAdd(true);
      setAddStartDate(new Date().toISOString().slice(0, 10)); // Default today
    }
    const cat = searchParams.get("category");
    if (cat && ["property", "vehicle", "retirement", "investment", "business", "other"].includes(cat)) {
      setAddCategory(cat as AssetCategory);
    }
    if (searchParams.get("link")) setAddLink(searchParams.get("link") as string);
  }, [searchParams]);

  const toggle = (type: string) =>
    setOpenGroups((prev) => ({ ...prev, [type]: !prev[type] }));

  const submitAdd = async () => {
    const num = Number(addValue.replace(/[^0-9.-]/g, ""));
    if (!addLabel.trim() || Number.isNaN(num) || num <= 0) {
      setAddError("Add a name and a value.");
      return;
    }
    setAddSaving(true);
    setAddError(null);
    try {
      const { auth } = getFirebaseClient();
      const user = auth.currentUser;
      if (!user) throw new Error("Signed out");
      const token = await user.getIdToken();
      const res = await fetch("/api/user/assets", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          label: addLabel.trim(),
          category: addCategory,
          value: num,
          startDate: addStartDate || undefined,
          ...(addLink ? { linkedAccountSlug: addLink } : {}),
        }),
      });
      if (!res.ok) throw new Error("Failed to save");
      const { id } = await res.json();
      // Server invalidated cache; trigger refetch so header/detail update
      triggerProfileRefetch();
      if (id) router.push(`/account/assets/${id}`);
      else router.refresh();
    } catch (err) {
      setAddError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setAddSaving(false);
    }
  };

  const ordered = [...groups].sort((a, b) => b.total - a.total);

  const addPanel = showAdd ? (
    <div className="rounded-xl border border-purple-200 bg-purple-50/40 p-5">
      <p className="text-sm font-semibold text-gray-900">New asset</p>
      <p className="mt-0.5 text-xs text-gray-500">
        A house, a car, anything you own that belongs in your net worth.
      </p>
      <div className="mt-4 space-y-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-500">Name</label>
          <input
            value={addLabel}
            onChange={(e) => setAddLabel(e.target.value)}
            placeholder="e.g. House"
            className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:border-purple-400 focus:outline-none"
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">Type</label>
            <select
              value={addCategory}
              onChange={(e) => setAddCategory(e.target.value as AssetCategory)}
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:border-purple-400 focus:outline-none"
            >
              {(["property", "vehicle", "retirement", "investment", "business", "other"] as AssetCategory[]).map((c) => (
                <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">Value ({currency})</label>
            <input
              value={addValue}
              onChange={(e) => setAddValue(e.target.value)}
              inputMode="decimal"
              placeholder="0"
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm tabular-nums focus:border-purple-400 focus:outline-none"
            />
          </div>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-500">Start Date</label>
          <input
            type="date"
            value={addStartDate}
            onChange={(e) => setAddStartDate(e.target.value)}
            className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:border-purple-400 focus:outline-none"
          />
          <p className="text-xs text-gray-500 mt-1">Asset included from this month onward</p>
        </div>
        {linkedFromQuery ? (
          <p className="text-xs text-gray-500">
            This asset will be linked to the loan you came from, so its equity shows on both pages.
          </p>
        ) : null}
        {addError && <p className="text-xs text-red-600">{addError}</p>}
        <div className="flex justify-end">
          <button
            onClick={submitAdd}
            disabled={addSaving}
            className="rounded-lg bg-purple-600 px-4 py-2 text-sm font-semibold text-white hover:bg-purple-700 disabled:opacity-40 transition"
          >
            {addSaving ? "Saving..." : "Add asset"}
          </button>
        </div>
      </div>
    </div>
  ) : null;

  if (groups.length === 0) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-end">
          <button
            onClick={() => setShowAdd((v) => !v)}
            className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
              showAdd
                ? "border-purple-300 bg-purple-50 text-purple-700 hover:bg-purple-100"
                : "border-gray-200 text-gray-600 hover:border-purple-300 hover:bg-purple-50 hover:text-purple-700"
            }`}
          >
            {showAdd ? "Cancel" : "+ Add asset"}
          </button>
        </div>
        {addPanel}
        {!showAdd && (
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-8 text-center">
            <p className="font-medium text-gray-900">No assets yet</p>
            <p className="mt-1 text-sm text-gray-500">
              Upload a statement so your accounts appear here, or add a manual asset.
            </p>
            <Link
              href="/upload"
              className="mt-4 inline-block rounded-lg bg-purple-600 px-4 py-2 text-sm font-semibold text-white hover:bg-purple-700 transition"
            >
              Upload a statement
            </Link>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end">
        <button
          onClick={() => setShowAdd((v) => !v)}
          className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
            showAdd
              ? "border-purple-300 bg-purple-50 text-purple-700 hover:bg-purple-100"
              : "border-gray-200 text-gray-600 hover:border-purple-300 hover:bg-purple-50 hover:text-purple-700"
          }`}
        >
          {showAdd ? "Cancel" : "+ Add asset"}
        </button>
      </div>
      {addPanel}
      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      {ordered.map((group) => {
        const isOpen = !!openGroups[group.type];
        const count = group.accounts.length + group.manualAssets.length;
        const pct = totalAssets > 0 ? (group.total / totalAssets) * 100 : 0;

        return (
          <div key={group.type} className="border-b border-gray-100 last:border-0">
            <CategoryListRow
              isOpen={isOpen}
              onToggle={() => toggle(group.type)}
              rowContent={
                <div className="flex flex-1 items-center gap-3 py-4 pl-5 pr-2">
                  <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${GROUP_COLOR[group.type] ?? "bg-gray-300"}`} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <p className="text-sm font-semibold text-gray-900">
                        {group.label}
                      </p>
                      <span className="text-xs text-gray-400">
                        {count} {count === 1 ? "account" : "accounts"}
                      </span>
                    </div>
                    <div className="mt-1.5 flex items-center gap-2">
                      <div className="h-1.5 w-full max-w-[180px] overflow-hidden rounded-full bg-gray-100">
                        <div className={`h-full rounded-full ${GROUP_COLOR[group.type] ?? "bg-gray-300"}`} style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-[11px] tabular-nums text-gray-400">{pct.toFixed(0)}%</span>
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-sm font-semibold tabular-nums text-gray-900">
                      {formatCurrency(group.total, currency)}
                    </p>
                  </div>
                </div>
              }
            >
              <div className="border-t border-gray-100 bg-gray-50/60 px-5 py-2">
                {group.accounts.map((acc) => (
                  <AccountLine key={acc.slug} account={acc} currency={currency} />
                ))}
                {group.manualAssets.map((asset) => (
                  <ManualLine key={asset.id} asset={asset} currency={currency} />
                ))}
              </div>
            </CategoryListRow>
          </div>
        );
      })}
      </div>
    </div>
  );
}

function AccountLine({ account, currency }: { account: AssetAccount; currency: string }) {
  const lastTxDate = formatLastTransactionDate(account.lastTransactionDate);
  return (
    <Link
      href={`/account/accounts/${account.slug}`}
      className="flex items-center gap-3 border-b border-gray-100 py-2 last:border-0 hover:text-purple-600"
    >
      <span className="min-w-0 flex-1 truncate text-sm text-gray-700">
        <span className="block">
          {account.bankName}
          {account.accountName ? ` · ${account.accountName}` : ""}
        </span>
        {lastTxDate && (
          <span className="block text-xs text-gray-400 mt-0.5">{lastTxDate}</span>
        )}
      </span>
      <span className="shrink-0 text-xs tabular-nums text-gray-500">{formatAccountLast4(account.slug)}</span>
      <span className="w-28 shrink-0 text-right text-sm tabular-nums text-gray-900">
        {formatCurrency(account.balance, currency)}
      </span>
    </Link>
  );
}

function ManualLine({ asset, currency }: { asset: ManualAsset; currency: string }) {
  return (
    <Link
      href={`/account/assets/${asset.id}`}
      className="flex items-center gap-3 border-b border-gray-100 py-2 last:border-0 hover:text-purple-600"
    >
      <span className="min-w-0 flex-1 truncate text-sm text-gray-700">{asset.label}</span>
      <span className="shrink-0 rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-blue-700">Manual</span>
      <span className="w-28 shrink-0 text-right text-sm tabular-nums text-gray-900">
        {formatCurrency(asset.value, currency)}
      </span>
    </Link>
  );
}
