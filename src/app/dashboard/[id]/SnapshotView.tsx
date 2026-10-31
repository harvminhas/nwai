"use client";

import { fmt } from "@/lib/currencyUtils";
import type { StatementSnapshot } from "@/lib/statementSnapshot";

// ── Helpers ───────────────────────────────────────────────────────────────────

function UnavailableCard({ label, reason }: { label: string; reason: string }) {
  return (
    <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 p-5 flex flex-col gap-1">
      <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">{label}</p>
      <p className="mt-1 text-sm text-gray-400 italic leading-snug">{reason}</p>
    </div>
  );
}

function StatTile({
  label, value, sub, color = "text-gray-900", children,
}: {
  label: string; value: string; sub?: string; color?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl bg-white border border-gray-100 shadow-sm p-5 flex flex-col gap-1">
      <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">{label}</p>
      <p className={`text-2xl font-bold tabular-nums ${color}`}>{value}</p>
      {sub && <p className="text-xs text-gray-400">{sub}</p>}
      {children}
    </div>
  );
}

// ── Bucket bar (Fixed/Essentials/Flexible) ────────────────────────────────────

const BUCKET_COLORS: Record<string, string> = {
  fixed:       "bg-purple-600",
  essentials:  "bg-blue-500",
  flexible:    "bg-green-500",
};
const BUCKET_ICON: Record<string, string> = {
  fixed:       "🏠",
  essentials:  "🛒",
  flexible:    "🎭",
};

// ── Teased locked section ─────────────────────────────────────────────────────

