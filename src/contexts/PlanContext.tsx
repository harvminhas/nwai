"use client";

/**
 * PlanContext
 *
 * Provides the current active plan to the whole app.
 * In test/dev mode the plan is stored in localStorage and can be switched
 * via the sidebar switcher.
 *
 * When Stripe is integrated:
 *   1. Remove the localStorage read/write.
 *   2. Fetch the user's Firestore subscription doc and map the Stripe
 *      price ID to a PlanId, then call setPlanId from that effect.
 */

import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { getFirebaseClient } from "@/lib/firebase";
import { PLANS, PLAN_ORDER, type PlanId, type PlanDefinition, type PlanFeatures } from "@/lib/plans";

const TEST_PLAN_KEY = "nwai_test_plan";

interface PlanContextValue {
  planId: PlanId;
  plan: PlanDefinition;
  /** Whether a feature is available on the current plan. */
  can: (feature: keyof PlanFeatures) => boolean;
  /** For test mode only — switch to a different plan. */
  setTestPlan: (id: PlanId) => void;
  /** Re-fetch the plan from the server (call after successful checkout). */
  refresh: () => Promise<void>;
  /** True while the plan is being resolved (prevents flash of locked content). */
  loading: boolean;
}

const PlanContext = createContext<PlanContextValue>({
  planId: "free",
  plan: PLANS.free,
  can: () => false,
  setTestPlan: () => {},
  refresh: async () => {},
  loading: true,
});

export function PlanProvider({ children }: { children: React.ReactNode }) {
  const [planId, setPlanIdState] = useState<PlanId>("free");
  const [loading, setLoading]   = useState(true);

  useEffect(() => {
    // Load from localStorage immediately for instant render
    const local = localStorage.getItem(TEST_PLAN_KEY) as PlanId | null;
    if (local && PLAN_ORDER.includes(local)) setPlanIdState(local);

    // Then sync from Firestore via API (authoritative source)
    const { auth } = getFirebaseClient();
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!user) { setLoading(false); return; }
      try {
        const token = await user.getIdToken();
        const res   = await fetch("/api/user/plan", { headers: { Authorization: `Bearer ${token}` } });
        const json  = await res.json().catch(() => ({}));
        if (res.ok && json.plan && PLAN_ORDER.includes(json.plan as PlanId)) {
          setPlanIdState(json.plan as PlanId);
          localStorage.setItem(TEST_PLAN_KEY, json.plan);
        }
      } catch { /* use localStorage value */ }
      finally { setLoading(false); }
    });
    return () => unsubscribe();
  }, []);

  const setTestPlan = useCallback((id: PlanId) => {
    if (process.env.NODE_ENV !== "development") return; // no-op in production
    setPlanIdState(id);
    localStorage.setItem(TEST_PLAN_KEY, id);
    const { auth } = getFirebaseClient();
    const user = auth.currentUser;
    if (user) {
      user.getIdToken().then((token) => {
        fetch("/api/user/plan", {
          method: "PUT",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ plan: id }),
        }).catch(() => {});
      });
    }
  }, []);

  const refresh = useCallback(async () => {
    const { auth } = getFirebaseClient();
    const user = auth.currentUser;
    if (!user) return;
    try {
      const token = await user.getIdToken(/* forceRefresh */ true);
      const res   = await fetch("/api/user/plan", { headers: { Authorization: `Bearer ${token}` } });
      const json  = await res.json().catch(() => ({}));
      if (res.ok && json.plan && PLAN_ORDER.includes(json.plan as PlanId)) {
        setPlanIdState(json.plan as PlanId);
        localStorage.setItem(TEST_PLAN_KEY, json.plan);
      }
    } catch { /* ignore */ }
  }, []);

  const can = useCallback(
    (feature: keyof PlanFeatures) => PLANS[planId].features[feature],
    [planId]
  );

  return (
    <PlanContext.Provider value={{ planId, plan: PLANS[planId], can, setTestPlan, refresh, loading }}>
      {children}
    </PlanContext.Provider>
  );
}

export function usePlan() {
  return useContext(PlanContext);
}
