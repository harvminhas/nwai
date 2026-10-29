"use client";

import { useState } from "react";
import { fmt } from "@/lib/currencyUtils";
import type { FlaggedTransfer } from "@/lib/externalAccounts";

interface FlaggedTransfersCardProps {
  flaggedTransfers: FlaggedTransfer[];
  currency: string;
  onConfirm: (accountNumber: string, label: string) => Promise<void>;
}

export function FlaggedTransfersCard({ flaggedTransfers, currency, onConfirm }: FlaggedTransfersCardProps) {
  const [labelInputs, setLabelInputs] = useState<Record<string, string>>({});
  const [confirming, setConfirming] = useState<Record<string, boolean>>({});

  if (flaggedTransfers.length === 0) return null;

  const handleConfirm = async (accountNumber: string) => {
    const label = labelInputs[accountNumber]?.trim();
    if (!label) {
      alert("Please enter a label for this account");
      return;
    }
    
    setConfirming(prev => ({ ...prev, [accountNumber]: true }));
    try {
      await onConfirm(accountNumber, label);
      // Clear local state on success
      setLabelInputs(prev => {
        const next = { ...prev };
        delete next[accountNumber];
        return next;
      });
    } catch (err) {
      console.error("Failed to confirm transfer destination:", err);
      alert("Failed to save. Please try again.");
    } finally {
      setConfirming(prev => ({ ...prev, [accountNumber]: false }));
    }
  };

  // Group by destination account number
  const grouped = new Map<string, FlaggedTransfer[]>();
  for (const ft of flaggedTransfers) {
    const list = grouped.get(ft.destinationNumber) || [];
    list.push(ft);
    grouped.set(ft.destinationNumber, list);
  }

  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 mt-0.5">
          <svg className="h-5 w-5 text-amber-600" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
          </svg>
        </div>
        <div className="flex-1">
          <h3 className="text-sm font-semibold text-gray-900">Transfers to accounts not in the app</h3>
          <p className="mt-1 text-xs text-gray-700">
            We detected outgoing transfers to account numbers that aren't tracked in your statements. 
            Please confirm these are legitimate (e.g., spouse's account, external savings) and label them.
          </p>
          
          <div className="mt-4 space-y-4">
            {Array.from(grouped.entries()).map(([accountNumber, transfers]) => {
              const isAnomalous = transfers.some(t => t.isAnomalous);
              const totalAmount = transfers.reduce((sum, t) => sum + t.amount, 0);
              
              return (
                <div key={accountNumber} className="rounded-lg border border-amber-300 bg-white p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-gray-900">
                          Account ending in {accountNumber?.slice(-4) || accountNumber || "unknown"}
                        </span>
                        {isAnomalous && (
                          <span className="inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-700">
                            LARGE AMOUNT
                          </span>
                        )}
                      </div>
                      <div className="mt-1 text-xs text-gray-600">
                        {transfers.length} transfer{transfers.length > 1 ? "s" : ""} · Total {fmt(totalAmount, currency)}
                      </div>
                      
                      {/* Show first 3 transactions as examples */}
                      <div className="mt-2 space-y-1">
                        {transfers.slice(0, 3).map((t, idx) => (
                          <div key={idx} className="flex items-center justify-between text-xs text-gray-700">
                            <span className="flex-1 truncate">
                              {t.date} · {t.merchant} · from {t.fromAccount}
                            </span>
                            <span className="ml-2 font-mono font-semibold tabular-nums">
                              {fmt(t.amount, currency)}
                            </span>
                          </div>
                        ))}
                        {transfers.length > 3 && (
                          <div className="text-xs text-gray-500">
                            + {transfers.length - 3} more transfer{transfers.length - 3 > 1 ? "s" : ""}
                          </div>
                        )}
                      </div>
                      
                      <div className="mt-3 flex items-center gap-2">
                        <input
                          type="text"
                          placeholder="e.g., Wife's line of credit"
                          value={labelInputs[accountNumber] || ""}
                          onChange={(e) => setLabelInputs(prev => ({ ...prev, [accountNumber]: e.target.value }))}
                          className="flex-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                          disabled={confirming[accountNumber]}
                        />
                        <button
                          onClick={() => handleConfirm(accountNumber)}
                          disabled={confirming[accountNumber] || !labelInputs[accountNumber]?.trim()}
                          className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {confirming[accountNumber] ? "Saving..." : "Confirm"}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