function LockedSection({ icon, title, preview }: { icon: string; title: string; preview: string }) {
  return (
    <div className="relative rounded-xl border border-gray-100 bg-white shadow-sm p-5 overflow-hidden">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-lg">{icon}</span>
        <p className="font-semibold text-gray-700 text-sm">{title}</p>
        <span className="ml-auto rounded-full bg-purple-100 px-2 py-0.5 text-xs font-semibold text-purple-700">
          Sign up to unlock
        </span>
      </div>
      <div className="select-none blur-sm opacity-60 text-sm text-gray-600 pointer-events-none">
        {preview}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function SnapshotView({
  snap,
  statementDate,
  bankName,
  accountType,
}: {
  snap: StatementSnapshot;
  statementDate?: string;
  bankName?: string;
  accountType?: string;
}) {

  return (
    <div className="space-y-5">

      {/* ── Preview banner ────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-purple-200 bg-purple-50 px-4 py-3 flex items-start gap-2.5">
        <span className="text-purple-500 mt-0.5 shrink-0">✓</span>
        <p className="text-sm text-purple-900 leading-snug">
          <strong>Your statement preview</strong> — these numbers use the same income filtering
          and spending categorization as the full app. Create an account to see trends, savings rate,
          and AI insights across all your statements.
        </p>
      </div>

      {/* ── Balance card ──────────────────────────────────────────────────── */}
      <div className="rounded-xl bg-white border border-gray-100 shadow-sm p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">
              {snap.balanceLabel}
            </p>
            <p className={`mt-1 text-4xl font-bold tabular-nums ${snap.balanceColor}`}>
              {snap.balanceDisplay}
            </p>
            <p className="mt-1 text-xs text-gray-400">
              As of {statementDate ?? "—"}{bankName ? ` · ${bankName}` : ""}
            </p>
          </div>
          {accountType && (
            <span className="mt-1 shrink-0 rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-500 capitalize">
              {accountType}
            </span>
          )}
        </div>
      </div>

      {/* ── Key metrics: Income & Net ────────────────────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-2">
        {/* Income */}
        {snap.incomeUnavailableReason ? (
          <UnavailableCard label="Income" reason={snap.incomeUnavailableReason} />
        ) : (
          <StatTile
            label="Income this month"
            value={fmt(snap.incomeTotal)}
            sub="excl. transfers"
            color="text-green-600"
          />
        )}

        {/* Net (Income - Spending) */}
        {snap.expenseUnavailableReason || snap.incomeUnavailableReason ? (
          <UnavailableCard label="Net" reason="Income and spending data required" />
        ) : (
          <StatTile
            label="Net (Income − Spending)"
            value={fmt(snap.incomeTotal - snap.coreExpenses)}
            sub={snap.incomeTotal > snap.coreExpenses ? "positive cash flow" : "negative cash flow"}
            color={snap.incomeTotal > snap.coreExpenses ? "text-green-600" : "text-red-600"}
          />
        )}
      </div>

      {/* ── Spending breakdown: Fixed / Essentials / Flexible ──────────────── */}
      {snap.hasExpenses && (
        <div className="rounded-xl bg-white border border-gray-100 shadow-sm p-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-4">
            Spending breakdown
          </p>

          {/* Stacked bar */}
          <div className="mb-4 flex h-8 w-full overflow-hidden rounded-lg bg-gray-100">
            {snap.buckets
              .filter((b) => b.amount > 0)
              .map((b) => (
                <div
                  key={b.key}
                  className={`${BUCKET_COLORS[b.key]} flex items-center justify-center text-white text-xs font-semibold transition-all`}
                  style={{ width: `${b.pct}%` }}
                  title={`${b.label}: ${fmt(b.amount)}`}
                >
                  {b.pct > 15 && b.label}
                </div>
              ))}
          </div>

          {/* Bucket rows */}
          <div className="space-y-3">
            {snap.buckets.map((b) => (
              <div key={b.key} className="flex items-center gap-3">
                <span className="text-base w-5 text-center">{BUCKET_ICON[b.key]}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-sm font-medium text-gray-700">{b.label}</span>
                    <span className="text-sm font-semibold tabular-nums text-gray-900 shrink-0">
                      {fmt(b.amount)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <div className="h-1.5 flex-1 rounded-full bg-gray-100">
                      <div
                        className={`h-1.5 rounded-full ${BUCKET_COLORS[b.key]}`}
                        style={{ width: `${b.pct}%` }}
                      />
                    </div>
                    <span className="text-xs text-gray-400 tabular-nums w-8 text-right">{b.pct}%</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
          
          <div className="mt-4 pt-4 border-t border-gray-100">
            <div className="flex justify-between text-sm">
              <span className="font-medium text-gray-700">Total Spending</span>
              <span className="font-semibold text-gray-900">{fmt(snap.coreExpenses)}</span>
            </div>
            <p className="text-xs text-gray-400 mt-1">Excludes transfers and debt payments</p>
          </div>
        </div>
      )}

      {/* ── Highlights ────────────────────────────────────────────────────── */}
      {snap.highlights.length > 0 && (
        <div className="rounded-xl bg-white border border-gray-100 shadow-sm p-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">
            Key findings
          </p>
          <div className="space-y-3">
            {snap.highlights.map((h, i) => (
              <div key={i} className={`flex gap-3 rounded-lg p-3
                ${h.type === "positive" ? "bg-green-50 border border-green-100"
                  : h.type === "warning"  ? "bg-amber-50 border border-amber-100"
                  : "bg-gray-50 border border-gray-100"}`}>
                <span className="text-xl leading-none mt-0.5">{h.icon}</span>
                <p className="text-sm text-gray-700 leading-snug">{h.text}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Spending detail (category list) ──────────────────────────────── */}
      {snap.hasExpenses && snap.categories.length > 0 && (
        <div className="rounded-xl bg-white border border-gray-100 shadow-sm p-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">
            Spending breakdown
          </p>
          <div className="space-y-2">
            {[...snap.categories]
              .sort((a, b) => b.amount - a.amount)
              .map((cat) => (
                <div key={cat.name} className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-sm text-gray-700 truncate">{cat.name}</span>
                      <span className="text-sm font-medium tabular-nums text-gray-900 shrink-0">
                        {fmt(cat.amount)}
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 w-full rounded-full bg-gray-100">
                      <div
                        className="h-1.5 rounded-full bg-purple-400"
                        style={{ width: `${Math.min(cat.percentage, 100)}%` }}
                      />
                    </div>
                  </div>
                  <span className="text-xs text-gray-400 tabular-nums w-8 text-right">
                    {Math.round(cat.percentage)}%
                  </span>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* ── Subscriptions ─────────────────────────────────────────────────── */}
      {snap.subscriptions.length > 0 && (
        <div className="rounded-xl bg-white border border-gray-100 shadow-sm p-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">
            Recurring subscriptions detected
          </p>
          <div className="space-y-2">
            {snap.subscriptions.map((s, i) => (
              <div key={i} className="flex items-center justify-between text-sm">
                <span className="text-gray-700">{s.name}</span>
                <span className="font-medium tabular-nums text-gray-900">{fmt(s.amount)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Teased locked sections ────────────────────────────────────────── */}
      <div className="space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 px-1">
          Unlock with a free account
        </p>
        <LockedSection
          icon="📊"
          title="Spending trends over time"
          preview="Your discretionary spend is up 12% vs your 3-month average. Dining increased most."
        />
        <LockedSection
          icon="🎯"
          title="Your personalised savings goal"
          preview="Based on your income of $8,041 and committed obligations, a 20% savings rate means $1,608/mo saved."
        />
        <LockedSection
          icon="⚠️"
          title="What's at risk"
          preview="Variable-rate debt on 2 accounts. A 1% rate increase would add $210/mo to your obligations."
        />
      </div>

    </div>
  );
}
