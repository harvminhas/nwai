import type { Insight } from "@/lib/types";

const HYSA_URL =
  process.env.NEXT_PUBLIC_HYSA_AFFILIATE_URL || "https://sofi.com/hysa?ref=networth";
const CC_URL =
  process.env.NEXT_PUBLIC_CC_AFFILIATE_URL ||
  "https://creditcards.chase.com?ref=networth";

export default function InsightsSection({ insights }: { insights: Insight[] }) {
  if (!insights?.length) return null;

  return (
    <section className="mt-10">
      <h2 className="mb-4 font-semibold text-xl text-gray-900">Smart Insights</h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {insights.slice(0, 4).map((insight) => {
          const url =
            insight.ctaUrl ??
            (insight.cta.toLowerCase().includes("hysa") ? HYSA_URL : null) ??
            (insight.cta.toLowerCase().includes("card") ? CC_URL : null);
          return (
            <div
              key={insight.title}
              className="rounded-lg border border-amber-200 bg-amber-50/50 p-4 shadow-sm"
            >
              <h3 className="font-semibold text-gray-900">{insight.title}</h3>
              <p className="mt-2 text-sm text-gray-700">{insight.message}</p>
              {url ? (
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-3 inline-block rounded bg-amber-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-600"
                >
                  {insight.cta}
                </a>
              ) : (
                <span className="mt-3 inline-block rounded bg-amber-500 px-3 py-1.5 text-sm font-medium text-white">
                  {insight.cta}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
