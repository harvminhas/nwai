"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import type { AssetsSummary, AssetAccount } from "@/lib/assetsSummary";
import type { ManualAsset, AssetCategory } from "@/lib/types";
import { formatAccountLast4 } from "@/lib/rangeUtils";
import { getFirebaseClient } from "@/lib/firebase";
import { formatLastTransactionDate } from "@/lib/formatLastTransactionDate";
import { triggerProfileRefetch } from "@/lib/profileRefetch";
import { isCategoryGroupOpen, toggleCategoryGroup } from "@/lib/categoryGroupExpand";
import { accountDisplayLabel, joinAccountMeta } from "@/lib/accountListLabel";
import {
  AccountCategoryList,
  AccountCategorySection,
  AccountCategoryItem,
} from "@/app/account/components/AccountCategoryList";

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
  const { groups, currency } = summary;
  const router = useRouter();
  const searchParams = useSearchParams();
  const [userGroupOpen, setUserGroupOpen] = useState<Record<string, boolean>>({});
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
    setUserGroupOpen((prev) => toggleCategoryGroup(prev, type));

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
      <AccountCategoryList>
      {ordered.map((group) => {
        const isOpen = isCategoryGroupOpen(userGroupOpen, group.type);
        const count = group.accounts.length + group.manualAssets.length;

        return (
          <AccountCategorySection
            key={group.type}
            groupType={group.type}
            label={group.label}
            count={count}
            total={group.total}
            currency={currency}
            isOpen={isOpen}
            onToggle={() => toggle(group.type)}
          >
            {group.accounts.map((acc) => (
              <AccountLine key={acc.slug} account={acc} currency={currency} />
            ))}
            {group.manualAssets.map((asset) => (
              <ManualLine key={asset.id} asset={asset} currency={currency} />
            ))}
          </AccountCategorySection>
        );
      })}
      </AccountCategoryList>
    </div>
  );
}

function AccountLine({ account, currency }: { account: AssetAccount; currency: string }) {
  const label = accountDisplayLabel(account.bankName, account.accountName);
  const meta = joinAccountMeta([
    label.secondary,
    formatAccountLast4(account.slug),
    formatLastTransactionDate(account.lastTransactionDate),
  ]);
  return (
    <AccountCategoryItem
      href={`/account/accounts/${account.slug}`}
      primary={label.primary}
      meta={meta}
      fullName={label.full}
      amount={account.balance}
      currency={currency}
    />
  );
}

function ManualLine({ asset, currency }: { asset: ManualAsset; currency: string }) {
  return (
    <AccountCategoryItem
      href={`/account/assets/${asset.id}`}
      primary={asset.label}
      meta="Manual"
      fullName={asset.label}
      amount={asset.value}
      currency={currency}
    />
  );
}
