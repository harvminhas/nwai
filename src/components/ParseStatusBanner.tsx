"use client";

/**
 * ParseStatusBanner
 *
 * Shows a compact "Analyzing…" strip at the top of any page after an upload.
 * Reads pending statement IDs written to localStorage by the upload page.
 * Watches each via Firestore onSnapshot (falls back to API polling for anonymous).
 * Calls `onRefresh` once all are complete so the parent can re-fetch its data.
 *
 * Also handles the new-account backfill prompt: when a completed statement has
 * backfillPromptNeeded=true, shows an inline age-bucket modal so the user can
 * indicate how long they've had that account.
 */

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { doc, onSnapshot } from "firebase/firestore";
import { getFirebaseClient } from "@/lib/firebase";
import { onAuthStateChanged } from "firebase/auth";

export const PENDING_KEY    = "nwai_pending_parses";
const BACKFILL_PROMPT_KEY   = "nwai_backfill_prompt";

export interface PendingParse {
  id: string;
  name?: string;
}

export function addPendingParse(id: string, name?: string) {
  try {
    const raw     = localStorage.getItem(PENDING_KEY);
    const current: PendingParse[] = raw ? JSON.parse(raw) : [];
    if (!current.find((p) => p.id === id)) {
      current.push({ id, name });
      localStorage.setItem(PENDING_KEY, JSON.stringify(current));
    }
  } catch { /* ignore SSR / private-mode errors */ }
}

// ── Account setup modal types ─────────────────────────────────────────────────

interface BackfillPrompt {
  statementId: string;
  accountSlug: string;
  accountName: string;
  accountType: string;
  firstBalance: number;
  firstStatementYearMonth: string;
  oldestMonth: string;
  slugIsAccountNumber: boolean;
  inferredCurrency: string;
}

const SUPPORTED_CURRENCIES = [
  { code: "CAD", label: "CA$", name: "Canadian Dollar" },
  { code: "USD", label: "US$", name: "US Dollar" },
  { code: "EUR", label: "€",   name: "Euro" },
  { code: "GBP", label: "£",   name: "British Pound" },
  { code: "AUD", label: "AU$", name: "Australian Dollar" },
];

const AGE_BUCKETS = [
  { id: "new",   label: "< 1 month",  months: 0,  help: "Brand-new account — no backfill needed." },
  { id: "1to3",  label: "1–3 months", months: 2,  help: "We'll estimate 2 months of balance history." },
  { id: "3to6",  label: "3–6 months", months: 4,  help: "We'll estimate 4 months of balance history." },
  { id: "over6", label: "> 6 months", months: -1, help: "We'll estimate back to your earliest tracked month." },
] as const;

type BucketId = typeof AGE_BUCKETS[number]["id"];

// Step sequence: country (optional) → currency → age
type Step = "country" | "currency" | "age";

// ── Account setup modal (replaces inline BackfillPromptModal + country banner) ─

