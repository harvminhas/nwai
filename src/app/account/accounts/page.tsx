"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { getFirebaseClient } from "@/lib/firebase";
import type { UserStatementSummary } from "@/lib/types";
import { buildAccountSlug } from "@/lib/accountSlug";

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

function accountSlug(s: UserStatementSummary): string {
  return buildAccountSlug(s.bankName, s.accountId);
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

interface AccountGroup {
  slug: string;
  bankName: string;
  accountId: string;
  accountName: string;
  accountType: AccountType;
  statements: UserStatementSummary[];
  latestNetWorth?: number;
}

export default function AccountsPage() {
  const router = useRouter();
  const [statements, setStatements] = useState<UserStatementSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const { auth } = getFirebaseClient();
    return onAuthStateChanged(auth, async (user) => {
      if (!user) { router.push("/login"); return; }
      setLoading(true); setError(null);
      try {
        const token = await user.getIdToken();
        const res = await fetch("/api/user/statements", {
          headers: { Authorization: `Bearer ${token}` },
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) { setError(json.error || "Failed to load"); return; }
        setStatements(json.statements ?? []);
      } catch { setError("Failed to load"); }
      finally { setLoading(false); }
    });
  }, [router]);

  const accounts = useMemo<AccountGroup[]>(() => {
    const map = new Map<string, AccountGroup>();
    for (const s of statements) {
      if (s.status !== "completed") continue;
      const slug = accountSlug(s);
      if (!map.has(slug)) {
        map.set(slug, {
          slug,
          bankName: s.bankName ?? "Unknown Bank",
          accountId: s.accountId ?? "",
          accountName: s.accountName ?? s.bankName ?? "Account",
          accountType: (s.accountType as AccountType) ?? "other",
          statements: [],
          latestNetWorth: undefined,
        });
      }
      const group = map.get(slug)!;
      group.statements.push(s);
      // Keep latest net worth — only from statements that carry a real balance
      if (s.netWorth != null) {
        const date = s.statementDate ?? s.uploadedAt;
        // Compare only against other balance-bearing statements (not CSV imports)
        const prevDate = group.statements
          .filter((x) => x !== s && x.netWorth != null)
          .map((x) => x.statementDate ?? x.uploadedAt)
          .sort()
          .reverse()[0] ?? "";
        if (!prevDate || date >= prevDate) {
          group.latestNetWorth = s.netWorth;
        }
      }
    }
    // Sort: savings & checking first, then credit, then others
    const typeOrder: AccountType[] = ["checking", "savings", "investment", "credit", "mortgage", "loan", "other"];
    return Array.from(map.values()).sort((a, b) => {
      const ta = typeOrder.indexOf(a.accountType);
      const tb = typeOrder.indexOf(b.accountType);
      if (ta !== tb) return ta - tb;
      return a.accountName.localeCompare(b.accountName);
    });
  }, [statements]);

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-purple-600 border-t-transparent" />
      </div>
    );
  }

  // Group accounts by type for sections
  const typeGroups = new Map<AccountType, AccountGroup[]>();
  for (const a of accounts) {
    const t = a.accountType;
    if (!typeGroups.has(t)) typeGroups.set(t, []);
    typeGroups.get(t)!.push(a);
  }

  return (
    <div>
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-bold text-3xl text-gray-900">Accounts</h1>
            <p className="mt-1 text-sm text-gray-500">Each account from your uploaded statements.</p>
          </div>
        </div>

        {error && <p className="mt-4 text-red-600">{error}</p>}

        {!error && accounts.length === 0 && (
          <div className="mt-12 rounded-lg border border-gray-200 bg-white p-12 text-center">
            <p className="text-gray-600">No accounts found yet. Upload a statement to get started.</p>
            <Link href="/upload" className="mt-4 inline-block font-medium text-purple-600 hover:underline">
              Upload a statement
            </Link>
          </div>
        )}

        {accounts.length > 0 && (
          <div className="mt-8 space-y-10">
            {Array.from(typeGroups.entries()).map(([type, group]) => (
              <section key={type}>
                <h2 className="mb-3 flex items-center gap-2 font-semibold text-gray-700 text-sm uppercase tracking-wide">
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${TYPE_COLOR[type]}`}>
                    {TYPE_LABEL[type]}
                  </span>
                  <span className="text-gray-400">{group.length} account{group.length !== 1 ? "s" : ""}</span>
                </h2>
                <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {group.map((acct) => (
                    <li key={acct.slug}>
                      <Link
                        href={`/account/accounts/${acct.slug}`}
                        className="block rounded-xl border border-gray-200 bg-white p-5 shadow-sm transition hover:shadow-md"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate font-semibold text-gray-900">{acct.accountName}</p>
                            <p className="mt-0.5 text-xs text-gray-500">
                              {acct.bankName}
                              {acct.accountId && acct.accountId !== "unknown" && (
                                <span className="ml-1 text-gray-400">· {acct.accountId}</span>
                              )}
                            </p>
                            <p className="mt-0.5 text-xs text-gray-400">
                              {acct.statements.length} statement{acct.statements.length !== 1 ? "s" : ""}
                            </p>
                          </div>
                          {acct.latestNetWorth != null && (
                            <p className={`shrink-0 font-bold text-sm ${acct.latestNetWorth < 0 ? "text-red-600" : "text-gray-900"}`}>
                              {formatCurrency(acct.latestNetWorth)}
                            </p>
                          )}
                        </div>
                        <p className="mt-3 text-xs text-purple-600 font-medium">View account →</p>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
