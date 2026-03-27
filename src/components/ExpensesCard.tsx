"use client";

import { useState } from "react";
import type { Expenses, ExpenseCategory } from "@/lib/types";

const CATEGORIES = [
  "Housing",
  "Dining",
  "Groceries",
  "Shopping",
  "Transportation",
  "Entertainment",
  "Subscriptions",
  "Healthcare",
  "Fees",
  "Debt Payments",
  "Investments & Savings",
  "Transfers",
  "Transfers & Payments", // legacy
  "Cash & ATM",
  "Other",
];

const CATEGORY_COLORS: Record<string, string> = {
  housing: "bg-blue-500",
  dining: "bg-orange-400",
  groceries: "bg-green-500",
  shopping: "bg-purple-500",
  transportation: "bg-yellow-500",
  entertainment: "bg-pink-500",
  subscriptions: "bg-indigo-500",
  healthcare: "bg-teal-500",
  fees: "bg-orange-400",
  "debt payments": "bg-red-400",
  "investments & savings": "bg-emerald-500",
  "transfers": "bg-cyan-500",
  "transfers & payments": "bg-cyan-500", // legacy
  "cash & atm": "bg-red-400",
  other: "bg-gray-400",
};

function barColor(name: string): string {
  return CATEGORY_COLORS[name.toLowerCase()] ?? "bg-purple-500";
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function groupExpenseCategories(
  categories: ExpenseCategory[],
  total: number
): { name: string; amount: number; percentage: number }[] {
  const byKey = new Map<string, { name: string; amount: number }>();
  for (const cat of categories) {
    const key = cat.name.trim().toUpperCase() || "OTHER";
    const existing = byKey.get(key);
    if (existing) existing.amount += cat.amount;
    else byKey.set(key, { name: cat.name.trim() || "Other", amount: cat.amount });
  }
  const denominator = total > 0 ? total : 1;
  return Array.from(byKey.values())
    .sort((a, b) => b.amount - a.amount)
    .map((item) => ({
      ...item,
      percentage: Math.round((item.amount / denominator) * 100),
    }));
}

type MerchantRow = {
  name: string;
  amount: number;
  percentage: number;
  category: string;
};

function groupByMerchant(
  transactions: NonNullable<Expenses["transactions"]>,
  total: number
): MerchantRow[] {
  const byKey = new Map<string, { name: string; amount: number; category: string }>();
  for (const tx of transactions) {
    const key = tx.merchant.trim().toUpperCase() || "OTHER";
    const existing = byKey.get(key);
    if (existing) existing.amount += tx.amount;
    else byKey.set(key, { name: tx.merchant.trim() || "Other", amount: tx.amount, category: tx.category });
  }
  const denominator = total > 0 ? total : 1;
  return Array.from(byKey.values())
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 25)
    .map((item) => ({
      ...item,
      percentage: Math.round((item.amount / denominator) * 100),
    }));
}

type SaveState = "idle" | "saving" | "saved" | "error";

