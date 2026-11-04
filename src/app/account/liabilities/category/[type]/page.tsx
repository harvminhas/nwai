"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { getFirebaseClient } from "@/lib/firebase";
import type { DebtsSummary } from "@/lib/debtsSummary";
import { formatCurrency } from "@/lib/currencyUtils";
import { formatAccountLast4 } from "@/lib/rangeUtils";
import type { DebtAccount } from "@/lib/debtsSummary";
import AccountSwitcher from "@/components/AccountSwitcher";

function formatMonth(ym: string | null): string {
  if (!ym) return "";
  const [y, m] = ym.split("-");
  if (!m) return ym;
  return new Date(parseInt(y, 10), parseInt(m, 10) - 1, 1)
    .toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

export default function LiabilityCategoryPage() {
  const router = useRouter();
  const params = useParams<{ type: string }>();
  const type = params.type;

  const [summary, setSummary] = useState<DebtsSummary | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (token: string) => {
    const res = await fetch("/api/user/debts-summary", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) setSummary(await res.json());
  }, []);

  useEffect(() => {
    const { auth } = getFirebaseClient();
    return onAuthStateChanged(auth, async (user) => {
      if (!user) { router.push("/login"); return; }
      const token = await user.getIdToken();
      await load(token);
      setLoading(false);
    });
  }, [router, load]);

  const [statusUpdating, setStatusUpdating] = useState<string | null>(null);
  const handleStatusChange = async (accountSlug: string, status: "open" | "paid_off" | "closed") => {
    setStatusUpdating(accountSlug);
    try {
      const { auth } = getFirebaseClient();
      const user = auth.currentUser;
      if (!user) return;
      const token = await user.getIdToken();
      const statusDate = new Date().toISOString().split("T")[0];
      const res = await fetch("/api/user/account-status", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ accountSlug, status, statusDate }),
      });
      if (!res.ok) throw new Error("Failed to update account status");
      await load(token);
    } catch (err) {
      console.error("Failed to update account status:", err);
      alert("Failed to update account status. Please try again.");
    } finally {
      setStatusUpdating(null);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-purple-600 border-t-transparent" />
      </div>
    );
  }

  const group = summary?.groups?.find((g) => g.type === type) ?? null;
  const currency = summary?.currency ?? "USD";
  const totalDebt = summary?.totalDebt ?? 0;

  if (!group) {
    return (
      <div className="mx-auto max-w-3xl px-4 pt-4 pb-8 sm:py-8 sm:px-6">
        <Link href="/account/liabilities" className="text-sm text-gray-500 hover:text-purple-600">Liabilities</Link>
        <p className="mt-3 text-gray-600">That category has nothing in it.</p>
      </div>
    );
  }

  const abs = Math.abs(group.totalBalance);
  const pct = totalDebt > 0 ? (abs / totalDebt) * 100 : 0;

  return (
    <div className="mx-auto max-w-3xl px-4 pt-4 pb-8 sm:py-8 sm:px-6">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <Link href="/account/liabilities" className="hover:text-purple-600">Liabilities</Link>
          <span>/</span>
          <span className="font-medium text-gray-700">{group.label}</span>
        </div>
        <AccountSwitcher />
      </div>

      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{group.label}</h1>
          <p className="mt-1 text-sm text-gray-500">
            {group.accounts.length + group.manualLiabilities.length} owe, {pct.toFixed(0)}% of your debt
          </p>
        </div>
        <p className="text-2xl font-bold tabular-nums text-gray-900">{formatCurrency(abs, currency)}</p>
      </div>

      <div className="mt-5 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        {group.accounts.map((acc) => {
          const payoff = summary?.payoffEstimates?.find((e) => e.accountSlug === acc.slug);
          return (
            <AccountRow
              key={acc.slug}
              account={acc}
              currency={currency}
              payoffDate={payoff?.payoffDate ?? null}
              isUpdating={statusUpdating === acc.slug}
              onStatusChange={(status) => handleStatusChange(acc.slug, status)}
            />
          );
        })}

        {group.manualLiabilities.map((liability) => (
          <div
            key={liability.id}
            className="flex items-center gap-3 border-b border-gray-100 px-5 py-3.5 last:border-0"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-medium text-gray-900">{liability.label}</span>
                <span className="shrink-0 rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-blue-700">Manual</span>
              </div>
              <p className="mt-0.5 text-xs text-gray-500">
                {liability.interestRate !== undefined ? `${liability.interestRate.toFixed(2)}% APR` : "No rate set"}
              </p>
            </div>
            <p className="shrink-0 text-sm font-semibold tabular-nums text-gray-900">
              {formatCurrency(Math.abs(liability.balance), currency)}
            </p>
          </div>
        ))}

        {group.accounts.length === 0 && group.manualLiabilities.length === 0 && (
          <p className="px-5 py-8 text-center text-sm text-gray-500">Nothing in this category yet.</p>
        )}
      </div>
    </div>
  );
}
function AccountRow({
  account,
  currency,
  payoffDate,
  isUpdating,
  onStatusChange,
}: {
  account: DebtAccount;
  currency: string;
  payoffDate: string | null;
  isUpdating: boolean;
  onStatusChange: (status: "open" | "paid_off" | "closed") => void;
}) {
  const [showMenu, setShowMenu] = useState(false);

  return (
    <div className="relative flex items-center border-b border-gray-100 last:border-0 hover:bg-gray-50">
      <Link
        href={`/account/accounts/${account.slug}`}
        className={`flex min-w-0 flex-1 items-center gap-3 px-5 py-3.5 ${isUpdating ? "pointer-events-none opacity-60" : ""}`}
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium text-gray-900">{account.bankName}</span>
            <span className="shrink-0 text-xs text-gray-400">{formatAccountLast4(account.slug)}</span>
          </div>
          <div className="mt-0.5 flex flex-wrap gap-3 text-xs text-gray-500">
            {account.accountName && <span className="truncate">{account.accountName}</span>}
            {account.interestRate !== null && <span>{account.interestRate.toFixed(2)}% APR</span>}
            {payoffDate && <span className="text-green-600">Payoff {formatMonth(payoffDate)}</span>}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-sm font-semibold tabular-nums text-gray-900">{formatCurrency(Math.abs(account.balance), currency)}</p>
          <p className="text-[11px] capitalize text-gray-400">{account.accountType.replace("_", " ")}</p>
        </div>
      </Link>
      <div className="shrink-0 pr-3">
        <button
          onClick={() => setShowMenu((v) => !v)}
          disabled={isUpdating}
          className="rounded p-1 text-gray-400 transition-colors hover:bg-gray-200 hover:text-gray-600"
          aria-label="Change account status"
        >
          {isUpdating ? (
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-gray-600" />
          ) : (
            <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
              <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z" />
            </svg>
          )}
        </button>
      </div>
      {showMenu && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setShowMenu(false)} />
          <div className="absolute right-3 top-11 z-20 w-44 rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
            {([
              ["paid_off", "Mark as Paid Off"],
              ["closed", "Mark as Closed"],
              ["open", "Reopen"],
            ] as const).map(([status, label]) => (
              <button
                key={status}
                onClick={() => { setShowMenu(false); onStatusChange(status); }}
                className="w-full px-4 py-2 text-left text-sm text-gray-700 transition-colors hover:bg-gray-100"
              >
                {label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
