"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getFirebaseClient } from "@/lib/firebase";
import Link from "next/link";
import type { AssetsSummary, AssetAccount } from "@/lib/assetsSummary";
import type { ManualAsset, AssetCategory } from "@/lib/types";
import { formatCurrency } from "@/lib/currencyUtils";
import { formatAccountLast4 } from "@/lib/rangeUtils";

interface AccountsTabProps {
  summary: AssetsSummary;
}

export function AccountsTab({ summary }: AccountsTabProps) {
  const { groups, currency } = summary;
  const router = useRouter();
  const searchParams = useSearchParams();
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [addLabel, setAddLabel] = useState("");
  const [addCategory, setAddCategory] = useState<AssetCategory>("property");
  const [addValue, setAddValue] = useState("");
  const [addLink, setAddLink] = useState("");
  const [addSaving, setAddSaving] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  // Pre-fill when arriving from a mortgage/loan page ("Add asset" there).
  const linkedFromQuery = searchParams.get("link") ?? "";
  useEffect(() => {
    if (searchParams.get("add") === "1" || searchParams.get("link")) {
      setShowAdd(true);
    }
    const cat = searchParams.get("category");
    if (cat && ["property", "vehicle", "retirement", "investment", "business", "other"].includes(cat)) {
      setAddCategory(cat as AssetCategory);
    }
    if (searchParams.get("link")) setAddLink(searchParams.get("link") as string);
  }, [searchParams]);

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
          ...(addLink ? { linkedAccountSlug: addLink } : {}),
        }),
      });
      if (!res.ok) throw new Error("Failed to save");
      const { id } = await res.json();
      if (id) router.push(`/account/assets/${id}`);
      else router.refresh();
    } catch (err) {
      setAddError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setAddSaving(false);
    }
  };


  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium text-gray-900">Accounts and assets</p>
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

      {showAdd && (
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
      )}
      {groups.length === 0 && !showAdd && (
        <div className="border border-gray-200 bg-gray-50 rounded-lg p-8 text-center">
          <p className="text-gray-600">No assets found yet.</p>
          <p className="mt-2 text-sm text-gray-500">Upload statements or add an asset to get started.</p>
        </div>
      )}

      {groups.map((group) => {
        const isExpanded = expandedGroup === group.type;
        const accountCount = group.accounts.length + group.manualAssets.length;

        return (
          <div key={group.type} className="bg-white rounded-lg border border-gray-200">
            {/* Group Header */}
            <button
              onClick={() => setExpandedGroup(isExpanded ? null : group.type)}
              className="w-full px-6 py-4 flex items-center justify-between hover:bg-gray-50 transition-colors"
            >
              <div className="flex items-center gap-3">
                <span className="text-base font-semibold text-gray-900">
                  {group.label}
                </span>
                <span className="text-sm text-gray-500">
                  ({accountCount})
                </span>
              </div>
              <div className="flex items-center gap-4">
                <span className="text-lg font-bold text-gray-900 tabular-nums">
                  {formatCurrency(group.total, currency)}
                </span>
                <svg
                  className={`w-5 h-5 text-gray-400 transition-transform ${
                    isExpanded ? "rotate-180" : ""
                  }`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M19 9l-7 7-7-7"
                  />
                </svg>
              </div>
            </button>

            {/* Expanded Accounts List */}
            {isExpanded && (
              <div className="border-t border-gray-200 p-6 space-y-4">
                {/* Statement Accounts */}
                {group.accounts.map((acc) => (
                  <AccountRow key={acc.slug} account={acc} currency={currency} />
                ))}

                {/* Manual Assets */}
                {group.manualAssets.map((asset) => (
                  <ManualAssetRow key={asset.id} asset={asset} currency={currency} />
                ))}

                {group.accounts.length === 0 && group.manualAssets.length === 0 && (
                  <p className="text-sm text-gray-500 text-center py-4">
                    No accounts in this group yet.
                  </p>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function AccountRow({ account, currency }: { account: AssetAccount; currency: string }) {
  return (
    <Link
      href={`/account/accounts/${account.slug}`}
      className="w-full flex items-start justify-between py-3 border-b border-gray-100 last:border-0 hover:bg-gray-50 transition-colors rounded px-2 -mx-2 text-left"
    >
      <div className="flex-1">
        <div className="flex items-center gap-2 mb-1">
          <span className="font-medium text-gray-900">{account.bankName}</span>
          <span className="text-xs text-gray-400 font-normal">{formatAccountLast4(account.slug)}</span>
          {account.isStale && (
            <span className="px-2 py-0.5 text-xs font-medium bg-amber-100 text-amber-800 rounded">
              Stale
            </span>
          )}
        </div>
        {account.accountName && (
          <p className="text-sm text-gray-600">{account.accountName}</p>
        )}
        <p className="text-xs text-gray-500 mt-1">
          Last statement: {account.statementMonth}
        </p>
      </div>
      <div className="text-right">
        <p className="text-base font-semibold text-gray-900 tabular-nums">
          {formatCurrency(account.balance, currency)}
        </p>
        <p className="text-xs text-gray-500 capitalize">
          {account.accountType.replace("_", " ")}
        </p>
      </div>
    </Link>
  );
}

function ManualAssetRow({ asset, currency }: { asset: ManualAsset; currency: string }) {
  const lastUpdated = new Date(asset.updatedAt);
  const daysOld = Math.floor((Date.now() - lastUpdated.getTime()) / 86400000);

  return (
    <Link
      href={`/account/assets/${asset.id}`}
      className="flex items-start justify-between py-3 border-b border-gray-100 last:border-0 hover:bg-gray-50 transition-colors rounded px-2 -mx-2"
    >
      <div className="flex-1">
        <div className="flex items-center gap-2 mb-1">
          <span className="font-medium text-gray-900">{asset.label}</span>
          <span className="px-2 py-0.5 text-xs font-medium bg-blue-100 text-blue-800 rounded">
            Manual
          </span>
          {asset.linkedAccountSlug && (
            <span className="text-xs text-gray-400">linked</span>
          )}
        </div>
        <p className="text-xs text-gray-500 mt-1">
          Updated {daysOld === 0 ? "today" : `${daysOld} days ago`}
        </p>
      </div>
      <div className="text-right">
        <p className="text-base font-semibold text-gray-900 tabular-nums">
          {formatCurrency(asset.value, currency)}
        </p>
        <p className="text-xs text-gray-500 capitalize">
          {asset.category}
        </p>
      </div>
    </Link>
  );
}