"use client";

import { useState } from "react";
import Link from "next/link";
import { IntactAmount } from "@/components/IntactAmount";
import { formatCurrency } from "@/lib/currencyUtils";
import {
  describeAssetChangePill,
  describeDebtChangePill,
  type CategoryTrendCard,
  type CategoryTrendKind,
  type TrendAccountRow,
} from "@/lib/categoryTrends";
import { sparklineYDomain } from "@/lib/sparklineScale";
import { TREND_RANGES, type TrendRangeKey } from "@/lib/trendRange";

const DOT: Record<string, string> = {
  cash: "bg-blue-500",
  investments: "bg-violet-500",
  registered: "bg-teal-600",
  property: "bg-amber-500",
  other: "bg-gray-400",
  mortgage: "bg-rose-500",
  credit_card: "bg-orange-500",
  loc: "bg-amber-500",
};

const STROKE: Record<string, string> = {
  cash: "#3b82f6",
  investments: "#8b5cf6",
  registered: "#0d9488",
  property: "#f59e0b",
  other: "#9ca3af",
  mortgage: "#f43f5e",
  credit_card: "#f97316",
  loc: "#f59e0b",
};

function Sparkline({ data, color }: { data: number[]; color: string }) {
  if (data.length < 2) return null;
  const { min, max } = sparklineYDomain(data);
  const span = Math.max(max - min, 1e-9);
  const W = 88;
  const H = 28;
  const pts = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * W;
      const y = H - ((v - min) / span) * (H - 4) - 2;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg width={W} height={H} className="shrink-0" aria-hidden>
      <polyline
        points={pts}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function TrendRangeSelector({
  value,
  onChange,
}: {
  value: TrendRangeKey;
  onChange: (range: TrendRangeKey) => void;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-1">
      {TREND_RANGES.map((range) => (
        <button
          key={range}
          type="button"
          onClick={() => onChange(range)}
          className={`rounded-full px-3 py-1 text-xs font-medium transition ${
            value === range
              ? "bg-purple-100 text-purple-700"
              : "text-gray-400 hover:text-gray-600"
          }`}
        >
          {range}
        </button>
      ))}
    </div>
  );
}

function pillClass(tone: "up" | "down" | "flat", kind: "asset" | "debt"): string {
  if (tone === "flat") return "bg-gray-100 text-gray-600";
  if (kind === "debt") {
    return tone === "down" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700";
  }
  return tone === "up" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700";
}

function accountChangePill(account: TrendAccountRow, kind: CategoryTrendKind, currency: string) {
  if (kind === "debt") return describeDebtChangePill(account.change, currency);
  const changePercent =
    Math.abs(account.start) < 0.005 ? null : account.change / Math.abs(account.start);
  return describeAssetChangePill(account.change, changePercent, currency);
}

function ExpandedAccountRow({
  account,
  kind,
  currency,
}: {
  account: TrendAccountRow;
  kind: CategoryTrendKind;
  currency: string;
}) {
  const pill = accountChangePill(account, kind, currency);
  const body = (
    <>
      <span className="min-w-0 break-words text-sm text-gray-800">{account.label}</span>
      <div className="shrink-0 text-right">
        <IntactAmount className="block text-sm font-semibold text-gray-900">
          {formatCurrency(account.end, currency)}
        </IntactAmount>
        <span className={`mt-0.5 inline-block rounded-full px-2 py-0.5 text-xs font-medium ${pillClass(pill.tone, kind)}`}>
          {pill.text}
        </span>
      </div>
    </>
  );
  const rowClass = "flex items-start justify-between gap-3 py-2 first:pt-0 last:pb-0";
  if (!account.href) {
    return <div className={rowClass}>{body}</div>;
  }
  return (
    <Link href={account.href} className={`${rowClass} rounded-md hover:bg-gray-50`}>
      {body}
    </Link>
  );
}

function CategoryCard({
  card,
  currency,
}: {
  card: CategoryTrendCard;
  currency: string;
}) {
  const [open, setOpen] = useState(false);
  const pill =
    card.kind === "debt"
      ? describeDebtChangePill(card.change, currency)
      : describeAssetChangePill(card.change, card.changePercent, currency);
  const viewLabel =
    card.accountCount === 1 ? "View account →" : `View ${card.accountCount} accounts →`;

  return (
    <div className="rounded-lg border border-gray-200 p-4 space-y-2">
      <div className="flex items-center gap-2">
        <span
          className={`h-2 w-2 shrink-0 rounded-full ${DOT[card.key] ?? "bg-gray-400"}`}
          aria-hidden
        />
        <h3 className="min-w-0 break-words text-sm font-semibold text-gray-900">{card.label}</h3>
      </div>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <IntactAmount className="text-xl font-bold text-gray-900">
          {formatCurrency(card.current, currency)}
        </IntactAmount>
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${pillClass(pill.tone, card.kind)}`}>
          {pill.text}
        </span>
      </div>
      <Sparkline data={card.sparkline} color={STROKE[card.key] ?? "#9ca3af"} />
      {card.subtitle && (
        <p className="text-xs text-gray-600 break-words">{card.subtitle}</p>
      )}
      {card.staleNote && (
        <p className="text-xs text-amber-700">{card.staleNote}</p>
      )}
      {card.newAccountNote && (
        <p className="text-xs text-gray-400 break-words">{card.newAccountNote}</p>
      )}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="pt-1 text-xs font-medium text-purple-700 hover:text-purple-900"
      >
        {open ? "Hide accounts" : viewLabel}
      </button>
      {open && (
        <div className="border-t border-gray-100 pt-2">
          {card.accounts.map((account) => (
            <ExpandedAccountRow
              key={account.slug}
              account={account}
              kind={card.kind}
              currency={currency}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function CategoryTrendCardGrid({
  cards,
  currency,
}: {
  cards: CategoryTrendCard[];
  currency: string;
}) {
  if (cards.length === 0) return null;
  return (
    <div>
      <h2 className="mb-3 text-lg font-semibold text-gray-900">By category</h2>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {cards.map((card) => (
          <CategoryCard key={card.key} card={card} currency={currency} />
        ))}
      </div>
    </div>
  );
}
