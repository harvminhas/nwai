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
import {
  extractAllTransactions,
  incomeTotalForMonth,
  expenseTotalForMonth,
} from "@/lib/extractTransactions";
import type { ParsedStatementData } from "@/lib/types";
import type { SubscriptionRecord } from "@/lib/insights/types";

// ── helpers ───────────────────────────────────────────────────────────────────

function fmt(v: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD",
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
  return buildAccountSlug(parsed.bankName, parsed.accountId);
}

// ── main builder ──────────────────────────────────────────────────────────────

/** Max expense transactions to include before truncating (token budget). */
const TOKEN_BUDGET = 1200;

/**
 * "chat"     → full individual transactions per merchant (best for Q&A — "when did I last pay X?")
 * "insights" → merchant totals only, no per-date lines (compact, fits model context window)
 */
export type BriefMode = "chat" | "insights";

export async function buildFinancialBrief(uid: string, mode: BriefMode = "chat"): Promise<string> {
  const { db } = getFirebaseAdmin();

  const txData = await extractAllTransactions(uid, db);
  const { expenseTxns, incomeTxns, accountSnapshots, subscriptions, latestTxMonth, allTxMonths } = txData;

  if (!latestTxMonth) return "No financial data available yet.";

  const month = latestTxMonth;

  const [manualSnap, manualLiabSnap, ratesSnap, cashSnap, goalsSnap, confirmedSubsSnap] = await Promise.all([
    db.collection("users").doc(uid).collection("manualAssets").get(),
    db.collection("users").doc(uid).collection("manualLiabilities").get(),
    db.collection("users").doc(uid).collection("accountRates").get(),
    db.collection(`users/${uid}/cashCommitments`).get(),
    db.collection("users").doc(uid).collection("goals").get(),
    db.collection("users").doc(uid).collection("subscriptions").get(),
  ]);

  const manualTotal     = manualSnap.docs.reduce((s, d) => s + (d.data().value ?? 0), 0);
  const manualLiabTotal = manualLiabSnap.docs.reduce((s, d) => s + (d.data().balance ?? 0), 0);
  const rateMap = new Map<string, number>();
  for (const doc of ratesSnap.docs) {
    const d = doc.data();
    if (d.rate != null) rateMap.set(doc.id, d.rate);
  }

  // Net worth
  const statementAssets = accountSnapshots.reduce((s, a) => s + Math.max(0, a.balance), 0);
  const statementDebts  = accountSnapshots.reduce((s, a) => s + Math.max(0, -a.balance), 0);
  const assets   = statementAssets + manualTotal;
  const debts    = statementDebts  + manualLiabTotal;
  const netWorth = assets - debts;

  const liquidAssets = accountSnapshots
    .filter((a) => /checking|savings|cash/i.test(a.accountType))
    .reduce((s, a) => s + Math.max(0, a.balance), 0);

  // Monthly figures
  const monthlyIncome = incomeTotalForMonth(incomeTxns, month);
  const monthlyExp    = expenseTxns
    .filter((t) => t.txMonth === month && !/transfer|payment/i.test(t.category))
    .reduce((s, t) => s + t.amount, 0);
  const monthlySav  = monthlyIncome - monthlyExp;
  const savingsRate = monthlyIncome > 0 ? (monthlySav / monthlyIncome) * 100 : 0;
  const efTarget    = monthlyExp * 6;

  // Account lines with real APRs
  const accountLines = accountSnapshots.map((a) => {
    const acctId = a.accountId ? ` (*${a.accountId.slice(-4)})` : "";
    const apr    = rateMap.get(a.slug);
    const aprStr = apr != null ? ` at ${apr}% APR` : "";
    return `  ${a.bankName}${acctId} [${a.accountType}]: ${fmt(a.balance)}${aprStr}`;
  });
  for (const d of manualSnap.docs) {
    const a = d.data();
    accountLines.push(`  ${a.name ?? "Manual asset"} [manual asset]: ${fmt(a.value ?? 0)}`);
  }
  for (const d of manualLiabSnap.docs) {
    const l = d.data();
    accountLines.push(`  ${l.name ?? "Manual liability"} [manual liability]: -${fmt(l.balance ?? 0)}`);
  }

  // Income by source with individual deposits
  const incomeBySource = new Map<string, { displayName: string; entries: { ym: string; amount: number }[] }>();
  for (const txn of incomeTxns) {
    const name = (txn.source || txn.description || "Unknown").trim();
    const key  = name.toLowerCase();
    const entry = incomeBySource.get(key);
    if (entry) {
      entry.entries.push({ ym: txn.txMonth, amount: txn.amount });
    } else {
      incomeBySource.set(key, { displayName: name, entries: [{ ym: txn.txMonth, amount: txn.amount }] });
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

  // Expense transactions grouped by merchant — key is lowercased to merge case variants
  const allExpenseTxns = expenseTxns.slice(0, TOKEN_BUDGET);
  const expenseByMerchant = new Map<string, { displayName: string; txns: { date: string; amount: number; category: string }[] }>();
  for (const t of allExpenseTxns) {
    const key = t.merchant.toLowerCase().trim();
    const entry = expenseByMerchant.get(key);
    if (entry) {
      entry.txns.push({ date: t.date, amount: t.amount, category: t.category });
    } else {
      expenseByMerchant.set(key, { displayName: t.merchant, txns: [{ date: t.date, amount: t.amount, category: t.category }] });
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

  // Subscriptions — prefer code-detected records (with validated frequency) over AI-suggested ones
  const confirmedSubs = confirmedSubsSnap.docs
    .map((d) => d.data() as SubscriptionRecord)
    .filter((s) => s.status === "confirmed" || s.status === "user_confirmed");

  const suggestedSubs = confirmedSubsSnap.docs
    .map((d) => d.data() as SubscriptionRecord)
    .filter((s) => s.status === "suggested");

  const confirmedSubsSection = confirmedSubs.length > 0
    ? confirmedSubs
        .map((s) => {
          const amount = s.amount ?? s.suggestedAmount;
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

  // Fallback to AI-extracted subscriptions if detector hasn't run yet
  const subs = confirmedSubs.length === 0 && suggestedSubs.length === 0
    ? subscriptions.map((s) => `  ${s.name}: ${fmt(s.amount)}/mo`).join("\n")
    : "";

  // Cash commitments
  const cashSection = cashSnap.docs.map((d) => {
    const c = d.data();
    const freqPerYear: Record<string, number> = { weekly: 52, biweekly: 26, monthly: 12, quarterly: 4, once: 0 };
    const perYear  = freqPerYear[c.frequency as string] ?? 12;
    const monthly  = (c.amount as number) * perYear / 12;
    const nextStr  = c.nextDate ? ` — date: ${c.nextDate}` : "";
    const mthStr   = c.frequency === "once" ? "one-time" : `~${fmt(monthly)}/mo`;
    return `  ${c.name} (${c.frequency}): ${fmt(c.amount)} = ${mthStr} [${c.category}]${c.notes ? ` — ${c.notes}` : ""}${nextStr}`;
  }).join("\n");
  const cashMonthly = cashSnap.docs.reduce((sum, d) => {
    const c = d.data();
    const freqPerYear: Record<string, number> = { weekly: 52, biweekly: 26, monthly: 12, quarterly: 4, once: 0 };
    const perYear = freqPerYear[c.frequency as string] ?? 12;
    return sum + (c.amount as number) * perYear / 12;
  }, 0);

  // Goals
  const goalsSection = goalsSnap.docs.map((d) => {
    const g = d.data();
    const pct = g.targetAmount > 0 ? Math.round((g.currentAmount / g.targetAmount) * 100) : 0;
    return `  ${g.emoji ?? "🎯"} ${g.title}: ${fmt(g.currentAmount ?? 0)} / ${fmt(g.targetAmount ?? 0)} (${pct}%)`;
  }).join("\n");

  // Monthly trend (all months, newest first)
  const historyLines = allTxMonths.map((ym) => {
    const inc = incomeTotalForMonth(incomeTxns, ym);
    const exp = expenseTotalForMonth(expenseTxns, ym);
    return `  ${ym}: Income ${fmt(inc)}, Expenses ${fmt(exp)}, Net ${fmt(inc - exp)}`;
  }).reverse();

  return `== FINANCIAL SNAPSHOT (${month}) ==
Net worth:        ${fmt(netWorth)}
Total assets:     ${fmt(assets)}
Total debt:       ${fmt(debts)}
Monthly income:   ${fmt(monthlyIncome)}
Monthly expenses: ${fmt(monthlyExp)}
Monthly savings:  ${fmt(monthlySav)}
Savings rate:     ${savingsRate.toFixed(1)}%
Liquid assets:    ${fmt(liquidAssets)}
Emergency fund:   ${fmt(efTarget)} target (6 months expenses) — ${efTarget > 0 ? ((liquidAssets / efTarget) * 100).toFixed(0) : 0}% funded
Months of data:   ${allTxMonths.length}

== ACCOUNTS ==
${accountLines.join("\n") || "  No accounts found"}

== INCOME BY SOURCE (all deposits, by transaction date) ==
${incomeSection || "  No income data found"}

== ALL EXPENSE TRANSACTIONS (grouped by merchant, newest first) ==
${truncationNote}
${expenseSection || "  No expense transactions found"}
${confirmedSubsSection ? `\n== CONFIRMED SUBSCRIPTIONS (code-verified frequency) ==\n${confirmedSubsSection}\n` : ""}${suggestedSubsSection ? `\n== UNCONFIRMED SUBSCRIPTIONS (pending more data) ==\n${suggestedSubsSection}\n` : ""}${subs ? `\n== SUBSCRIPTIONS / RECURRING (AI-extracted, frequency unverified) ==\n${subs}\n` : ""}${cashSection ? `\n== CASH COMMITMENTS (off-statement, est. ${fmt(cashMonthly)}/mo) ==\n${cashSection}\n` : ""}${goalsSection ? `\n== GOALS ==\n${goalsSection}\n` : ""}
== MONTHLY TREND (by transaction date) ==
${historyLines.join("\n") || "  Not enough history yet"}`;
}
