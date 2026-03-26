import { NextRequest, NextResponse } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase-admin";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { getYearMonth } from "@/lib/consolidate";
import type { ParsedStatementData } from "@/lib/types";
import { buildAccountSlug } from "@/lib/accountSlug";
import {
  extractAllTransactions,
  incomeTotalForMonth,
  expenseTotalForMonth,
} from "@/lib/extractTransactions";

// ── types ──────────────────────────────────────────────────────────────────────

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

// ── helpers ────────────────────────────────────────────────────────────────────

function fmt(v: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD",
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(v);
}

function accountSlug(parsed: ParsedStatementData): string {
  return buildAccountSlug(parsed.bankName, parsed.accountId);
}

function docYearMonth(d: FirebaseFirestore.DocumentData): string {
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

// ── build financial brief ──────────────────────────────────────────────────────

async function buildFinancialBrief(uid: string): Promise<string> {
  const { db } = getFirebaseAdmin();

  // All financial data driven by transaction dates — statements are ingestion only.
  const txData = await extractAllTransactions(uid, db);
  const { expenseTxns, incomeTxns, accountSnapshots, subscriptions, latestTxMonth, allTxMonths } = txData;

  if (!latestTxMonth) return "No financial data available yet.";

  const month = latestTxMonth;

  // Manual assets / liabilities / rates
  const [manualSnap, manualLiabSnap, ratesSnap, cashSnap] = await Promise.all([
    db.collection("users").doc(uid).collection("manualAssets").get(),
    db.collection("users").doc(uid).collection("manualLiabilities").get(),
    db.collection("users").doc(uid).collection("accountRates").get(),
    db.collection(`users/${uid}/cashCommitments`).get(),
  ]);

  const manualTotal     = manualSnap.docs.reduce((s, d) => s + (d.data().value ?? 0), 0);
  const manualLiabTotal = manualLiabSnap.docs.reduce((s, d) => s + (d.data().balance ?? 0), 0);
  const rateMap = new Map<string, number>();
  for (const doc of ratesSnap.docs) {
    const d = doc.data();
    if (d.rate != null) rateMap.set(doc.id, d.rate);
  }

  // Net worth from latest account snapshots + manual
  const statementAssets = accountSnapshots.reduce((s, a) => s + Math.max(0, a.balance), 0);
  const statementDebts  = accountSnapshots.reduce((s, a) => s + Math.max(0, -a.balance), 0);
  const assets   = statementAssets + manualTotal;
  const debts    = statementDebts  + manualLiabTotal;
  const netWorth = assets - debts;

  const liquidAssets = accountSnapshots
    .filter((a) => /checking|savings|cash/i.test(a.accountType))
    .reduce((s, a) => s + Math.max(0, a.balance), 0);

  // Current-month income & expenses (transaction dates)
  const monthlyIncome = incomeTotalForMonth(incomeTxns, month);
  const monthlyExp    = expenseTxns
    .filter((t) => t.txMonth === month && !/transfer|payment/i.test(t.category))
    .reduce((s, t) => s + t.amount, 0);
  const monthlySav  = monthlyIncome - monthlyExp;
  const savingsRate = monthlyIncome > 0 ? (monthlySav / monthlyIncome) * 100 : 0;
  const efTarget    = monthlyExp * 6;

  // Account lines
  const accountLines = accountSnapshots.map((a) => {
    const acctId = a.accountId ? ` (*${a.accountId.slice(-4)})` : "";
    const slug   = a.slug;
    const apr    = rateMap.get(slug);
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

  // Income by source — grouped by source name, bucketed by transaction date
  const incomeBySource = new Map<string, { ym: string; amount: number }[]>();
  for (const txn of incomeTxns) {
    const name = (txn.source || txn.description || "Unknown").trim();
    if (!incomeBySource.has(name)) incomeBySource.set(name, []);
    incomeBySource.get(name)!.push({ ym: txn.txMonth, amount: txn.amount });
  }
  const incomeSection = Array.from(incomeBySource.entries())
    .map(([source, entries]) => {
      entries.sort((a, b) => b.ym.localeCompare(a.ym));
      const total = entries.reduce((s, e) => s + e.amount, 0);
      const lines = entries.map((e) => `    ${e.ym}: ${fmt(e.amount)}`).join("\n");
      return { source, total, count: entries.length, lines };
    })
    .sort((a, b) => b.total - a.total)
    .map(({ source, total, count, lines }) =>
      `  ${source} (${count} deposit${count !== 1 ? "s" : ""}, total ${fmt(total)}):\n${lines}`
    )
    .join("\n");

  // Expense transactions — use actual transaction dates, newest first
  const TOKEN_BUDGET = 1200;
  const allExpenseTxns = expenseTxns.slice(0, TOKEN_BUDGET);
  const expenseByMerchant = new Map<string, { date: string; amount: number; category: string }[]>();
  for (const t of allExpenseTxns) {
    if (!expenseByMerchant.has(t.merchant)) expenseByMerchant.set(t.merchant, []);
    expenseByMerchant.get(t.merchant)!.push({ date: t.date, amount: t.amount, category: t.category });
  }
  const expenseSection = Array.from(expenseByMerchant.entries())
    .sort((a, b) => b[1].reduce((s, t) => s + t.amount, 0) - a[1].reduce((s, t) => s + t.amount, 0))
    .map(([merchant, txns]) => {
      const total = txns.reduce((s, t) => s + t.amount, 0);
      const lines = txns.map((t) => `    ${t.date}: ${fmt(t.amount)} [${t.category}]`).join("\n");
      return `  ${merchant} (${txns.length} transaction${txns.length !== 1 ? "s" : ""}, total ${fmt(total)}):\n${lines}`;
    })
    .join("\n");

  const truncationNote = expenseTxns.length > TOKEN_BUDGET
    ? `  (showing most recent ${TOKEN_BUDGET} of ${expenseTxns.length} total expense transactions)`
    : "";

  // Subscriptions
  const subs = subscriptions
    .map((s) => `  ${s.name}: ${fmt(s.amount)}/mo`)
    .join("\n");

  // Cash commitments
  const cashSection = cashSnap.docs.map((d) => {
    const c = d.data();
    const freqPerYear: Record<string, number> = { weekly: 52, biweekly: 26, monthly: 12, quarterly: 4, once: 0 };
    const perYear = freqPerYear[c.frequency as string] ?? 12;
    const monthly = (c.amount as number) * perYear / 12;
    const nextDateStr = c.nextDate ? ` — date: ${c.nextDate}` : "";
    const monthlyStr  = c.frequency === "once" ? "one-time" : `~${fmt(monthly)}/mo`;
    return `  ${c.name} (${c.frequency}): ${fmt(c.amount)} = ${monthlyStr} [${c.category}]${c.notes ? ` — ${c.notes}` : ""}${nextDateStr}`;
  }).join("\n");
  const cashMonthly = cashSnap.docs.reduce((sum, d) => {
    const c = d.data();
    const freqPerYear: Record<string, number> = { weekly: 52, biweekly: 26, monthly: 12, quarterly: 4, once: 0 };
    const perYear = freqPerYear[c.frequency as string] ?? 12;
    return sum + (c.amount as number) * perYear / 12;
  }, 0);

  // Monthly trend — per-calendar-month tx totals (transaction-date-based)
  const historyLines = allTxMonths.map((ym) => {
    const inc = incomeTotalForMonth(incomeTxns, ym);
    const exp = expenseTotalForMonth(expenseTxns, ym);
    return `  ${ym}: Income ${fmt(inc)}, Expenses ${fmt(exp)}, Net ${fmt(inc - exp)}`;
  }).reverse(); // newest first

  return `== FINANCIAL SNAPSHOT (${month}) ==
Net worth:       ${fmt(netWorth)}
Total assets:    ${fmt(assets)}
Total debt:      ${fmt(debts)}
Monthly income:  ${fmt(monthlyIncome)}
Monthly expenses:${fmt(monthlyExp)}
Monthly savings: ${fmt(monthlySav)}
Savings rate:    ${savingsRate.toFixed(1)}%
Liquid assets:   ${fmt(liquidAssets)}
Emergency fund:  ${fmt(efTarget)} target (6 months expenses) — ${efTarget > 0 ? ((liquidAssets / efTarget) * 100).toFixed(0) : 0}% funded

== ACCOUNTS ==
${accountLines.join("\n") || "  No accounts found"}

== INCOME BY SOURCE (all deposits, by transaction date) ==
${incomeSection || "  No income data found"}

== ALL EXPENSE TRANSACTIONS (grouped by merchant, newest first) ==
${truncationNote}
${expenseSection || "  No expense transactions found"}

${subs ? `== SUBSCRIPTIONS / RECURRING ==\n${subs}\n` : ""}${cashSection ? `== CASH COMMITMENTS (off-statement, est. ${fmt(cashMonthly)}/mo) ==\n${cashSection}\n` : ""}== MONTHLY TREND (by transaction date) ==
${historyLines.join("\n") || "  Not enough history yet"}`;
}

// ── system prompt ──────────────────────────────────────────────────────────────

function buildSystemPrompt(brief: string): string {
  return `You are a knowledgeable, friendly personal finance assistant. You have access to the user's real financial data shown below. 

CRITICAL RULES:
- Always ground your answers in the actual numbers from the data. Cite specific figures.
- Never invent numbers not present in the data.
- If asked something the data doesn't cover, say so clearly.
- Keep responses concise and actionable. Use bullet points for lists.
- Use plain language — no jargon unless the user uses it first.
- When you spot something worth flagging (low emergency fund, high debt cost, etc.), mention it once briefly.
- Always note which time period the data is from (e.g., "Based on your March 2025 data...").
- This is financial analysis only, not regulated financial advice.

USER'S FINANCIAL DATA:
${brief}`;
}

// ── route handler ──────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  // Auth
  const authHeader = req.headers.get("Authorization") ?? "";
  const idToken = authHeader.replace("Bearer ", "").trim();
  if (!idToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let uid: string;
  try {
    const { auth } = getFirebaseAdmin();
    const decoded = await auth.verifyIdToken(idToken);
    uid = decoded.uid;
  } catch {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }

  // Parse body
  let message: string;
  let history: ChatMessage[];
  try {
    const body = await req.json();
    message = (body.message ?? "").trim();
    history = Array.isArray(body.history) ? body.history : [];
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  if (!message) return NextResponse.json({ error: "Message is required" }, { status: 400 });

  // Check plan
  const { db } = getFirebaseAdmin();
  const userDoc = await db.collection("users").doc(uid).get();
  const plan: string = userDoc.exists ? (userDoc.data()?.plan ?? "free") : "free";
  if (plan === "free") {
    return NextResponse.json({ error: "AI Chat is a Pro feature. Upgrade to access." }, { status: 403 });
  }

  // Build financial brief
  const brief = await buildFinancialBrief(uid);

  // Set up Gemini streaming
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) return NextResponse.json({ error: "AI not configured" }, { status: 500 });

  const genAI  = new GoogleGenerativeAI(apiKey);
  const model  = genAI.getGenerativeModel({
    model: "gemini-2.5-flash",
    systemInstruction: buildSystemPrompt(brief),
  });

  // Convert history to Gemini format (max last 10 turns to save tokens)
  const recentHistory = history.slice(-20);
  const geminiHistory = recentHistory.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

  const chat   = model.startChat({ history: geminiHistory });
  const result = await chat.sendMessageStream(message);

  // Stream response back
  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of result.stream) {
          const text = chunk.text();
          if (text) controller.enqueue(new TextEncoder().encode(text));
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-cache",
    },
  });
}
