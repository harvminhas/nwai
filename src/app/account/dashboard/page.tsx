"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { getFirebaseClient } from "@/lib/firebase";
import ConsolidatedCurrentDashboard from "@/components/ConsolidatedCurrentDashboard";
import type { UserStatementSummary } from "@/lib/types";

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

export default function AccountDashboardPage() {
  const router = useRouter();
  const [statements, setStatements] = useState<UserStatementSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [dashboardRefreshKey, setDashboardRefreshKey] = useState(0);

  useEffect(() => {
    const { auth } = getFirebaseClient();
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!user) { router.push("/account/login"); return; }
      setLoading(true); setError(null);
      try {
        const t = await user.getIdToken();
        setToken(t);
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

  async function handleDelete(id: string) {
    if (!token) return;
    setDeleting(id);
    try {
      const res = await fetch(`/api/user/statements/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        setStatements((prev) => prev.filter((s) => s.id !== id));
        setDashboardRefreshKey((k) => k + 1);
      }
    } finally {
      setDeleting(null);
      setConfirmDelete(null);
    }
  }

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
          <Link
            href="/upload"
            className="rounded-lg bg-gradient-to-r from-purple-600 to-purple-700 px-6 py-2 font-semibold text-white hover:from-purple-700 hover:to-purple-800"
          >
            Upload statement
          </Link>
        </div>

        {error && <p className="mt-4 text-red-600" role="alert">{error}</p>}

        <div className="mt-8">
          <ConsolidatedCurrentDashboard refreshKey={dashboardRefreshKey} />

          <div className="mt-12 border-t border-gray-200 pt-8">
            <p className="mb-3 text-sm font-medium text-gray-700">Statement history</p>
            {statements.length === 0 && !error ? (
              <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 px-6 py-8 text-center">
                <p className="text-sm text-gray-500">No statements uploaded yet.</p>
                <Link href="/upload" className="mt-2 inline-block text-sm font-medium text-purple-600 hover:underline">
                  Upload your first statement →
                </Link>
              </div>
            ) : (
              <ul className="space-y-2">
                {statements.map((s) => (
                  <li key={s.id} className="group">
                    {confirmDelete === s.id ? (
                      <div className="flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm">
                        <span className="text-red-700">Delete this statement? This cannot be undone.</span>
                        <div className="flex shrink-0 gap-2">
                          <button
                            onClick={() => setConfirmDelete(null)}
                            className="rounded px-3 py-1 text-xs font-medium text-gray-600 hover:bg-gray-100"
                          >
                            Cancel
                          </button>
                          <button
                            onClick={() => handleDelete(s.id)}
                            disabled={deleting === s.id}
                            className="rounded bg-red-600 px-3 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
                          >
                            {deleting === s.id ? "Deleting…" : "Delete"}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className={`flex items-center gap-2 rounded-lg border px-4 py-2 text-sm transition ${
                        s.superseded ? "border-gray-100 bg-white opacity-50" : "border-gray-100 bg-gray-50/50"
                      }`}>
                        <Link
                          href={`/dashboard/${s.id}`}
                          className="flex flex-1 items-center justify-between gap-3 hover:opacity-80"
                        >
                          <span>
                            <span className={`font-medium ${s.superseded ? "text-gray-500" : "text-gray-800"}`}>
                              {s.bankName ?? s.fileName}
                              {s.accountName && (
                                <span className="font-normal text-gray-500"> · {s.accountName}</span>
                              )}
                            </span>
                            <span className="text-gray-400">
                              {" "}· {s.statementDate ? `As of ${s.statementDate}` : formatDate(s.uploadedAt)}
                            </span>
                          </span>
                          {s.superseded && (
                            <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-400">
                              Superseded
                            </span>
                          )}
                        </Link>
                        <button
                          onClick={() => setConfirmDelete(s.id)}
                          title="Delete statement"
                          className="shrink-0 rounded p-1 text-gray-300 opacity-0 transition hover:bg-red-50 hover:text-red-500 group-hover:opacity-100"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                            <path fillRule="evenodd" d="M8.75 1A2.75 2.75 0 006 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 10.23 1.482l.149-.022.841 10.518A2.75 2.75 0 007.596 19h4.807a2.75 2.75 0 002.742-2.53l.841-10.52.149.023a.75.75 0 00.23-1.482A41.03 41.03 0 0014 4.193V3.75A2.75 2.75 0 0011.25 1h-2.5zM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4zM8.58 7.72a.75.75 0 00-1.5.06l.3 7.5a.75.75 0 101.5-.06l-.3-7.5zm4.34.06a.75.75 0 10-1.5-.06l-.3 7.5a.75.75 0 101.5.06l.3-7.5z" clipRule="evenodd" />
                          </svg>
                        </button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
