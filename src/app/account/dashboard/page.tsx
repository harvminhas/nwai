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

  useEffect(() => {
    const { auth } = getFirebaseClient();
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        router.push("/account/login");
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const token = await user.getIdToken();
        const res = await fetch("/api/user/statements", {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError((data.error as string) || "Failed to load statements");
          return;
        }
        setStatements(data.statements ?? []);
      } catch {
        setError("Failed to load statements");
      } finally {
        setLoading(false);
      }
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
          <Link
            href="/upload"
            className="rounded-lg bg-gradient-to-r from-purple-600 to-purple-700 px-6 py-2 font-semibold text-white hover:from-purple-700 hover:to-purple-800"
          >
            Upload statement
          </Link>
        </div>

        {error && (
          <p className="mt-4 text-red-600" role="alert">
            {error}
          </p>
        )}

        {statements.length === 0 && !error && (
          <div className="mt-12 rounded-lg border border-gray-200 bg-white p-12 text-center">
            <p className="text-gray-600">You haven&apos;t uploaded any statements yet.</p>
            <Link
              href="/upload"
              className="mt-4 inline-block font-medium text-purple-600 hover:underline"
            >
              Upload your first statement
            </Link>
          </div>
        )}

        {statements.length > 0 && (
          <div className="mt-8">
            <ConsolidatedCurrentDashboard />
            <div className="mt-12 border-t border-gray-200 pt-8">
              <p className="mb-3 text-sm font-medium text-gray-700">
                Statement history
              </p>
              <ul className="space-y-2">
                {statements.map((s) => (
                  <li key={s.id}>
                    <Link
                      href={`/dashboard/${s.id}`}
                      className={`flex items-center justify-between gap-3 rounded-lg border px-4 py-2 text-sm transition hover:bg-gray-100 ${
                        s.superseded
                          ? "border-gray-100 bg-white opacity-50"
                          : "border-gray-100 bg-gray-50/50"
                      }`}
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
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
