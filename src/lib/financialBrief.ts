/**
 * Financial brief builder — shared context for both AI Chat and Recommendations.
 *
 * Produces a rich, grounded text snapshot of the user's finances including
 * every individual transaction grouped by merchant, income by source,
 * real APRs, cash commitments, and emergency fund status.
 *
 * Both the chat route and the insights pipeline use this same brief so the
 * AI always has the same quality of context regardless of where it runs.
 */

import { getFirebaseAdmin } from "@/lib/firebase-admin";
import { getYearMonth } from "@/lib/consolidate";
import { buildAccountSlug } from "@/lib/accountSlug";
import { getFinancialProfile } from "@/lib/financialProfile";
import { CORE_EXCLUDE_RE } from "@/lib/spendingMetrics";
import { detectCountry } from "@/lib/external/registry";
import {
  incomeTotalForMonth,
  expenseTotalForMonth,
} from "@/lib/extractTransactions";
import { SCHEDULED_DEBT_TYPES } from "@/lib/debtUtils";
import { getNetWorth } from "@/lib/profileMetrics";
import type { ParsedStatementData } from "@/lib/types";

// ── helpers ───────────────────────────────────────────────────────────────────

function makeFmt(currency: string) {
  return (v: number) =>
    new Intl.NumberFormat("en-US", {
      style: "currency", currency,
      minimumFractionDigits: 0, maximumFractionDigits: 0,
    }).format(v);
}

export function docYearMonth(d: FirebaseFirestore.DocumentData): string {
  const parsed = d.parsedData as ParsedStatementData | undefined;
  let ym = parsed?.statementDate ? getYearMonth(parsed.statementDate) : "";
  if (!ym) {
    const raw = d.uploadedAt?.toDate?.() ?? d.uploadedAt;
    if (raw) {
      const t = typeof raw === "object" && "toISOString" in raw
        ? (raw as Date).toISOString() : String(raw);
      ym = t.slice(0, 7);
    }
  }
  return ym;
}

// keep this in sync with chat/route.ts accountSlug helper
export function statementAccountSlug(parsed: ParsedStatementData): string {
  return buildAccountSlug(parsed.bankName, parsed.accountId, parsed.accountName, parsed.accountType);
}

// ── main builder ──────────────────────────────────────────────────────────────

/** Max expense transactions to include before truncating (token budget). */
const TOKEN_BUDGET = 1200;

/**
 * "chat"     → full individual transactions per merchant (best for Q&A — "when did I last pay X?")
 * "insights" → merchant totals only, no per-date lines (compact, fits model context window)
 */
export type BriefMode = "chat" | "insights";