function AccountSetupModal({
  prompt,
  idToken,
  needsCountry,
  detectedCountry,
  onDone,
  onCountryConfirmed,
}: {
  prompt: BackfillPrompt;
  idToken: string;
  needsCountry: boolean;
  detectedCountry: "CA" | "US";
  onDone: () => void;
  onCountryConfirmed: (country: "CA" | "US") => void;
}) {
  const firstStep: Step = needsCountry ? "country" : "currency";
  const [step,     setStep]     = useState<Step>(firstStep);
  const [country,  setCountry]  = useState<"CA" | "US">(detectedCountry);
  const [currency, setCurrency] = useState<string>(prompt.inferredCurrency || "USD");
  const [selected, setSelected] = useState<BucketId | null>(null);
  const [saving,   setSaving]   = useState(false);
  const [saveError,setSaveError]= useState<string | null>(null);

  // Total steps for the progress indicator
  const totalSteps = needsCountry ? 3 : 2;
  const stepNum    = step === "country" ? 1 : step === "currency" ? (needsCountry ? 2 : 1) : (needsCountry ? 3 : 2);

  const displayId = prompt.slugIsAccountNumber
    ? `••••${prompt.accountSlug.slice(-4)}`
    : prompt.accountSlug;

  const handleSave = async () => {
    if (!selected) return;
    setSaving(true);
    setSaveError(null);

    const bucket = AGE_BUCKETS.find((b) => b.id === selected)!;
    const backfillMonths = bucket.months === -1
      ? (prompt.oldestMonth ? monthsDiff(prompt.oldestMonth, prompt.firstStatementYearMonth) : 12)
      : bucket.months;

    try {
      // Save country if we collected it
      if (needsCountry) {
        await fetch("/api/user/profile", {
          method: "PATCH",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
          body: JSON.stringify({ country }),
        });
        onCountryConfirmed(country);
      }

      // Save confirmed currency
      const ccyRes = await fetch("/api/user/currency-overrides", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ accountSlug: prompt.accountSlug, currency, confirmed: true }),
      });
      if (!ccyRes.ok) { setSaveError("Couldn't save currency — please try again."); return; }

      // Save account age / backfill
      const bfRes = await fetch("/api/user/account-backfills", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({
          statementId: prompt.statementId,
          accountSlug: prompt.accountSlug,
          accountName: prompt.accountName,
          accountType: prompt.accountType,
          backfillMonths,
          firstBalance: prompt.firstBalance,
          firstStatementYearMonth: prompt.firstStatementYearMonth,
        }),
      });
      if (!bfRes.ok) { setSaveError("Couldn't save account history — please try again."); return; }

      onDone();
    } catch {
      setSaveError("Network error — please try again.");
    } finally {
      setSaving(false);
    }
  };

  const selectedBucket = AGE_BUCKETS.find((b) => b.id === selected);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="px-6 pt-6 pb-4 border-b border-gray-100">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-gray-400">New account detected</p>
              <h2 className="mt-0.5 text-base font-bold text-gray-900">
                {prompt.accountName || displayId}
              </h2>
            </div>
            {/* Progress dots */}
            <div className="flex items-center gap-1.5 shrink-0">
              {Array.from({ length: totalSteps }).map((_, i) => (
                <span key={i} className={`h-1.5 w-1.5 rounded-full transition ${i + 1 <= stepNum ? "bg-purple-600" : "bg-gray-200"}`} />
              ))}
              <span className="ml-1 text-[10px] font-medium text-gray-400">{stepNum}/{totalSteps}</span>
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="px-6 py-5">

          {/* ── Step: Country ──────────────────────────────────────── */}
          {step === "country" && (
            <>
              <p className="text-sm font-semibold text-gray-800">Where are your accounts based?</p>
              <p className="mt-1 text-xs text-gray-500">
                We detected <span className="font-medium">{detectedCountry === "CA" ? "Canada" : "United States"}</span> from your bank. Confirm so we can tailor tax tips, savings benchmarks, and market signals.
              </p>
              <div className="mt-4 grid grid-cols-2 gap-3">
                {(["CA", "US"] as const).map((c) => (
                  <button
                    key={c}
                    onClick={() => setCountry(c)}
                    className={`flex flex-col items-center gap-1.5 rounded-xl border-2 py-4 transition ${
                      country === c
                        ? "border-purple-500 bg-purple-50"
                        : "border-gray-200 bg-gray-50 hover:border-gray-300"
                    }`}
                  >
                    <span className="text-2xl">{c === "CA" ? "🍁" : "🇺🇸"}</span>
                    <span className={`text-sm font-semibold ${country === c ? "text-purple-700" : "text-gray-700"}`}>
                      {c === "CA" ? "Canada" : "United States"}
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}

          {/* ── Step: Currency ─────────────────────────────────────── */}
          {step === "currency" && (
            <>
              <p className="text-sm font-semibold text-gray-800">What currency is this account in?</p>
              <p className="mt-1 text-xs text-gray-500">
                We detected <span className="font-medium">{prompt.inferredCurrency}</span> — confirm or change. This affects how balances and transactions are displayed.
              </p>
              <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 gap-2">
                {SUPPORTED_CURRENCIES.map((c) => (
                  <button
                    key={c.code}
                    onClick={() => setCurrency(c.code)}
                    className={`flex items-center gap-2 rounded-xl border-2 px-3 py-2.5 text-left transition ${
                      currency === c.code
                        ? "border-purple-500 bg-purple-50"
                        : "border-gray-200 bg-gray-50 hover:border-gray-300"
                    }`}
                  >
                    <span className={`text-base font-bold ${currency === c.code ? "text-purple-700" : "text-gray-600"}`}>{c.label}</span>
                    <span className={`text-xs ${currency === c.code ? "text-purple-600" : "text-gray-500"}`}>{c.name}</span>
                  </button>
                ))}
              </div>
            </>
          )}

          {/* ── Step: Age ──────────────────────────────────────────── */}
          {step === "age" && (
            <>
              <p className="text-sm font-semibold text-gray-800">How long have you had this account?</p>
              <p className="mt-1 text-xs text-gray-500">
                We&apos;ll fill in estimated balance history so your net worth chart doesn&apos;t show a false spike when this account first appears.
              </p>
              <div className="mt-4 grid grid-cols-2 gap-2">
                {AGE_BUCKETS.map((b) => (
                  <button
                    key={b.id}
                    onClick={() => setSelected(b.id)}
                    className={`rounded-xl border-2 px-3 py-3 text-left transition ${
                      selected === b.id
                        ? "border-purple-500 bg-purple-50"
                        : "border-gray-200 bg-gray-50 hover:border-gray-300"
                    }`}
                  >
                    <p className={`text-sm font-semibold ${selected === b.id ? "text-purple-700" : "text-gray-700"}`}>{b.label}</p>
                    <p className="mt-0.5 text-[11px] text-gray-400 leading-snug">{b.help}</p>
                  </button>
                ))}
              </div>
              {saveError && (
                <p className="mt-3 text-xs font-medium text-red-600">{saveError}</p>
              )}
              {prompt.slugIsAccountNumber && (
                <p className="mt-3 text-[11px] text-gray-400">
                  <span className="font-medium">Already tracking {displayId}?</span>{" "}
                  <a href="/account/liabilities?tab=accounts" className="underline hover:text-gray-600">Remove the duplicate</a> then re-upload.
                </p>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 px-6 pb-6">
          <button
            onClick={() => {
              if (step === "currency" && needsCountry) setStep("country");
              else if (step === "age") setStep("currency");
              else onDone();
            }}
            className="text-xs font-medium text-gray-400 hover:text-gray-600 transition"
          >
            {step === firstStep ? "Skip for now" : "← Back"}
          </button>

          {step === "country" && (
            <button
              onClick={() => setStep("currency")}
              className="rounded-xl bg-purple-600 px-5 py-2 text-sm font-semibold text-white hover:bg-purple-700 transition"
            >
              Continue →
            </button>
          )}
          {step === "currency" && (
            <button
              onClick={() => setStep("age")}
              className="rounded-xl bg-purple-600 px-5 py-2 text-sm font-semibold text-white hover:bg-purple-700 transition"
            >
              Continue →
            </button>
          )}
          {step === "age" && (
            <button
              onClick={handleSave}
              disabled={!selected || saving}
              className="rounded-xl bg-purple-600 px-5 py-2 text-sm font-semibold text-white hover:bg-purple-700 disabled:opacity-40 transition"
            >
              {saving ? "Saving…" : "Done ✓"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function monthsDiff(from: string, to: string): number {
  const [fy, fm] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  return Math.max(0, (ty - fy) * 12 + (tm - fm));
}

// ── Main banner ───────────────────────────────────────────────────────────────

type ParseItemStatus = "analyzing" | "done" | "error";
interface ParseItem extends PendingParse { status: ParseItemStatus }

export default function ParseStatusBanner({
  onRefresh,
  confirmedCountry,
  detectedCountry = "US",
  onCountryConfirmed,
}: {
  onRefresh: () => void;
  confirmedCountry?: string | null;
  detectedCountry?: "CA" | "US";
  onCountryConfirmed?: (country: "CA" | "US") => void;
}) {
  const router                              = useRouter();
  const [items,          setItems]          = useState<ParseItem[]>([]);
  const [showDone,       setShowDone]       = useState(false);
  const [idToken,        setIdToken]        = useState<string | null>(null);
  // Resolved country state — starts from the prop, then self-fetches when prop is absent
  const [resolvedCountry,    setResolvedCountry]    = useState<string | null | undefined>(confirmedCountry);
  const [resolvedDetected,   setResolvedDetected]   = useState<"CA" | "US">(detectedCountry);
  const onRefreshRef                        = useRef(onRefresh);
  const refreshedRef                        = useRef(false);

  // Persist the backfill prompt to localStorage so it survives parent remounts
  // (e.g. when the dashboard triggers setLoading(true) during a data refresh).
  const [backfillPrompt, setBackfillPromptState] = useState<BackfillPrompt | null>(() => {
    try {
      const raw = localStorage.getItem(BACKFILL_PROMPT_KEY);
      return raw ? (JSON.parse(raw) as BackfillPrompt) : null;
    } catch { return null; }
  });
  const setBackfillPrompt = (p: BackfillPrompt | null) => {
    setBackfillPromptState(p);
    try {
      if (p) localStorage.setItem(BACKFILL_PROMPT_KEY, JSON.stringify(p));
      else    localStorage.removeItem(BACKFILL_PROMPT_KEY);
    } catch { /* ignore */ }
  };

  useEffect(() => { onRefreshRef.current = onRefresh; }, [onRefresh]);
  // Keep resolved country in sync if the parent passes a fresh value
  useEffect(() => { setResolvedCountry(confirmedCountry); }, [confirmedCountry]);
  useEffect(() => { setResolvedDetected(detectedCountry); }, [detectedCountry]);

  // Get auth token for the backfill POST
  useEffect(() => {
    const { auth } = getFirebaseClient();
    return onAuthStateChanged(auth, async (user) => {
      if (user) {
        const tok = await user.getIdToken();
        setIdToken(tok);
        // If the parent didn't supply country info, fetch it ourselves so the
        // account-setup modal knows whether to show the country step.
        if (confirmedCountry === undefined) {
          fetch("/api/user/agent-insights", {
            headers: { Authorization: `Bearer ${tok}` },
          })
            .then((r) => r.ok ? r.json() : null)
            .then((d) => {
              if (d) {
                setResolvedCountry(d.confirmedCountry ?? null);
                setResolvedDetected(d.detectedCountry ?? "US");
              }
            })
            .catch(() => { /* non-blocking */ });
        }
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let pending: PendingParse[] = [];
    try {
      const raw = localStorage.getItem(PENDING_KEY);
      pending   = raw ? JSON.parse(raw) : [];
    } catch { return; }

    if (pending.length === 0) return;

    setItems(pending.map((p) => ({ ...p, status: "analyzing" })));

    const { db }  = getFirebaseClient();
    const unsubs: (() => void)[]                    = [];
    const timers:  ReturnType<typeof setInterval>[] = [];

    const markDone = (id: string, finalStatus: ParseItemStatus) => {
      setItems((prev) => {
        const next = prev.map((p) => p.id === id ? { ...p, status: finalStatus } : p);
        const allFinished = next.every((p) => p.status !== "analyzing");
        if (allFinished && !refreshedRef.current) {
          refreshedRef.current = true;
          try { localStorage.removeItem(PENDING_KEY); } catch { /* */ }
          setShowDone(true);
          setTimeout(() => onRefreshRef.current(), 1200);
        }
        return next;
      });
    };

    const checkBackfill = (snapData: Record<string, unknown>, stmtId: string) => {
      if (snapData.backfillPromptNeeded === true) {
        const parsedData = snapData.parsedData as Record<string, unknown> | undefined;
        setBackfillPrompt({
          statementId:             stmtId,
          accountSlug:             (snapData.accountSlug as string) ?? "",
          accountName:             (parsedData?.accountName as string) ?? (snapData.accountSlug as string) ?? "New account",
          accountType:             (parsedData?.accountType as string) ?? "other",
          firstBalance:            (parsedData?.netWorth as number)  ?? 0,
          firstStatementYearMonth: (snapData.yearMonth as string)    ?? "",
          oldestMonth:             (snapData.backfillOldestMonth as string) ?? "",
          slugIsAccountNumber:     (snapData.slugIsAccountNumber as boolean) ?? false,
          inferredCurrency:        (snapData.inferredCurrency as string) ?? "USD",
        });
      }
    };

    const startPolling = (id: string) => {
      const poll = async () => {
        try {
          const res  = await fetch(`/api/statement/${id}`);
          const data = await res.json();
          if (data.status === "completed") { clearInterval(t); markDone(id, "done"); }
          else if (data.status === "error") { clearInterval(t); markDone(id, "error"); }
        } catch { /* network blip — keep going */ }
      };
      poll();
      const t = setInterval(poll, 3000);
      timers.push(t);
    };

    for (const p of pending) {
      const ref   = doc(db, "statements", p.id);
      const unsub = onSnapshot(
        ref,
        (snap) => {
          const data = snap.data() ?? {};
          const s    = data.status as string | undefined;
          if (s === "completed") {
            // checkBackfill on every completed snapshot — backfillPromptNeeded
            // is written in the same update as status:"completed" so it will be
            // present on the very first firing, but we also re-check on any
            // subsequent snapshot just in case.
            checkBackfill(data as Record<string, unknown>, p.id);
            markDone(p.id, "done");
          } else if (s === "error") {
            markDone(p.id, "error");
          }
        },
        () => startPolling(p.id)
      );
      unsubs.push(unsub);
    }

    return () => {
      unsubs.forEach((u) => u());
      timers.forEach((t) => clearInterval(t));
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (items.length === 0 && !backfillPrompt) return null;

  const analyzing = items.filter((i) => i.status === "analyzing");
  const errors    = items.filter((i) => i.status === "error");

  return (
    <>
      {/* Account setup modal — shown when a new account is detected */}
      {backfillPrompt && idToken && (
        <AccountSetupModal
          prompt={backfillPrompt}
          idToken={idToken}
          needsCountry={resolvedCountry === null}
          detectedCountry={resolvedDetected}
          onCountryConfirmed={(c) => { setResolvedCountry(c); onCountryConfirmed?.(c); }}
          onDone={() => { setBackfillPrompt(null); onRefreshRef.current(); router.refresh(); }}
        />
      )}

      {/* Parse progress / done banner */}
      {items.length > 0 && (
        showDone ? (
          <div className="mb-5 flex items-center gap-2 rounded-xl border border-green-200 bg-green-50 px-4 py-2.5 text-sm text-green-700">
            <svg className="h-4 w-4 shrink-0 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
            <span className="font-medium">
              Statement{items.length > 1 ? "s" : ""} ready — refreshing…
            </span>
          </div>
        ) : (
          <div className="mb-5 flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
            <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-amber-500 border-t-transparent" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-amber-800">
                Analyzing {analyzing.length === 1 && items[0]?.name ? `"${items[0].name}"` : `${analyzing.length} statement${analyzing.length !== 1 ? "s" : ""}`}…
              </p>
              <p className="text-xs text-amber-600">This page will refresh automatically when ready.</p>
            </div>
            {errors.length > 0 && (
              <span className="text-xs text-red-500">{errors.length} error{errors.length > 1 ? "s" : ""}</span>
            )}
          </div>
        )
      )}
    </>
  );
}
