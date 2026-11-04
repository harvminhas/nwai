"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { getFirebaseClient } from "@/lib/firebase";
import type { AssetsSummary } from "@/lib/assetsSummary";
import type { ManualAsset } from "@/lib/types";
import { formatCurrency } from "@/lib/currencyUtils";
import { formatAccountLast4 } from "@/lib/rangeUtils";
import AccountSwitcher from "@/components/AccountSwitcher";

interface AccountRow {
  slug: string;
  bankName: string;
  accountName?: string;
  accountType: string;
  balance: number;
  statementMonth: string;
  isStale: boolean;
}

export default function AssetCategoryPage() {
  const router = useRouter();
  const params = useParams<{ type: string }>();
  const type = params.type;

  const [summary, setSummary] = useState<AssetsSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const { auth } = getFirebaseClient();
    return onAuthStateChanged(auth, async (user) => {
      if (!user) { router.push("/login"); return; }
      const token = await user.getIdToken();
      const res = await fetch("/api/user/assets-summary", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) setSummary(await res.json());
      setLoading(false);
    });
  }, [router]);

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-purple-600 border-t-transparent" />
      </div>
    );
  }

  const group = summary?.groups?.find((g) => g.type === type) ?? null;
  const currency = summary?.currency ?? "USD";
  const total = summary?.totalAssets ?? 0;

  if (!group) {
    return (
      <div className="mx-auto max-w-3xl px-4 pt-4 pb-8 sm:py-8 sm:px-6">
        <Link href="/account/assets" className="text-sm text-gray-500 hover:text-purple-600">Assets</Link>
        <p className="mt-3 text-gray-600">That category has nothing in it.</p>
      </div>
    );
  }

  const accounts = group.accounts as unknown as AccountRow[];
  const manualAssets: ManualAsset[] = group.manualAssets ?? [];
  const pct = total > 0 ? (group.total / total) * 100 : 0;

  return (
    <div className="mx-auto max-w-3xl px-4 pt-4 pb-8 sm:py-8 sm:px-6">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <Link href="/account/assets" className="hover:text-purple-600">Assets</Link>
          <span>/</span>
          <span className="font-medium text-gray-700">{group.label}</span>
        </div>
        <AccountSwitcher />
      </div>

      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{group.label}</h1>
          <p className="mt-1 text-sm text-gray-500">
            {accounts.length + manualAssets.length} {accounts.length + manualAssets.length === 1 ? "account" : "accounts"}, {pct.toFixed(0)}% of your assets
          </p>
        </div>
        <p className="text-2xl font-bold tabular-nums text-gray-900">{formatCurrency(group.total, currency)}</p>
      </div>

      <div className="mt-5 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        {accounts.map((acc) => (
          <Link
            key={acc.slug}
            href={`/account/accounts/${acc.slug}`}
            className="flex items-center gap-3 border-b border-gray-100 px-5 py-3.5 last:border-0 hover:bg-gray-50"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-medium text-gray-900">{acc.bankName}</span>
                <span className="shrink-0 text-xs text-gray-400">{formatAccountLast4(acc.slug)}</span>
                {acc.isStale && (
                  <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">Stale</span>
                )}
              </div>
              <p className="mt-0.5 truncate text-xs text-gray-500">
                {acc.accountName ? `${acc.accountName} · ` : ""}Last statement {acc.statementMonth}
              </p>
            </div>
            <div className="shrink-0 text-right">
              <p className="text-sm font-semibold tabular-nums text-gray-900">{formatCurrency(acc.balance, currency)}</p>
              <p className="text-[11px] capitalize text-gray-400">{acc.accountType.replace("_", " ")}</p>
            </div>
          </Link>
        ))}

        {manualAssets.map((asset) => (
          <Link
            key={asset.id}
            href={`/account/assets/${asset.id}`}
            className="flex items-center gap-3 border-b border-gray-100 px-5 py-3.5 last:border-0 hover:bg-gray-50"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-medium text-gray-900">{asset.label}</span>
                <span className="shrink-0 rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-blue-700">Manual</span>
              </div>
              <p className="mt-0.5 text-xs text-gray-500">
                {asset.linkedAccountSlug ? "Linked to a loan" : "Updated " + new Date(asset.updatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
              </p>
            </div>
            <div className="shrink-0 text-right">
              <p className="text-sm font-semibold tabular-nums text-gray-900">{formatCurrency(asset.value, currency)}</p>
              <p className="text-[11px] capitalize text-gray-400">{asset.category}</p>
            </div>
          </Link>
        ))}

        {accounts.length === 0 && manualAssets.length === 0 && (
          <p className="px-5 py-8 text-center text-sm text-gray-500">Nothing in this category yet.</p>
        )}
      </div>
    </div>
  );
}