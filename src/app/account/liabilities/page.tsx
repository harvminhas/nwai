"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { getFirebaseClient } from "@/lib/firebase";
import type { UserStatementSummary } from "@/lib/types";

const TYPE_LABEL: Record<string, string> = {
  credit: "Credit Card",
  mortgage: "Mortgage",
  loan: "Loan",
  other: "Other",
};

const TYPE_COLOR: Record<string, string> = {
  credit: "bg-orange-50 text-orange-700",
  mortgage: "bg-red-50 text-red-700",
  loan: "bg-yellow-50 text-yellow-700",
  other: "bg-gray-100 text-gray-600",
};

function fmt(v: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD",
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(v);
}

function accountSlug(s: UserStatementSummary) {
  const bank = (s.bankName ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const acct = (s.accountId ?? "unknown").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return acct !== "unknown" ? `${bank}-${acct}` : bank;
}

interface LiabilityAccount {
  slug: string;
  bankName: string;
  accountName: string;
  accountType: string;
  balance: number;
  statementDate?: string;
}

export default function LiabilitiesPage() {
  const router = useRouter();
  const [liabilities, setLiabilities] = useState<LiabilityAccount[]>([]);
  const [yearMonth, setYearMonth] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const { auth } = getFirebaseClient();
    return onAuthStateChanged(auth, async (user) => {
      if (!user) { router.push("/account/login"); return; }
      setLoading(true); setError(null);
      try {
        const token = await user.getIdToken();
        const [sRes, cRes] = await Promise.all([
          fetch("/api/user/statements", { headers: { Authorization: `Bearer ${token}` } }),
          fetch("/api/user/statements/consolidated", { headers: { Authorization: `Bearer ${token}` } }),
        ]);
        const sJson = await sRes.json().catch(() => ({}));
        const cJson = cRes.ok ? await cRes.json().catch(() => ({})) : {};
        setYearMonth(cJson.yearMonth ?? null);

        const stmts: UserStatementSummary[] = (sJson.statements ?? []).filter(
          (s: UserStatementSummary) => s.status === "completed" && !s.superseded
        );

        // Latest per account slug
        const latestBySlug = new Map<string, UserStatementSummary>();
        for (const s of stmts) {
          const slug = accountSlug(s);
          const existing = latestBySlug.get(slug);
          if (!existing || (s.statementDate ?? s.uploadedAt) > (existing.statementDate ?? existing.uploadedAt)) {
            latestBySlug.set(slug, s);
          }
        }

        // Filter to liability types or negative balance
        const DEBT_TYPES = new Set(["credit", "mortgage", "loan"]);
        const liabs: LiabilityAccount[] = Array.from(latestBySlug.values())
          .filter((s) => DEBT_TYPES.has(s.accountType ?? "") || (s.netWorth ?? 0) < 0)
          .map((s) => ({
            slug: accountSlug(s),
            bankName: s.bankName ?? "Unknown",
            accountName: s.accountName ?? s.bankName ?? "Account",
            accountType: s.accountType ?? "other",
            balance: Math.abs(s.netWorth ?? 0),
            statementDate: s.statementDate,
          }))
          .sort((a, b) => b.balance - a.balance);

        setLiabilities(liabs);
      } catch { setError("Failed to load liabilities"); }
      finally { setLoading(false); }
    });
  }, [router]);

  const total = liabilities.reduce((s, l) => s + l.balance, 0);

  const monthStr = yearMonth
    ? new Date(parseInt(yearMonth.slice(0, 4)), parseInt(yearMonth.slice(5, 7)) - 1, 1)
        .toLocaleDateString("en-US", { month: "short", year: "numeric" })
    : null;

  // Group by type
  const byType = new Map<string, LiabilityAccount[]>();
  for (const l of liabilities) {
    const t = l.accountType;
    if (!byType.has(t)) byType.set(t, []);
    byType.get(t)!.push(l);
  }
  const typeOrder = ["mortgage", "loan", "credit", "other"];

  if (loading) return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <div className="h-10 w-10 animate-spin rounded-full border-4 border-purple-600 border-t-transparent" />
    </div>
  );

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="font-bold text-3xl text-gray-900">Liabilities</h1>
        <p className="mt-0.5 text-sm text-gray-400">
          {total > 0 && <>{fmt(total)} total</>}
          {monthStr && <> · {monthStr}</>}
        </p>
      </div>

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      {!error && liabilities.length === 0 && (
        <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 p-12 text-center">
          <p className="text-sm text-gray-500">No liabilities detected.</p>
          <p className="mt-1 text-xs text-gray-400">
            Upload a mortgage, loan, or credit card statement to see it here.
          </p>
          <Link href="/upload" className="mt-4 inline-block text-sm font-medium text-purple-600 hover:underline">
            Upload a statement →
          </Link>
        </div>
      )}

      {liabilities.length > 0 && (
        <div className="space-y-6">
          {/* Total bar */}
          <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Total Owed</p>
            <p className="mt-2 font-bold text-3xl text-gray-900">{fmt(total)}</p>
            {/* Balance bars */}
            <div className="mt-4 space-y-2">
              {liabilities.map((l) => (
                <div key={l.slug}>
                  <div className="flex items-center justify-between text-xs text-gray-500 mb-0.5">
                    <span>{l.accountName}</span>
                    <span className="tabular-nums">{fmt(l.balance)} · {total > 0 ? Math.round((l.balance / total) * 100) : 0}%</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-gray-100">
                    <div
                      className={`h-full rounded-full ${l.accountType === "mortgage" ? "bg-red-400" : l.accountType === "loan" ? "bg-yellow-400" : "bg-orange-400"}`}
                      style={{ width: `${total > 0 ? Math.min((l.balance / total) * 100, 100) : 0}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* By type */}
          {typeOrder.filter((t) => byType.has(t)).map((type) => {
            const group = byType.get(type)!;
            const typeTotal = group.reduce((s, l) => s + l.balance, 0);
            return (
              <div key={type}>
                <div className="mb-2 flex items-center gap-2">
                  <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">
                    {TYPE_LABEL[type] ?? type}
                  </p>
                  <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${TYPE_COLOR[type] ?? "bg-gray-100 text-gray-600"}`}>
                    {fmt(typeTotal)}
                  </span>
                </div>
                <div className="divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white shadow-sm">
                  {group.map((l) => (
                    <div key={l.slug} className="flex items-center justify-between px-5 py-4">
                      <div>
                        <p className="font-medium text-sm text-gray-800">
                          {l.accountName} — {l.bankName}
                        </p>
                        {l.statementDate && (
                          <p className="text-xs text-gray-400">
                            as of {new Date(l.statementDate + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                          </p>
                        )}
                      </div>
                      <p className="font-semibold text-sm text-gray-900 tabular-nums">{fmt(l.balance)}</p>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
