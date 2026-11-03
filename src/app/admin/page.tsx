"use client";

import { useEffect, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { getFirebaseClient } from "@/lib/firebase";
import type { AdminUsageSummary, AdminUsageRow } from "@/app/api/admin/usage/route";

function formatCurrency(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

function formatDate(date: string | null): string {
  if (!date) return "-";
  return new Date(date).toLocaleDateString("en-US", { 
    month: "short", 
    day: "numeric", 
    year: "numeric" 
  });
}

function getLast12Months(): string[] {
  const months: string[] = [];
  const now = new Date();
  
  for (let i = 0; i < 12; i++) {
    const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const yearMonth = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    months.push(yearMonth);
  }
  
  return months;
}

function formatMonthLabel(yearMonth: string): string {
  const [year, month] = yearMonth.split("-");
  const date = new Date(parseInt(year), parseInt(month) - 1, 1);
  return date.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

export default function AdminPage() {
  const [loading, setLoading] = useState(true);
  const [authorized, setAuthorized] = useState(false);
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  });
  const [data, setData] = useState<AdminUsageSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const { auth } = getFirebaseClient();
    
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        setLoading(false);
        setAuthorized(false);
        return;
      }

      // Check if user is admin (harvminhas@gmail.com)
      if (user.email !== "harvminhas@gmail.com" || !user.emailVerified) {
        setLoading(false);
        setAuthorized(false);
        return;
      }

      setAuthorized(true);
      await loadData(user, selectedMonth);
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (authorized) {
      const { auth } = getFirebaseClient();
      const user = auth.currentUser;
      if (user) {
        loadData(user, selectedMonth);
      }
    }
  }, [selectedMonth, authorized]);

  async function loadData(user: any, month: string) {
    try {
      setError(null);
      const token = await user.getIdToken();
      const res = await fetch(`/api/admin/usage?month=${month}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        throw new Error(`Failed to load data: ${res.status}`);
      }

      const summary: AdminUsageSummary = await res.json();
      setData(summary);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load data");
      console.error("Admin usage error:", err);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-stone-50 dark:bg-stone-950 p-8">
        <div className="max-w-7xl mx-auto">
          <div className="text-center text-stone-600 dark:text-stone-400">
            Loading...
          </div>
        </div>
      </div>
    );
  }

  if (!authorized) {
    return (
      <div className="min-h-screen bg-stone-50 dark:bg-stone-950 p-8">
        <div className="max-w-7xl mx-auto">
          <div className="bg-white dark:bg-stone-900 rounded-lg border border-stone-200 dark:border-stone-800 p-8 text-center">
            <h1 className="text-2xl font-semibold text-stone-900 dark:text-stone-100 mb-2">
              Not Authorized
            </h1>
            <p className="text-stone-600 dark:text-stone-400">
              This page is only accessible to harvminhas@gmail.com
            </p>
          </div>
        </div>
      </div>
    );
  }

  const months = getLast12Months();

  return (
    <div className="min-h-screen bg-stone-50 dark:bg-stone-950 p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-3xl font-semibold text-stone-900 dark:text-stone-100 mb-2">
            Admin Usage Dashboard
          </h1>
          <p className="text-stone-600 dark:text-stone-400">
            User statistics and AI cost estimates
          </p>
        </div>

        {/* Month selector */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-stone-700 dark:text-stone-300 mb-2">
            Select Month
          </label>
          <select
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
            className="px-4 py-2 border border-stone-300 dark:border-stone-700 rounded-lg bg-white dark:bg-stone-900 text-stone-900 dark:text-stone-100"
          >
            {months.map((month) => (
              <option key={month} value={month}>
                {formatMonthLabel(month)}
              </option>
            ))}
          </select>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
            <p className="text-red-800 dark:text-red-200">{error}</p>
          </div>
        )}

        {data && (
          <>
            {/* Totals Card */}
            <div className="bg-white dark:bg-stone-900 rounded-lg border border-stone-200 dark:border-stone-800 p-6 mb-6">
              <h2 className="text-xl font-semibold text-stone-900 dark:text-stone-100 mb-4">
                {formatMonthLabel(data.month)} Totals
              </h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <div className="text-sm text-stone-600 dark:text-stone-400">Total Users</div>
                  <div className="text-2xl font-semibold text-stone-900 dark:text-stone-100">
                    {data.totalUsers}
                  </div>
                </div>
                <div>
                  <div className="text-sm text-stone-600 dark:text-stone-400">Statements</div>
                  <div className="text-2xl font-semibold text-stone-900 dark:text-stone-100">
                    {data.totalStatements}
                  </div>
                </div>
                <div>
                  <div className="text-sm text-stone-600 dark:text-stone-400">AI Asks</div>
                  <div className="text-2xl font-semibold text-stone-900 dark:text-stone-100">
                    {data.totalAsks}
                  </div>
                </div>
                <div>
                  <div className="text-sm text-stone-600 dark:text-stone-400">Est. Cost</div>
                  <div className="text-2xl font-semibold text-green-600 dark:text-green-400">
                    {formatCurrency(data.totalEstimatedCost)}
                  </div>
                </div>
              </div>
            </div>

            {/* Users Table */}
            <div className="bg-white dark:bg-stone-900 rounded-lg border border-stone-200 dark:border-stone-800 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="bg-stone-50 dark:bg-stone-800 border-b border-stone-200 dark:border-stone-700">
                      <th className="px-4 py-3 text-left text-sm font-medium text-stone-700 dark:text-stone-300">
                        Email
                      </th>
                      <th className="px-4 py-3 text-left text-sm font-medium text-stone-700 dark:text-stone-300">
                        Plan
                      </th>
                      <th className="px-4 py-3 text-left text-sm font-medium text-stone-700 dark:text-stone-300">
                        Signup Date
                      </th>
                      <th className="px-4 py-3 text-right text-sm font-medium text-stone-700 dark:text-stone-300">
                        Total Statements
                      </th>
                      <th className="px-4 py-3 text-right text-sm font-medium text-stone-700 dark:text-stone-300">
                        Statements This Month
                      </th>
                      <th className="px-4 py-3 text-right text-sm font-medium text-stone-700 dark:text-stone-300">
                        AI Asks This Month
                      </th>
                      <th className="px-4 py-3 text-right text-sm font-medium text-stone-700 dark:text-stone-300">
                        Est. Cost*
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.users.map((user) => (
                      <tr
                        key={user.uid}
                        className="border-b border-stone-100 dark:border-stone-800 hover:bg-stone-50 dark:hover:bg-stone-800/50"
                      >
                        <td className="px-4 py-3 text-sm text-stone-900 dark:text-stone-100">
                          {user.email}
                        </td>
                        <td className="px-4 py-3 text-sm text-stone-600 dark:text-stone-400">
                          <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                            user.plan === "free" 
                              ? "bg-stone-100 dark:bg-stone-800 text-stone-700 dark:text-stone-300"
                              : "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300"
                          }`}>
                            {user.plan}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm text-stone-600 dark:text-stone-400">
                          {formatDate(user.signupDate)}
                        </td>
                        <td className="px-4 py-3 text-sm text-right text-stone-900 dark:text-stone-100">
                          {user.totalStatements}
                        </td>
                        <td className="px-4 py-3 text-sm text-right text-stone-900 dark:text-stone-100">
                          {user.statementsThisMonth}
                        </td>
                        <td className="px-4 py-3 text-sm text-right text-stone-900 dark:text-stone-100">
                          {user.asksThisMonth}
                        </td>
                        <td className="px-4 py-3 text-sm text-right text-green-600 dark:text-green-400 font-medium">
                          {formatCurrency(user.estimatedCost)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              
              {/* Cost note */}
              <div className="px-4 py-3 bg-stone-50 dark:bg-stone-800 border-t border-stone-200 dark:border-stone-700">
                <p className="text-xs text-stone-600 dark:text-stone-400">
                  * Estimated cost = (Statements × $0.015) + (AI Asks × $0.005). 
                  These are rough estimates; actual costs vary based on model, token count, and features used.
                </p>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