export async function buildFinancialBrief(uid: string, mode: BriefMode = "chat", months?: number): Promise<string> {
  const { db } = getFirebaseAdmin();

  // Single profile read — all collections (manualLiabilities, accountRates, goals,
  // confirmedSubscriptions, cashCommitmentEntries) are now part of the cache.
  // Pass months so the slice happens before building, keeping the AI context bounded.
  const profile = await getFinancialProfile(uid, db, months ? { months } : undefined);
  const {
    expenseTxns, incomeTxns, accountSnapshots, latestTxMonth, allTxMonths,
    manualAssets, manualLiabilities, accountRates, goals, confirmedSubscriptions,
    cashCommitmentEntries,
  } = profile;

  if (!latestTxMonth) return "No financial data available yet.";

  const month = latestTxMonth;
  const home  = (profile.homeCurrency ?? "USD").toUpperCase();
  const fmt   = makeFmt(home);

  const rateMap = new Map<string, number>();
  for (const r of accountRates) {
    if (r.rate != null) rateMap.set(r.accountKey, r.rate);
  }

  // ── FX helper (matches getNetWorth logic) ──────────────────────────────────
  const fxRates = profile.fxRates ?? {};
  function toHome(amount: number, currency?: string): number {
    const cur = (currency ?? home).toUpperCase();
    if (cur === home) return amount;
    const rate = fxRates[cur];
    return rate ? amount * rate : amount; // fall back to 1:1 if rate missing
  }

  // Use getNetWorth — single source of truth for the headline figure (multi-currency aware)
  const nwResult  = getNetWorth(profile, month);
  const netWorth  = nwResult.total;
  const assets    = nwResult.totalAssets;
  const debts     = nwResult.totalDebts;

  // Liquid assets with FX conversion (matches dashboard logic)
  const liquidAssets = accountSnapshots
    .filter((a) => /checking|savings|cash/i.test(a.accountType))
    .reduce((s, a) => s + toHome(Math.max(0, a.balance), a.currency), 0);

  // Monthly figures — use the pre-computed monthlyHistory so cash income and cash
  // commitments are included and the numbers match exactly what the UI cards show.
  const monthHistory    = profile.monthlyHistory.find((h) => h.yearMonth === month);
  const monthlyIncome   = monthHistory?.incomeTotal        ?? incomeTotalForMonth(incomeTxns, month);
  const monthlyExp      = monthHistory?.coreExpensesTotal  ?? expenseTxns
    .filter((t) => t.txMonth === month && !CORE_EXCLUDE_RE.test((t.category ?? "").trim()))
    .reduce((s, t) => s + t.amount, 0);
  const monthlyDebt        = monthHistory?.debtPaymentsTotal    ?? 0;
  const monthlyMinDebt     = monthHistory?.minDebtPaymentsTotal ?? 0;  // minimum/scheduled only
  const monthlyExtraDebt   = Math.max(0, monthlyDebt - monthlyMinDebt); // extra above minimum
  const monthlyDiscr       = monthlyExp - monthlyDebt;           // discretionary (excl. all debt payments)
  const monthlySav         = monthlyIncome - monthlyExp;
  const savingsRate        = monthlyIncome > 0 ? (monthlySav / monthlyIncome) * 100 : 0;
  // Savings rate excl. min debt payments — "what did I save after obligatory payments?"
  const savingsRateExclMinDebt = monthlyIncome > 0
    ? ((monthlyIncome - (monthlyExp - monthlyMinDebt)) / monthlyIncome) * 100
    : 0;
  // Savings rate excl. all debt payments — used by savings rate card toggle
  const savingsRateExclDebt = monthlyIncome > 0
    ? ((monthlyIncome - monthlyDiscr) / monthlyIncome) * 100
    : 0;
  const efTarget        = monthlyExp * 6;

  // Account lines with real APRs — show native currency per-account, with home-currency
  // equivalent in parentheses when the account is in a foreign currency.
  const accountLines = accountSnapshots.map((a) => {
    const acctId  = a.accountId ? ` (*${a.accountId.slice(-4)})` : "";
    const apr     = rateMap.get(a.slug);
    const aprStr  = apr != null ? ` at ${apr}% APR` : "";
    const acctCcy = (a.currency ?? home).toUpperCase();
    const nativeFmt = makeFmt(acctCcy);
    const nativeStr = nativeFmt(a.balance);
    // Show home-currency equivalent only when account is in a different currency
    const homeEqStr = acctCcy !== home
      ? ` (≈ ${fmt(toHome(a.balance, acctCcy))} ${home})`
      : "";
    return `  ${a.bankName}${acctId} [${a.accountType}, ${acctCcy}]: ${nativeStr}${homeEqStr}${aprStr}`;
  });
  for (const a of manualAssets) {
    accountLines.push(`  ${a.label ?? "Manual asset"} [manual asset]: ${fmt(a.value ?? 0)}`);
  }
  for (const l of manualLiabilities) {
    accountLines.push(`  ${l.label ?? "Manual liability"} [manual liability]: -${fmt(l.balance ?? 0)}`);
  }

  // Income by source with individual deposits — convert to home currency at insert time
  // to match the monthlyHistory totals (which are also in home currency).
  const incomeBySource = new Map<string, { displayName: string; entries: { ym: string; amount: number }[] }>();
  for (const txn of incomeTxns) {
    const name       = (txn.source || txn.description || "Unknown").trim();
    const key        = name.toLowerCase();
    const homeAmount = toHome(txn.amount, txn.currency);
    const entry      = incomeBySource.get(key);
    if (entry) {
      entry.entries.push({ ym: txn.txMonth, amount: homeAmount });
    } else {
      incomeBySource.set(key, { displayName: name, entries: [{ ym: txn.txMonth, amount: homeAmount }] });
    }
  }
  const incomeSection = Array.from(incomeBySource.values())
    .map(({ displayName, entries }) => {
      entries.sort((a, b) => b.ym.localeCompare(a.ym));
      const total = entries.reduce((s, e) => s + e.amount, 0);
      const lines = entries.map((e) => `    ${e.ym}: ${fmt(e.amount)}`).join("\n");
      return { displayName, total, count: entries.length, lines };
    })
    .sort((a, b) => b.total - a.total)
    .map(({ displayName, total, count, lines }) =>
      `  ${displayName} (${count} deposit${count !== 1 ? "s" : ""}, total ${fmt(total)}):\n${lines}`
    )
    .join("\n");

  // Expense transactions grouped by merchant — convert to home currency at insert time so
  // all per-merchant amounts, totals, and sort order are consistent with what the UI shows.
  const allExpenseTxns = expenseTxns.slice(0, TOKEN_BUDGET);
  const expenseByMerchant = new Map<string, { displayName: string; txns: { date: string; amount: number; category: string }[] }>();
  for (const t of allExpenseTxns) {
    const key        = t.merchant.toLowerCase().trim();
    const homeAmount = toHome(t.amount, t.currency);
    const entry      = expenseByMerchant.get(key);
    if (entry) {
      entry.txns.push({ date: t.date, amount: homeAmount, category: t.category });
    } else {
      expenseByMerchant.set(key, { displayName: t.merchant, txns: [{ date: t.date, amount: homeAmount, category: t.category }] });
    }
  }

  const sortedMerchants = Array.from(expenseByMerchant.values())
    .sort((a, b) => b.txns.reduce((s, t) => s + t.amount, 0) - a.txns.reduce((s, t) => s + t.amount, 0));

  const expenseSection = sortedMerchants
    .map(({ displayName, txns }) => {
      const total    = txns.reduce((s, t) => s + t.amount, 0);
      const category = txns[0]?.category ?? "Other";
      if (mode === "insights") {
        // Compact: one line per merchant with per-occurrence amounts so price changes are visible
        const months = [...new Set(txns.map((t) => t.date.slice(0, 7)))].sort();
        const sortedTxns = txns.slice().sort((a, b) => a.date.localeCompare(b.date));
        const allSame = sortedTxns.every((t) => Math.abs(t.amount - sortedTxns[0].amount) < 0.01);
        const amountStr = allSame
          ? `${fmt(sortedTxns[0].amount)}/txn`
          : `amounts: ${sortedTxns.map((t) => `${t.date.slice(0, 7)}:${fmt(t.amount)}`).join(", ")}`;
        return `  ${displayName} [${category}]: ${txns.length} txn${txns.length !== 1 ? "s" : ""}, ${amountStr}, total ${fmt(total)} (${months.join(", ")})`;
      }
      // Chat mode: full per-date lines
      const lines = txns.map((t) => `    ${t.date}: ${fmt(t.amount)} [${t.category}]`).join("\n");
      return `  ${displayName} (${txns.length} txn${txns.length !== 1 ? "s" : ""}, total ${fmt(total)}):\n${lines}`;
    })
    .join("\n");

  const truncationNote = expenseTxns.length > TOKEN_BUDGET
    ? `  (showing most recent ${TOKEN_BUDGET} of ${expenseTxns.length} total expense transactions)`
    : "";

  // Subscriptions — already filtered to confirmed/user_confirmed in the profile cache
  const confirmedSubs = confirmedSubscriptions;
  // No suggested subs in the cache (filtered at build time)
  const suggestedSubs: typeof confirmedSubscriptions = [];

  const confirmedSubsSection = confirmedSubs.length > 0
    ? confirmedSubs
        .map((s) => {
          const amount = toHome(s.amount ?? s.suggestedAmount, s.currency);
          const freq   = s.frequency ?? s.suggestedFrequency;
          return `  ${s.name} [${freq}]: ${fmt(amount)}/${freq} — confirmed ${s.occurrenceCount} occurrences`;
        })
        .join("\n")
    : "";

  const suggestedSubsSection = suggestedSubs.length > 0
    ? suggestedSubs
        .map((s) => `  ${s.name}: ${fmt(s.suggestedAmount)}/${s.suggestedFrequency} — unconfirmed (${s.occurrenceCount} occurrence${s.occurrenceCount !== 1 ? "s" : ""})`)
        .join("\n")
    : "";

  // No AI-extracted subscription fallback — confirmed/suggested subs from Firestore are authoritative
  const subs = "";

  // Cash commitments — from profile cache (no extra Firestore read needed)
  const freqPerYear: Record<string, number> = { weekly: 52, biweekly: 26, monthly: 12, quarterly: 4, once: 0 };
  const cashSection = cashCommitmentEntries.map((c) => {
    const perYear  = freqPerYear[c.frequency] ?? 12;
    const monthly  = c.amount * perYear / 12;
    const nextStr  = c.nextDate ? ` — date: ${c.nextDate}` : "";
    const mthStr   = c.frequency === "once" ? "one-time" : `~${fmt(monthly)}/mo`;
    return `  ${c.name} (${c.frequency}): ${fmt(c.amount)} = ${mthStr} [${c.category ?? "Other"}]${c.notes ? ` — ${c.notes}` : ""}${nextStr}`;
  }).join("\n");
  const cashMonthly = cashCommitmentEntries.reduce((sum, c) => {
    const perYear = freqPerYear[c.frequency] ?? 12;
    return sum + c.amount * perYear / 12;
  }, 0);

  // Goals — from profile cache
  const goalsSection = goals.map((g) => {
    const pct = (g.targetAmount ?? 0) > 0
      ? Math.round(((g.currentAmount ?? 0) / g.targetAmount!) * 100)
      : 0;
    return `  ${g.emoji} ${g.title}: ${fmt(g.currentAmount ?? 0)} / ${fmt(g.targetAmount ?? 0)} (${pct}%)`;
  }).join("\n");

  // Monthly trend — use pre-computed profile history so figures match the Spending page exactly
  const historyByMonth = new Map(profile.monthlyHistory.map((h) => [h.yearMonth, h]));
  const historyLines = allTxMonths.map((ym) => {
    const h   = historyByMonth.get(ym);
    const inc = h?.incomeTotal        ?? incomeTotalForMonth(incomeTxns, ym);
    const exp = h?.coreExpensesTotal  ?? expenseTotalForMonth(expenseTxns, ym);
    const dbt    = h?.debtPaymentsTotal    ?? 0;
    const minDbt = h?.minDebtPaymentsTotal ?? 0;
    const xtrDbt = Math.max(0, dbt - minDbt);
    const debtStr = dbt > 0
      ? `, Debt pmts ${fmt(dbt)} (min ${fmt(minDbt)} + extra ${fmt(xtrDbt)})`
      : "";
    return `  ${ym}: Income ${fmt(inc)}, Expenses ${fmt(exp)}${debtStr}, Net ${fmt(inc - exp)}`;
  }).reverse();

  // ── Debt payment breakdown for the latest month ──────────────────────────
  // Lists each "Debt Payments" transaction with its min/scheduled vs extra tag.
  // Uses SCHEDULED_DEBT_TYPES (same rule as defaultDebtTag) — mortgage/auto/personal_loan
  // are always "scheduled"; CC and LOC default to "minimum".
  // Note: user overrides (from prefs/debtPaymentTags) are already baked into
  // monthlyMinDebt / monthlyExtraDebt totals via the profile cache — this
  // section uses defaults only for labelling individual transactions.
  const debtTxnsThisMonth = expenseTxns.filter(
    (t) => t.txMonth === month && (t.category ?? "").toLowerCase() === "debt payments",
  );
  const debtBreakdownLines = debtTxnsThisMonth.map((t) => {
    const isScheduled = SCHEDULED_DEBT_TYPES.has((t as { debtType?: string }).debtType ?? "");
    const tag = isScheduled ? "scheduled/required" : "minimum (CC/LOC — default)";
    return `  ${t.date}  ${t.merchant}  ${fmt(toHome(t.amount, t.currency))}  [${tag}]`;
  });
  const debtBreakdownSection = debtBreakdownLines.length > 0
    ? debtBreakdownLines.join("\n")
    : "  No Debt Payment transactions recorded this month";

  // ── Grounded impact values ─────────────────────────────────────────────────
  // These are code-computed from the same profile cache the UI uses. The AI must
  // use these exact figures for dollarImpact rather than re-deriving from text.

  // 1. Subscription annual cost — annualise each confirmed sub at its stored frequency
  const SUB_FREQ_PER_YEAR: Record<string, number> = { weekly: 52, biweekly: 26, monthly: 12, quarterly: 4, annual: 1 };
  const subAnnualTotal = confirmedSubs.reduce((sum, s) => {
    const amount  = toHome(s.amount ?? s.suggestedAmount, s.currency);
    const freq    = s.frequency ?? s.suggestedFrequency;
    return sum + amount * (SUB_FREQ_PER_YEAR[freq] ?? 12);
  }, 0);

  // 2. Annual interest cost per debt account that has a stored APR
  const debtInterestLines: string[] = [];
  let totalDebtInterest = 0;
  for (const a of accountSnapshots) {
    if (a.balance >= 0) continue;
    const apr = rateMap.get(a.slug);
    if (!apr) continue;
    const balance        = Math.abs(toHome(a.balance, a.currency));
    const annualInterest = balance * (apr / 100);
    totalDebtInterest   += annualInterest;
    debtInterestLines.push(
      `  ${a.bankName}${a.accountId ? ` (*${a.accountId.slice(-4)})` : ""} [${a.accountType}]: ` +
      `${fmt(balance)} balance at ${apr}% APR → ${fmt(annualInterest)}/year in interest`
    );
  }

  // 3. Emergency fund status
  const efGap          = Math.max(0, efTarget - liquidAssets);
  const efCoveredMo    = efTarget > 0 ? (liquidAssets / efTarget) * 6 : 0;
  const efGrounded     = efGap > 0
    ? `${fmt(efGap)} short of 6-month target (have ${efCoveredMo.toFixed(1)} months covered)`
    : `fully funded (${((liquidAssets / Math.max(efTarget, 1)) * 100).toFixed(0)}% of 6-month target)`;

  const groundedLines = [
    confirmedSubs.length > 0
      ? `  Confirmed subscription annual cost: ${fmt(subAnnualTotal)}/year across ${confirmedSubs.length} subscription${confirmedSubs.length !== 1 ? "s" : ""}`
      : null,
    debtInterestLines.length > 0
      ? `  Total annual interest on tracked debt: ${fmt(totalDebtInterest)}/year\n${debtInterestLines.join("\n")}`
      : null,
    `  Emergency fund: ${efGrounded}`,
    `  Savings rate (this month): ${savingsRate.toFixed(1)}% — net ${fmt(monthlySav)} on income ${fmt(monthlyIncome)}`,
  ].filter(Boolean).join("\n");

  // Stored user-confirmed country takes precedence; fall back to bank-name detection
  const userDoc = await db.collection("users").doc(uid).get();
  const storedCountry = userDoc.data()?.country as "CA" | "US" | undefined;
  const country: "CA" | "US" = storedCountry ?? detectCountry(profile);

  return `== FINANCIAL SNAPSHOT (${month}) ==
Country:           ${country === "CA" ? "Canada (CA)" : "United States (US)"}${storedCountry ? " (user-confirmed)" : " (auto-detected)"}
Home currency:     ${home} (all amounts below are in ${home} unless a native currency is shown in brackets)
Net worth:         ${fmt(netWorth)}
Total assets:      ${fmt(assets)}
Total debt:        ${fmt(debts)}
Liquid assets:     ${fmt(liquidAssets)}
Emergency fund:    ${fmt(efTarget)} target — ${efTarget > 0 ? ((liquidAssets / efTarget) * 100).toFixed(0) : 0}% funded
Months of data:    ${allTxMonths.length}

== THIS MONTH: ${month} ==
Income:                       ${fmt(monthlyIncome)}
Core expenses:                ${fmt(monthlyExp)}
  Debt payments (total):      ${fmt(monthlyDebt)}
    minimum/scheduled:        ${fmt(monthlyMinDebt)}
    extra above minimum:      ${fmt(monthlyExtraDebt)}
  Discretionary (excl. debt): ${fmt(monthlyDiscr)}
Net:                          ${fmt(monthlySav)}
Savings rate:                 ${savingsRate.toFixed(1)}%
Savings rate excl. min debt:  ${savingsRateExclMinDebt.toFixed(1)}%

== DEBT PAYMENTS BREAKDOWN (${month}) ==
(tag = scheduled/required for fixed loans; minimum for CC/LOC by default; user can override per-transaction)
${debtBreakdownSection}

== ACCOUNTS ==
${accountLines.join("\n") || "  No accounts found"}

== INCOME BY SOURCE (all deposits, by transaction date) ==
${incomeSection || "  No income data found"}

== ALL EXPENSE TRANSACTIONS (grouped by merchant, newest first) ==
${truncationNote}
${expenseSection || "  No expense transactions found"}
${confirmedSubsSection ? `\n== CONFIRMED SUBSCRIPTIONS (code-verified frequency) ==\n${confirmedSubsSection}\n` : ""}${suggestedSubsSection ? `\n== UNCONFIRMED SUBSCRIPTIONS (pending more data) ==\n${suggestedSubsSection}\n` : ""}${subs ? `\n== SUBSCRIPTIONS / RECURRING (AI-extracted, frequency unverified) ==\n${subs}\n` : ""}${cashSection ? `\n== CASH COMMITMENTS (off-statement, est. ${fmt(cashMonthly)}/mo) ==\n${cashSection}\n` : ""}${goalsSection ? `\n== GOALS ==\n${goalsSection}\n` : ""}
== MONTHLY TREND (by transaction date) ==
${historyLines.join("\n") || "  Not enough history yet"}

== GROUNDED IMPACT VALUES (code-computed from the same cache as all UI pages — use these exact figures for dollarImpact, do not re-derive) ==
${groundedLines}`;
}

