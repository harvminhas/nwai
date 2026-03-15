import type { Insight } from "@/lib/types";

const HYSA_URL =
  process.env.NEXT_PUBLIC_HYSA_AFFILIATE_URL || "https://sofi.com/hysa?ref=networth";
const CC_URL =
  process.env.NEXT_PUBLIC_CC_AFFILIATE_URL || "https://creditcards.chase.com?ref=networth";

type InsightStyle = {
  border: string;
  icon: string;
  iconBg: string;
};

const STYLES: Record<string, InsightStyle> = {
  spending_alert:        { border: "border-l-orange-400", icon: "⚡", iconBg: "bg-orange-100 text-orange-600" },
  savings_opportunity:   { border: "border-l-blue-400",   icon: "↑",  iconBg: "bg-blue-100 text-blue-600" },
  positive_reinforcement:{ border: "border-l-green-400",  icon: "✓",  iconBg: "bg-green-100 text-green-600" },
  debt_insight:          { border: "border-l-green-400",  icon: "↓",  iconBg: "bg-green-100 text-green-600" },
  credit_card:           { border: "border-l-purple-400", icon: "◈",  iconBg: "bg-purple-100 text-purple-600" },
};

const DEFAULT_STYLE: InsightStyle = {
  border: "border-l-gray-300",
  icon: "→",
  iconBg: "bg-gray-100 text-gray-500",
};

export default function InsightsSection({ insights }: { insights: Insight[] }) {
  if (!insights?.length) return null;

  return (
    <section className="mt-8">
      <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">Insights</p>
      <div className="space-y-3">
        {insights.slice(0, 4).map((insight) => {
          const style = STYLES[insight.type] ?? DEFAULT_STYLE;
          const url =
            insight.ctaUrl ??
            (insight.cta?.toLowerCase().includes("hysa") ? HYSA_URL : null) ??
            (insight.cta?.toLowerCase().includes("card") ? CC_URL : null);

          return (
            <div
              key={insight.title}
              className={`flex items-start gap-3 rounded-xl border border-gray-100 bg-white p-4 shadow-sm border-l-4 ${style.border}`}
            >
              <span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-bold ${style.iconBg}`}>
                {style.icon}
              </span>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm text-gray-900">{insight.title}</p>
                <p className="mt-0.5 text-sm text-gray-600">{insight.message}</p>
                {url && (
                  <a
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1.5 inline-block text-xs font-medium text-purple-600 hover:underline"
                  >
                    {insight.cta} →
                  </a>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
