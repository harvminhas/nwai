import { describe, test, expect } from "vitest";
import { postProcessSubscriptions } from "../subscriptionPostProcessing";
import type { DetectedSubscription } from "../subscriptionEngine";

const mk = (merchant: string, slug: string, amount: number, cadence: "monthly" | "yearly", lastDate: string, extra: Partial<DetectedSubscription> = {}): DetectedSubscription => ({
  merchant, merchantSlug: slug, category: "Software", amount, cadence, lastDate, nextDate: lastDate,
  chargeCount: 1, isNew: false, priceIncrease: false, transactions: [{ date: lastDate, amount }],
  tier: "confirmed", status: "active", ...extra,
} as DetectedSubscription);

const mapping = (canonical: string, alias: string) => ({ id: "x", type: "expense", canonical, alias, status: "confirmed", pairKey: `${canonical}|${alias}`, affectsCache: true, createdAt: "" } as any);

describe("subscription user actions", () => {
  const latest = "2026-10-23";

  test("cancelling an engine-active subscription moves it to inactive", () => {
    const r = postProcessSubscriptions({ subscriptions: [mk("Otter", "otter", 20, "monthly", "2026-10-10")], candidates: [], inactive: [] }, new Set(["otter"]), [], latest);
    expect(r.confirmedActive).toHaveLength(0);
    expect(r.inactive.map(s => s.merchant)).toEqual(["Otter"]);
  });

  test("cancelling one alias cancels the whole merged row", () => {
    const subs = [mk("Google Cloud", "google-cloud", 15, "monthly", "2026-10-01"), mk("GOOGLE CLOUD XR3XS7", "google-cloud-xr3xs7", 4, "monthly", "2026-09-01")];
    const r = postProcessSubscriptions({ subscriptions: subs, candidates: [], inactive: [] }, new Set(["google-cloud-xr3xs7"]), [], latest, [mapping("Google Cloud", "GOOGLE CLOUD XR3XS7")]);
    expect(r.confirmedActive).toHaveLength(0);
    expect(r.inactive).toHaveLength(1);
  });

  test("case-only name differences collapse to one row", () => {
    const subs = [mk("Google Cloud", "google-cloud", 15, "monthly", "2026-10-01"), mk("GOOGLE CLOUD", "google-cloud-2", 4, "monthly", "2026-09-01", { billingFrequency: "monthly" } as any)];
    const r = postProcessSubscriptions({ subscriptions: subs, candidates: [], inactive: [] }, new Set(), [], latest);
    expect(r.confirmedActive).toHaveLength(1);
  });

  test("quarterly charge 60 days ago is not flagged; monthly 60 days ago is", () => {
    const r = postProcessSubscriptions({ subscriptions: [mk("Q", "q", 30, "monthly", "2026-08-24", { billingFrequency: "quarterly" } as any), mk("M", "m", 10, "monthly", "2026-08-24")], candidates: [], inactive: [] }, new Set(), [], latest);
    const by = Object.fromEntries(r.confirmedActive.map(s => [s.merchant, s.noRecentCharge]));
    expect(by.Q).toBe(false);
    expect(by.M).toBe(true);
  });
});