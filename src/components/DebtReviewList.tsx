"use client";

import { useEffect, useState } from "react";
import type { DebtAnomaly } from "@/lib/debtPayments";

interface DebtReviewListProps {
  token: string | null;
  onReviewComplete?: () => void;
}

export function DebtReviewList({ token, onReviewComplete }: DebtReviewListProps) {
  const [anomalies, setAnomalies] = useState<DebtAnomaly[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState<string | null>(null);

  const loadAnomalies = async () => {
    if (!token) return;

    try {
      const res = await fetch("/api/user/debt-payment-anomalies", {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.ok) {
        const data = await res.json();
        setAnomalies(data.anomalies || []);
      }
    } catch (err) {
      console.error("Failed to load anomalies:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAnomalies();
  }, [token]);

  const handleClassify = async (
    anomaly: DebtAnomaly,
    classification: "extra_prepayment" | "new_regular_payment" | "ignore"
  ) => {
    if (!token) return;

    setSubmitting(anomaly.txFingerprint);

    try {
      const res = await fetch("/api/user/debt-payment-reviews", {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          txFingerprint: anomaly.txFingerprint,
          accountSlug: anomaly.accountSlug,
          classification,
          date: anomaly.date,
          amount: anomaly.amount,
        }),
      });

      if (res.ok) {
        // Remove from list
        setAnomalies((prev) => prev.filter((a) => a.txFingerprint !== anomaly.txFingerprint));
        onReviewComplete?.();
      } else {
        console.error("Failed to save classification");
      }
    } catch (err) {
      console.error("Error saving classification:", err);
    } finally {
      setSubmitting(null);
    }
  };

  if (loading) {
    return null;
  }

  if (anomalies.length === 0) {
    return null;
  }

  return (
    <div className="rounded-xl border-2 border-violet-200 bg-violet-50 p-6">
      <div className="flex items-center gap-3 mb-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-violet-600 text-white font-semibold">
          {anomalies.length}
        </div>
        <div>
          <h3 className="text-lg font-bold text-gray-900" style={{ fontFamily: "Inter, sans-serif" }}>
            Debt payments to review
          </h3>
          <p className="text-sm text-gray-600">
            These payments look unusual. Help us classify them correctly.
          </p>
        </div>
      </div>

      <div className="space-y-3">
        {anomalies.map((anomaly) => (
          <div
            key={anomaly.txFingerprint}
            className="rounded-lg border border-gray-200 bg-white p-4"
          >
            <div className="flex items-start justify-between mb-3">
              <div>
                <div className="font-semibold text-gray-900" style={{ fontFamily: "Inter, sans-serif" }}>
                  {anomaly.description}
                </div>
                <div className="text-sm text-gray-600">
                  {anomaly.date} · CA${anomaly.amount.toLocaleString()}
                </div>
                {anomaly.reason === "much_higher" && (
                  <div className="mt-1 text-xs text-violet-700">
                    Much higher than usual payment
                  </div>
                )}
                {anomaly.reason === "much_lower" && (
                  <div className="mt-1 text-xs text-violet-700">
                    Much lower than usual payment
                  </div>
                )}
                {anomaly.reason === "extra_in_month" && (
                  <div className="mt-1 text-xs text-violet-700">
                    Extra payment in same month
                  </div>
                )}
              </div>
            </div>

            <div className="text-sm font-medium text-gray-700 mb-2">What was this?</div>

            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => handleClassify(anomaly, "extra_prepayment")}
                disabled={submitting === anomaly.txFingerprint}
                className="rounded-lg border border-violet-600 bg-white px-4 py-2 text-sm font-medium text-violet-700 hover:bg-violet-50 disabled:opacity-50 disabled:cursor-not-allowed transition"
                style={{ fontFamily: "Inter, sans-serif" }}
              >
                Extra prepayment
              </button>
              <button
                onClick={() => handleClassify(anomaly, "new_regular_payment")}
                disabled={submitting === anomaly.txFingerprint}
                className="rounded-lg border border-violet-600 bg-white px-4 py-2 text-sm font-medium text-violet-700 hover:bg-violet-50 disabled:opacity-50 disabled:cursor-not-allowed transition"
                style={{ fontFamily: "Inter, sans-serif" }}
              >
                New regular payment
              </button>
              <button
                onClick={() => handleClassify(anomaly, "ignore")}
                disabled={submitting === anomaly.txFingerprint}
                className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition"
                style={{ fontFamily: "Inter, sans-serif" }}
              >
                Ignore (transfer/refinance)
              </button>
            </div>

            {submitting === anomaly.txFingerprint && (
              <div className="mt-2 text-sm text-gray-600">Saving...</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
