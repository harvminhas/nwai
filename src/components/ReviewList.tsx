"use client";

import { useEffect, useState } from "react";
import type { ReviewItem, ReviewClassification } from "@/lib/reviewTypes";

interface ReviewListProps {
  token: string | null;
  reviewType: "debt_payment" | "savings_item" | "income_classification";
  onReviewComplete?: () => void;
}

export function ReviewList({ token, reviewType, onReviewComplete }: ReviewListProps) {
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [animatingOut, setAnimatingOut] = useState(false);

  const loadReviewItems = async () => {
    if (!token) return;

    try {
      const res = await fetch(`/api/user/reviews?type=${reviewType}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.ok) {
        const data = await res.json();
        setItems(data.items || []);
      }
    } catch (err) {
      console.error("Failed to load review items:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadReviewItems();
  }, [token, reviewType]);

  const handleClassify = async (
    item: ReviewItem,
    classification: ReviewClassification
  ) => {
    if (!token || submitting) return;

    setSubmitting(true);
    setAnimatingOut(true);

    try {
      const res = await fetch("/api/user/reviews", {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          id: item.id,
          type: item.type,
          classification,
          accountSlug: item.accountSlug,
          date: item.date,
          amount: item.amount,
        }),
      });

      if (res.ok) {
        // Wait for animation to complete before removing from list
        setTimeout(() => {
          setItems((prev) => prev.filter((i) => i.id !== item.id));
          setAnimatingOut(false);
          setSubmitting(false);
          onReviewComplete?.();
        }, 300);
      } else {
        console.error("Failed to save classification", await res.text());
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

  if (items.length === 0) {
    return null;
  }

  // Show only the first item
  const currentItem = items[0];
  const currentIndex = 1;
  const totalCount = items.length;

  return (
    <div className="rounded-xl border-2 border-violet-200 bg-violet-50 p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-base font-bold text-gray-900" style={{ fontFamily: "Inter, sans-serif" }}>
            {reviewType === "debt_payment" ? "Debt payments to review" : "Savings items to review"}
          </h3>
          <p className="text-xs text-gray-600 mt-0.5">
            {reviewType === "debt_payment" 
              ? "Help us classify unusual payments"
              : "Does this count as savings?"}
          </p>
        </div>
        <div className="text-xs font-medium text-violet-700 bg-violet-100 px-2.5 py-1 rounded-full">
          {currentIndex} of {totalCount}
        </div>
      </div>

      {currentItem.type === "debt_payment" && (
        <DebtPaymentReviewCard
          item={currentItem as any}
          animatingOut={animatingOut}
          submitting={submitting}
          onClassify={handleClassify}
        />
      )}

      {currentItem.type === "savings_item" && (
        <SavingsReviewCard
          item={currentItem as any}
          animatingOut={animatingOut}
          submitting={submitting}
          onClassify={handleClassify}
        />
      )}
      
      {currentItem.type === "income_classification" && (
        <IncomeClassificationReviewCard
          item={currentItem as any}
          animatingOut={animatingOut}
          submitting={submitting}
          onClassify={handleClassify}
        />
      )}
    </div>
  );
}

// Debt payment review card
function DebtPaymentReviewCard({
  item,
  animatingOut,
  submitting,
  onClassify,
}: {
  item: any;
  animatingOut: boolean;
  submitting: boolean;
  onClassify: (item: any, classification: ReviewClassification) => void;
}) {
  const last4 = item.accountSlug.match(/\d{4}$/)?.[0] || "";
  const accountDisplay = item.accountName
    ? `${item.accountName} ${last4 ? `••${last4}` : ""}`
    : item.accountSlug;

  const monthDisplay = (() => {
    const match = item.txMonth.match(/^(\d{4})-(\d{2})$/);
    if (match) {
      const [, year, month] = match;
      const date = new Date(parseInt(year), parseInt(month) - 1);
      return date.toLocaleDateString("en-US", { month: "short", year: "numeric" });
    }
    return item.txMonth;
  })();

  const comparisonText = item.regularAmount
    ? `CA$${item.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} vs usual CA$${item.regularAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : `CA$${item.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const isHigher = item.reason === "much_higher";
  const isLower = item.reason === "much_lower";

  return (
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
          onClick={() => onClassify(item, "extra_prepayment")}
          disabled={submitting}
          className="text-xs font-medium px-3 py-1.5 rounded-md border border-violet-600 bg-white text-violet-700 hover:bg-violet-50 disabled:opacity-50 disabled:cursor-not-allowed transition"
          style={{ fontFamily: "Inter, sans-serif" }}
        >
          Extra prepayment
        </button>
        <button
          onClick={() => onClassify(item, "new_regular_payment")}
          disabled={submitting}
          className="text-xs font-medium px-3 py-1.5 rounded-md border border-violet-600 bg-white text-violet-700 hover:bg-violet-50 disabled:opacity-50 disabled:cursor-not-allowed transition"
          style={{ fontFamily: "Inter, sans-serif" }}
        >
          New regular payment
        </button>
        <button
          onClick={() => onClassify(item, "ignore")}
          disabled={submitting}
          className="text-xs font-medium px-3 py-1.5 rounded-md border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition"
          style={{ fontFamily: "Inter, sans-serif" }}
        >
          Ignore
        </button>
      </div>
    </div>
  );
}

// Savings review card
function SavingsReviewCard({
  item,
  animatingOut,
  submitting,
  onClassify,
}: {
  item: any;
  animatingOut: boolean;
  submitting: boolean;
  onClassify: (item: any, classification: ReviewClassification) => void;
}) {
  return (
    <div
      className={`rounded-lg border border-gray-200 bg-white p-4 transition-all duration-300 ${
        animatingOut ? "opacity-0 scale-95" : "opacity-100 scale-100"
      }`}
    >
      <div className="mb-3">
        <div className="font-semibold text-gray-900" style={{ fontFamily: "Inter, sans-serif" }}>
          {item.merchant}
        </div>
        <div className="flex items-center gap-2 mt-1 text-sm text-gray-600">
          <span>{item.accountName}</span>
          <span className="text-gray-400">•</span>
          <span>{item.date}</span>
          <span className="text-gray-400">•</span>
          <span>CA${Math.abs(item.amount).toLocaleString()}</span>
          <span className="text-gray-400">•</span>
          <span className="text-orange-600">{item.reason}</span>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => onClassify(item, "is_savings")}
          disabled={submitting}
          className="text-xs font-medium px-3 py-1.5 rounded-md border border-violet-600 bg-white text-violet-700 hover:bg-violet-50 disabled:opacity-50 disabled:cursor-not-allowed transition"
          style={{ fontFamily: "Inter, sans-serif" }}
        >
          Yes, it's savings
        </button>
        <button
          onClick={() => onClassify(item, "not_savings")}
          disabled={submitting}
          className="text-xs font-medium px-3 py-1.5 rounded-md border border-violet-600 bg-white text-violet-700 hover:bg-violet-50 disabled:opacity-50 disabled:cursor-not-allowed transition"
          style={{ fontFamily: "Inter, sans-serif" }}
        >
          No, it's not
        </button>
        <button
          onClick={() => onClassify(item, "ignore")}
          disabled={submitting}
          className="text-xs font-medium px-3 py-1.5 rounded-md border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition"
          style={{ fontFamily: "Inter, sans-serif" }}
        >
          Skip
        </button>
      </div>
    </div>
  );
}

// Income classification review card
function IncomeClassificationReviewCard({
  item,
  animatingOut,
  submitting,
  onClassify,
}: {
  item: any;
  animatingOut: boolean;
  submitting: boolean;
  onClassify: (item: any, classification: ReviewClassification) => void;
}) {
  return (
    <div
      className={`rounded-lg border border-gray-200 bg-white p-4 transition-all duration-300 ${
        animatingOut ? "opacity-0 scale-95" : "opacity-100 scale-100"
      }`}
    >
      <div className="mb-3">
        <div className="font-semibold text-gray-900" style={{ fontFamily: "Inter, sans-serif" }}>
          {item.source}
        </div>
        <div className="flex items-center gap-2 mt-1 text-sm text-gray-600">
          <span>{item.date}</span>
          <span className="text-gray-400">•</span>
          <span>CA${Math.abs(item.amount).toLocaleString()}</span>
          {item.reason && (
            <>
              <span className="text-gray-400">•</span>
              <span className="text-orange-600">{item.reason}</span>
            </>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => onClassify(item, "is_income")}
          disabled={submitting}
          className="text-xs font-medium px-3 py-1.5 rounded-md border border-violet-600 bg-white text-violet-700 hover:bg-violet-50 disabled:opacity-50 disabled:cursor-not-allowed transition"
          style={{ fontFamily: "Inter, sans-serif" }}
        >
          Income
        </button>
        <button
          onClick={() => onClassify(item, "is_transfer")}
          disabled={submitting}
          className="text-xs font-medium px-3 py-1.5 rounded-md border border-violet-600 bg-white text-violet-700 hover:bg-violet-50 disabled:opacity-50 disabled:cursor-not-allowed transition"
          style={{ fontFamily: "Inter, sans-serif" }}
        >
          Transfer
        </button>
        <button
          onClick={() => onClassify(item, "is_refund")}
          disabled={submitting}
          className="text-xs font-medium px-3 py-1.5 rounded-md border border-violet-600 bg-white text-violet-700 hover:bg-violet-50 disabled:opacity-50 disabled:cursor-not-allowed transition"
          style={{ fontFamily: "Inter, sans-serif" }}
        >
          Refund
        </button>
        <button
          onClick={() => onClassify(item, "ignore")}
          disabled={submitting}
          className="text-xs font-medium px-3 py-1.5 rounded-md border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition"
          style={{ fontFamily: "Inter, sans-serif" }}
        >
          Skip
        </button>
      </div>
    </div>
  );
}
