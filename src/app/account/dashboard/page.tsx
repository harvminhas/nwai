"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { getFirebaseClient } from "@/lib/firebase";
import ConsolidatedCurrentDashboard from "@/components/ConsolidatedCurrentDashboard";
import type { UserStatementSummary } from "@/lib/types";
// UserStatementSummary used for statement count display

export default function AccountDashboardPage() {
  const router = useRouter();
  const [statements, setStatements] = useState<UserStatementSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dashboardRefreshKey] = useState(0);

  useEffect(() => {
    const { auth } = getFirebaseClient();
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!user) { router.push("/account/login"); return; }
      setLoading(true); setError(null);
      try {
        const t = await user.getIdToken();
        const res = await fetch("/api/user/statements", {
          headers: { Authorization: `Bearer ${t}` },
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) { setError(data.error || "Failed to load statements"); return; }
        setStatements(data.statements ?? []);
      } catch { setError("Failed to load statements"); }
      finally { setLoading(false); }
    });
    return () => unsubscribe();
  }, [router]);

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-purple-600 border-t-transparent" />
      </div>
    );
  }

  return (
    <div>
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between">
          <h1 className="font-bold text-3xl text-gray-900">Dashboard</h1>
        </div>

        {error && <p className="mt-4 text-red-600" role="alert">{error}</p>}

        <div className="mt-8">
          <ConsolidatedCurrentDashboard refreshKey={dashboardRefreshKey} />

          {/* Subtle activity footer */}
          <div className="mt-8 flex items-center justify-between border-t border-gray-100 pt-5">
            <p className="text-xs text-gray-400">
              {statements.length > 0
                ? `${statements.length} statement${statements.length !== 1 ? "s" : ""} uploaded`
                : "No statements yet"}
            </p>
            <Link
              href="/account/activity"
              className="text-xs font-medium text-purple-600 hover:underline"
            >
              View all activity →
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
