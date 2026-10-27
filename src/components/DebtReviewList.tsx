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
  const [submitting, setSubmitting] = useState(false);
  const [animatingOut, setAnimatingOut] = useState(false);

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
    if (!token || submitting) return;

    setSubmitting(true);
    setAnimatingOut(true);

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
        // Wait for animation to complete before removing from list
        setTimeout(() => {
          setAnomalies((prev) => prev.filter((a) => a.txFingerprint !== anomaly.txFingerprint));
          setAnimatingOut(false);
          setSubmitting(false);
          onReviewComplete?.();
        }, 300);
      } else {
        const errorText = await res.text();
        console.error("Failed to save classification", {
          status: res.status,
          statusText: res.statusText,
          body: errorText,
          sent: {
            txFingerprint: anomaly.txFingerprint,
            accountSlug: anomaly.accountSlug,
            classification,
            date: anomaly.date,
            amount: anomaly.amount,
          },
        });
        setSubmitting(false);
        setAnimatingOut(false);
      }
    } catch (err) {
      console.error("Error saving classification:", err);
      setSubmitting(false);
      setAnimatingOut(false);
    }
  };

  if (loading) {
    return null;
  }

  if (anomalies.length === 0) {
    return null;
  }

  // Show only the first anomaly
  const currentAnomaly = anomalies[0];
  const currentIndex = 1;
  const totalCount = anomalies.length;

  // Extract last 4 digits from account slug
  const last4 = currentAnomaly.accountSlug.match(/\d{4}$/)?.[0] || "";
  const accountDisplay = currentAnomaly.accountName
    ? `${currentAnomaly.accountName} ${last4 ? `••${last4}` : ""}`
    : currentAnomaly.accountSlug;

  // Format month as "Mar 2026"
  const monthDisplay = (() => {
    const match = currentAnomaly.txMonth.match(/^(\d{4})-(\d{2})$/);
    if (match) {
      const [, year, month] = match;
      const date = new Date(parseInt(year), parseInt(month) - 1);
      return date.toLocaleDateString("en-US", { month: "short", year: "numeric" });
    }
    return currentAnomaly.txMonth;
  })();

  // Comparison text
  const comparisonText = currentAnomaly.regularAmount
    ? `CA$${currentAnomaly.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} vs usual CA$${currentAnomaly.regularAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : `CA$${currentAnomaly.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const isHigher = currentAnomaly.reason === "much_higher";
  const isLower = currentAnomaly.reason === "much_lower";

  return (
    <div className="rounded-xl border-2 border-violet-200 bg-violet-50 p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-base font-bold text-gray-900" style={{ fontFamily: "Inter, sans-serif" }}>
            Debt payments to review
          </h3>
          <p className="text-xs text-gray-600 mt-0.5">
            Help us classify unusual payments
          </p>
        </div>
        <div className="text-xs font-medium text-violet-700 bg-violet-100 px-2.5 py-1 rounded-full">
          {currentIndex} of {totalCount}
        </div>
      </div>

      <div
        className={`rounded-lg border border-gray-200 bg-white p-4 transition-all duration-300 ${
          animatingOut ? "opacity-0 scale-95" : "opacity-100 scale-100"
        }`}
      >
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-gray-900 truncate" style={{ fontFamily: "Inter, sans-serif" }}>
              {accountDisplay}
            </div>
            <div className="flex items-center gap-2 mt-1 text-sm text-gray-600">
              <span>{monthDisplay}</span>
              <span className="text-gray-400">•</span>
              <span className={isHigher ? "text-orange-600 font-medium" : isLower ? "text-blue-600 font-medium" : ""}>
                {comparisonText}
              </span>
            </div>
          </div>
          {(isHigher || isLower) && (
            <div className="flex-shrink-0">
              {isHigher ? (
                <svg className="w-5 h-5 text-orange-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
                </svg>
              ) : (
                <svg className="w-5 h-5 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                </svg>
              )}
            </div>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => handleClassify(currentAnomaly, "extra_prepayment")}
            disabled={submitting}
            className="text-xs font-medium px-3 py-1.5 rounded-md border border-violet-600 bg-white text-violet-700 hover:bg-violet-50 disabled:opacity-50 disabled:cursor-not-allowed transition"
            style={{ fontFamily: "Inter, sans-serif" }}
          >
            Extra prepayment
          </button>
          <button
            onClick={() => handleClassify(currentAnomaly, "new_regular_payment")}
            disabled={submitting}
            className="text-xs font-medium px-3 py-1.5 rounded-md border border-violet-600 bg-white text-violet-700 hover:bg-violet-50 disabled:opacity-50 disabled:cursor-not-allowed transition"
            style={{ fontFamily: "Inter, sans-serif" }}
          >
            New regular payment
          </button>
          <button
            onClick={() => handleClassify(currentAnomaly, "ignore")}
            disabled={submitting}
            className="text-xs font-medium px-3 py-1.5 rounded-md border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition"
            style={{ fontFamily: "Inter, sans-serif" }}
          >
            Ignore
          </button>
        </div>
      </div>
    </div>
  );
}