function MerchantRow({
  row,
  statementId,
  authToken,
  onUpdated,
}: {
  row: MerchantRow;
  statementId?: string;
  authToken?: string;
  onUpdated?: (merchant: string, newCategory: string) => void;
}) {
  const [category, setCategory] = useState(row.category);
  const [saveState, setSaveState] = useState<SaveState>("idle");

  const canEdit = !!statementId && !!authToken;

  async function handleChange(newCategory: string) {
    setCategory(newCategory);
    if (!canEdit) return;

    setSaveState("saving");
    try {
      const res = await fetch(`/api/user/statements/${statementId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({ merchant: row.name, category: newCategory }),
      });
      if (!res.ok) throw new Error("Failed");
      setSaveState("saved");
      onUpdated?.(row.name, newCategory);
      setTimeout(() => setSaveState("idle"), 2000);
    } catch {
      setSaveState("error");
      setTimeout(() => setSaveState("idle"), 2000);
    }
  }

  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-gray-800">{row.name}</p>
        <p className="text-xs text-gray-400">{row.percentage}% of expenses</p>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {canEdit ? (
          <div className="relative">
            <select
              value={category}
              onChange={(e) => handleChange(e.target.value)}
              disabled={saveState === "saving"}
              className="appearance-none rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 pr-6 text-xs font-medium text-gray-700 focus:border-purple-400 focus:outline-none focus:ring-1 focus:ring-purple-400 disabled:opacity-50 cursor-pointer"
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            <span className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-gray-400 text-[10px]">▾</span>
          </div>
        ) : (
          <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs text-gray-600">
            {category}
          </span>
        )}

        {saveState === "saving" && (
          <span className="text-xs text-gray-400">saving…</span>
        )}
        {saveState === "saved" && (
          <span className="text-xs text-green-600 font-medium">✓ Rule saved</span>
        )}
        {saveState === "error" && (
          <span className="text-xs text-red-500">failed</span>
        )}

        <span className="w-16 text-right text-sm font-semibold text-gray-900">
          {formatCurrency(row.amount)}
        </span>
      </div>
    </div>
  );
}

export default function ExpensesCard({
  expenses,
  statementId,
  authToken,
}: {
  expenses: Expenses;
  statementId?: string;
  authToken?: string;
}) {
  const [view, setView] = useState<"category" | "merchant">("category");
  const [localExpenses, setLocalExpenses] = useState(expenses);

  const categories = groupExpenseCategories(localExpenses.categories ?? [], localExpenses.total);
  const merchants = groupByMerchant(localExpenses.transactions ?? [], localExpenses.total);
  const hasMerchants = merchants.length > 0;

  function handleMerchantUpdated(merchant: string, newCategory: string) {
    // Optimistically update local category grouping
    const updatedTxs = (localExpenses.transactions ?? []).map((tx) =>
      tx.merchant === merchant ? { ...tx, category: newCategory } : tx
    );
    const catMap = new Map<string, number>();
    for (const tx of updatedTxs) {
      catMap.set(tx.category, (catMap.get(tx.category) ?? 0) + tx.amount);
    }
    const total = localExpenses.total;
    const updatedCategories = Array.from(catMap.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([name, amount]) => ({
        name,
        amount,
        percentage: total > 0 ? Math.round((amount / total) * 100) : 0,
      }));
    setLocalExpenses({ ...localExpenses, transactions: updatedTxs, categories: updatedCategories });
  }

  return (
    <div className="rounded-lg bg-white p-6 shadow-md transition hover:shadow-lg">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="text-3xl" role="img" aria-hidden>💳</span>
          <div>
            <p className="text-sm font-medium text-gray-500">Expenses</p>
            <p className="font-bold text-2xl text-gray-900">{formatCurrency(localExpenses.total)}</p>
          </div>
        </div>

        {hasMerchants && (
          <div className="flex rounded-lg border border-gray-200 text-xs font-medium overflow-hidden shrink-0">
            <button
              onClick={() => setView("category")}
              className={`px-3 py-1.5 transition ${view === "category" ? "bg-purple-600 text-white" : "bg-white text-gray-500 hover:bg-gray-50"}`}
            >
              Category
            </button>
            <button
              onClick={() => setView("merchant")}
              className={`px-3 py-1.5 transition border-l border-gray-200 ${view === "merchant" ? "bg-purple-600 text-white" : "bg-white text-gray-500 hover:bg-gray-50"}`}
            >
              Merchant
            </button>
          </div>
        )}
      </div>

      {/* Category view */}
      {view === "category" && categories.length > 0 && (
        <div className="mt-4 space-y-3 border-t border-gray-100 pt-4">
          {categories.map((cat) => (
            <div key={cat.name}>
              <div className="flex justify-between text-sm">
                <span className="text-gray-700">{cat.name}</span>
                <span className="font-medium text-gray-900">
                  {formatCurrency(cat.amount)} ({cat.percentage}%)
                </span>
              </div>
              <div className="mt-1 h-2 overflow-hidden rounded-full bg-gray-100">
                <div
                  className={`h-full rounded-full ${barColor(cat.name)}`}
                  style={{ width: `${Math.min(cat.percentage, 100)}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Merchant view */}
      {view === "merchant" && hasMerchants && (
        <div className="mt-4 border-t border-gray-100 pt-4">
          {statementId && authToken && (
            <p className="mb-3 text-xs text-gray-400">
              Change a category to create a rule — applied to all future statements automatically.
            </p>
          )}
          <div className="divide-y divide-gray-50">
            {merchants.map((m) => (
              <MerchantRow
                key={m.name}
                row={m}
                statementId={statementId}
                authToken={authToken}
                onUpdated={handleMerchantUpdated}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
