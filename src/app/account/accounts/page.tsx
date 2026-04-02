"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { getFirebaseClient } from "@/lib/firebase";
import type { AccountSnapshot } from "@/lib/extractTransactions";
import { fmt as formatCurrency } from "@/lib/currencyUtils";

type AccountType = "checking" | "savings" | "credit" | "mortgage" | "investment" | "loan" | "other";

const TYPE_LABEL: Record<AccountType, string> = {
  checking: "Checking",
  savings: "Savings",
  credit: "Credit Card",
  mortgage: "Mortgage",
  investment: "Investment",
  loan: "Loan",
  other: "Other",
};

const TYPE_COLOR: Record<AccountType, string> = {
  checking: "bg-blue-100 text-blue-700",
  savings: "bg-green-100 text-green-700",
  credit: "bg-orange-100 text-orange-700",
  mortgage: "bg-red-100 text-red-700",
  investment: "bg-purple-100 text-purple-700",
  loan: "bg-yellow-100 text-yellow-700",
  other: "bg-gray-100 text-gray-600",
};

const TYPE_ORDER: AccountType[] = ["checking", "savings", "investment", "credit", "mortgage", "loan", "other"];

export default function AccountsPage() {
  const router = useRouter();
  const [snapshots, setSnapshots] = useState<AccountSnapshot[]>([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);

  useEffect(() => {
    const { auth } = getFirebaseClient();
    return onAuthStateChanged(auth, async (user) => {
      if (!user) { router.push("/login"); return; }
      setLoading(true); setError(null);
      try {
        const token = await user.getIdToken();
        const res   = await fetch("/api/user/statements/consolidated", {
          headers: { Authorization: `Bearer ${token}` },
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) { setError(json.error ?? "Failed to load"); return; }
        setSnapshots(json.accountSnapshots ?? []);
      } catch {
        setError("Failed to load");
      } finally {
        setLoading(false);
      }
    });
  }, [router]);

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-purple-600 border-t-transparent" />
      </div>
    );
  }

  // Group snapshots by type
  const typeGroups = new Map<AccountType, AccountSnapshot[]>();
  for (const snap of snapshots) {
    const t = (snap.accountType as AccountType) ?? "other";
    if (!typeGroups.has(t)) typeGroups.set(t, []);
    typeGroups.get(t)!.push(snap);
  }

  // Sort within each type group alphabetically, and order the type groups
  const orderedGroups = TYPE_ORDER
    .map((t) => ({ type: t, accounts: (typeGroups.get(t) ?? []).sort((a, b) =>
      (a.accountName ?? a.bankName ?? "").localeCompare(b.accountName ?? b.bankName ?? ""),
    )}))
    .filter((g) => g.accounts.length > 0);

  return (
    <div>
      <div className="mx-auto max-w-6xl px-4 pt-4 pb-8 sm:py-8 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-bold text-3xl text-gray-900">Accounts</h1>
            <p className="mt-1 text-sm text-gray-500">Each account from your uploaded statements.</p>
          </div>
        </div>

        {error && <p className="mt-4 text-red-600">{error}</p>}

        {!error && snapshots.length === 0 && (
          <div className="mt-12 rounded-lg border border-gray-200 bg-white p-12 text-center">
            <p className="text-gray-600">No accounts found yet. Upload a statement to get started.</p>
            <Link href="/upload" className="mt-4 inline-block font-medium text-purple-600 hover:underline">
              Upload a statement
            </Link>
          </div>
        )}

        {orderedGroups.length > 0 && (
          <div className="mt-8 space-y-10">
            {orderedGroups.map(({ type, accounts }) => (
              <section key={type}>
                <h2 className="mb-3 flex items-center gap-2 font-semibold text-gray-700 text-sm uppercase tracking-wide">
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${TYPE_COLOR[type]}`}>
                    {TYPE_LABEL[type]}
                  </span>
                  <span className="text-gray-400">{accounts.length} account{accounts.length !== 1 ? "s" : ""}</span>
                </h2>
                <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {accounts.map((acct) => {
                    const displayName = acct.accountName ?? acct.bankName ?? "Account";
                    const currency    = acct.currency ?? "CAD";
                    return (
                      <li key={acct.slug}>
                        <Link
                          href={`/account/accounts/${acct.slug}`}
                          className="block rounded-xl border border-gray-200 bg-white p-5 shadow-sm transition hover:shadow-md"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="truncate font-semibold text-gray-900">{displayName}</p>
                              <p className="mt-0.5 text-xs text-gray-500">
                                {acct.bankName}
                                {acct.accountId && acct.accountId !== "unknown" && (
                                  <span className="ml-1 text-gray-400">· {acct.accountId}</span>
                                )}
                              </p>
                              <p className="mt-0.5 text-xs text-gray-400">
                                as of {acct.statementMonth}
                              </p>
                            </div>
                            {acct.balance != null && (
                              <p className={`shrink-0 font-bold text-sm ${acct.balance < 0 ? "text-red-600" : "text-gray-900"}`}>
                                {formatCurrency(acct.balance, currency)}
                              </p>
                            )}
                          </div>
                          <p className="mt-3 text-xs text-purple-600 font-medium">View account →</p>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
