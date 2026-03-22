import { NextRequest, NextResponse } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase-admin";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { consolidateStatements, getYearMonth } from "@/lib/consolidate";
import type { ParsedStatementData } from "@/lib/types";

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
  const bank = (parsed.bankName ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const acct = (parsed.accountId ?? "unknown").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return acct !== "unknown" ? `${bank}-${acct}` : bank;
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

  // Fetch all completed statements
  const stmtSnap = await db.collection("statements")
    .where("userId", "==", uid)
    .where("status", "==", "completed")
    .orderBy("uploadedAt", "desc")
    .get();

  if (stmtSnap.empty) return "No financial data available yet.";

  // Determine current month (latest month with data)
  const allDocs = stmtSnap.docs;
  const yearMonths = new Set<string>();
  for (const doc of allDocs) {
    const ym = docYearMonth(doc.data());
    if (ym) yearMonths.add(ym);
  }
  const month = Array.from(yearMonths).sort().reverse()[0];

  // Latest statement per account up to current month
  const latestPerAccount = new Map<string, ParsedStatementData>();
  for (const doc of allDocs) {
    const d = doc.data();
    const ym = docYearMonth(d);
    if (!ym || ym > month) continue;
    const parsed = d.parsedData as ParsedStatementData;
    const slug = accountSlug(parsed);
    if (!latestPerAccount.has(slug)) latestPerAccount.set(slug, parsed);
  }
  const currentStatements = Array.from(latestPerAccount.values());
  const consolidated = consolidateStatements(currentStatements, month);

  // Manual assets
  const manualSnap = await db.collection("users").doc(uid)
    .collection("manualAssets").get();
  const manualTotal = manualSnap.docs.reduce((sum, d) => sum + (d.data().value ?? 0), 0);

  // Manual liabilities
  const manualLiabSnap = await db.collection("users").doc(uid)
    .collection("manualLiabilities").get();
  const manualLiabTotal = manualLiabSnap.docs.reduce((sum, d) => sum + (d.data().balance ?? 0), 0);

  // Account rates (APR overrides)
  const ratesSnap = await db.collection("users").doc(uid)
    .collection("accountRates").get();
  const rateMap = new Map<string, number>();
  for (const doc of ratesSnap.docs) {
    const d = doc.data();
    if (d.rate != null) rateMap.set(doc.id, d.rate);
  }

  // Build full history (all months, newest first in display) using correct carry-forward:
  // For each target month, pick the statement with the HIGHEST ym <= target per account slug.
  const allSortedYms = Array.from(yearMonths).sort(); // ascending
  const historyLines: string[] = [];
  for (const ym of allSortedYms) {
    // Carry-forward: for each slug, find the doc with the highest docYm <= ym
    const latestPerSlug = new Map<string, ParsedStatementData>();
    for (const doc of allDocs) {
      const d = doc.data();
      const docYm = docYearMonth(d);
      if (!docYm || docYm > ym) continue;
      const parsed = d.parsedData as ParsedStatementData;
      const slug = accountSlug(parsed);
      const existing = latestPerSlug.get(slug);
      // Keep the one with the most recent statement date (highest docYm)
      if (!existing) {
        latestPerSlug.set(slug, parsed);
      } else {
        // Compare statement dates to find which is more recent
        const existingYm = (existing.statementDate ?? "").slice(0, 7);
        if (docYm > existingYm) latestPerSlug.set(slug, parsed);
      }
    }
    const forMonth = Array.from(latestPerSlug.values());
    if (forMonth.length > 0) {
      const c = consolidateStatements(forMonth, ym);
      const assets = (c.assets ?? Math.max(0, c.netWorth)) + manualTotal;
      const debts  = (c.debts  ?? Math.max(0, -c.netWorth)) + manualLiabTotal;
      historyLines.push(
        `  ${ym}: NW ${fmt(assets - debts)}, Income ${fmt(c.income?.total ?? 0)}, Expenses ${fmt(c.expenses?.total ?? 0)}`
      );
    }
  }

  // Computed figures
  const assets        = (consolidated.assets ?? Math.max(0, consolidated.netWorth)) + manualTotal;
  const debts         = (consolidated.debts  ?? Math.max(0, -consolidated.netWorth)) + manualLiabTotal;
  const netWorth      = assets - debts;
  const monthlyIncome = consolidated.income?.total    ?? 0;
  const monthlyExp    = consolidated.expenses?.total  ?? 0;
  const monthlySav    = monthlyIncome - monthlyExp;
  const savingsRate   = monthlyIncome > 0 ? (monthlySav / monthlyIncome) * 100 : 0;

  let liquidAssets = 0;
  for (const stmt of currentStatements) {
    const t = (stmt.accountType ?? "").toLowerCase();
    if (t === "checking" || t === "savings") liquidAssets += Math.max(0, stmt.netWorth ?? stmt.assets ?? 0);
  }
  const efTarget = monthlyExp * 6;

  // Account list
  const accountLines = currentStatements.map((s) => {
    const bal   = s.netWorth ?? s.assets ?? 0;
    const type  = s.accountType ?? "account";
    const acctId = s.accountId ? ` (*${s.accountId.slice(-4)})` : "";
    const slug  = accountSlug(s);
    const apr   = rateMap.get(slug);
    const aprStr = apr != null ? ` at ${apr}% APR` : "";
    return `  ${s.bankName ?? "Bank"}${acctId} [${type}]: ${fmt(bal)}${aprStr}`;
  });
  if (manualSnap.docs.length > 0) {
    for (const d of manualSnap.docs) {
      const a = d.data();
      accountLines.push(`  ${a.name ?? "Manual asset"} [manual asset]: ${fmt(a.value ?? 0)}`);
    }
  }
  if (manualLiabSnap.docs.length > 0) {
    for (const d of manualLiabSnap.docs) {
      const l = d.data();
      accountLines.push(`  ${l.name ?? "Manual liability"} [manual liability]: -${fmt(l.balance ?? 0)}`);
    }
  }

  // ── Income: from carry-forward consolidated history (correct per-month totals) ─
  const incomeBySource = new Map<string, { ym: string; amount: number }[]>();

  for (const ym of allSortedYms) {
    const latestPerSlug = new Map<string, ParsedStatementData>();
    for (const doc of allDocs) {
      const d = doc.data();
      const docYm = docYearMonth(d);
      if (!docYm || docYm > ym) continue;
      const parsed = d.parsedData as ParsedStatementData;
      const slug = accountSlug(parsed);
      const existing = latestPerSlug.get(slug);
      if (!existing || docYm > (existing.statementDate ?? "").slice(0, 7)) {
        latestPerSlug.set(slug, parsed);
      }
    }
    const forMonth = Array.from(latestPerSlug.values());
    if (forMonth.length === 0) continue;

    // Only record income for months that had at least one real upload
    const hasRealStatement = allDocs.some((doc) => docYearMonth(doc.data()) === ym);
    if (!hasRealStatement) continue;

    const c = consolidateStatements(forMonth, ym);
    for (const src of c.income?.sources ?? []) {
      if (!src.amount) continue;
      const name = (src.description || "Unknown").trim();
      if (!incomeBySource.has(name)) incomeBySource.set(name, []);
      const existing = incomeBySource.get(name)!;
      if (!existing.some((e) => e.ym === ym)) {
        existing.push({ ym, amount: src.amount });
      }
    }
    for (const txn of c.income?.transactions ?? []) {
      const name = (txn.source || txn.description || "Unknown").trim();
      if (!incomeBySource.has(name)) incomeBySource.set(name, []);
      const existing = incomeBySource.get(name)!;
      const txnYm = txn.date ? txn.date.slice(0, 7) : ym;
      if (!existing.some((e) => e.ym === txnYm && e.amount === txn.amount)) {
        existing.push({ ym: txnYm, amount: txn.amount });
      }
    }
  }

  // ── Expenses: directly from real statement docs (no carry-forward duplication) ─
  // Pick the most-recently-uploaded doc per slug+month, then extract transactions.
  // This ensures each transaction appears exactly once for the month it happened in.
  const allExpenseTxns: { date: string; amount: number; merchant: string; category: string; ym: string }[] = [];
  const bestDocPerSlugYm = new Map<string, FirebaseFirestore.QueryDocumentSnapshot>();
  for (const doc of allDocs) {
    const d = doc.data();
    const docYm = docYearMonth(d);
    if (!docYm) continue;
    const parsed = d.parsedData as ParsedStatementData;
    const key = `${accountSlug(parsed)}|${docYm}`;
    const existing = bestDocPerSlugYm.get(key);
    if (!existing) {
      bestDocPerSlugYm.set(key, doc);
    } else {
      const existingTs = existing.data().uploadedAt?.toDate?.()?.getTime() ?? 0;
      const thisTs     = d.uploadedAt?.toDate?.()?.getTime() ?? 0;
      if (thisTs > existingTs) bestDocPerSlugYm.set(key, doc);
    }
  }
  for (const doc of bestDocPerSlugYm.values()) {
    const d      = doc.data();
    const docYm  = docYearMonth(d);
    const parsed = d.parsedData as ParsedStatementData;
    for (const txn of parsed.expenses?.transactions ?? []) {
      allExpenseTxns.push({
        date:     txn.date ?? docYm ?? "",
        amount:   txn.amount,
        merchant: txn.merchant ?? "Unknown",
        category: txn.category ?? "Other",
        ym:       docYm ?? "",
      });
    }
  }

  // ── Build income-by-source section ───────────────────────────────────────────
  const incomeSection = Array.from(incomeBySource.entries())
    .map(([source, entries]) => {
      entries.sort((a, b) => b.ym.localeCompare(a.ym));
      const total = entries.reduce((s, e) => s + e.amount, 0);
      const lines = entries.map((e) => `    ${e.ym}: ${fmt(e.amount)}`).join("\n");
      return { source, total, count: entries.length, lines };
    })
    .sort((a, b) => b.total - a.total)
    .map(({ source, total, count, lines }) =>
      `  ${source} (${count} month${count !== 1 ? "s" : ""}, total ${fmt(total)}):\n${lines}`
    )
    .join("\n");

  // ── Build expense-by-merchant section (token-budget: max 1200 transactions) ──
  // Prioritise recency. Cap to prevent context overflow.
  const TOKEN_BUDGET = 1200;
  const cappedExpenses = allExpenseTxns.slice(0, TOKEN_BUDGET);
  const expenseByMerchant = new Map<string, { date: string; amount: number; category: string }[]>();
  for (const t of cappedExpenses) {
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

  const truncationNote = allExpenseTxns.length > TOKEN_BUDGET
    ? `  (showing most recent ${TOKEN_BUDGET} of ${allExpenseTxns.length} total expense transactions)`
    : "";

  // Subscriptions (current month summary)
  const subs = (consolidated.subscriptions ?? [])
    .map((s) => `  ${s.name}: ${fmt(s.amount)}/mo`)
    .join("\n");

  // Cash commitments
  const cashSnap = await db.collection(`users/${uid}/cashCommitments`).get();
  const cashSection = cashSnap.docs.map((d) => {
    const c = d.data();
    const freqPerYear: Record<string, number> = { weekly: 52, biweekly: 26, monthly: 12, quarterly: 4, once: 0 };
    const perYear = freqPerYear[c.frequency as string] ?? 12;
    const monthly = (c.amount as number) * perYear / 12;
    const nextDateStr = c.nextDate ? ` — date: ${c.nextDate}` : "";
    const monthlyStr = c.frequency === "once" ? "one-time" : `~${fmt(monthly)}/mo`;
    return `  ${c.name} (${c.frequency}): ${fmt(c.amount)} = ${monthlyStr} [${c.category}]${c.notes ? ` — ${c.notes}` : ""}${nextDateStr}`;
  }).join("\n");
  const cashMonthly = cashSnap.docs.reduce((sum, d) => {
    const c = d.data();
    const freqPerYear: Record<string, number> = { weekly: 52, biweekly: 26, monthly: 12, quarterly: 4, once: 0 };
    const perYear = freqPerYear[c.frequency as string] ?? 12;
    return sum + (c.amount as number) * perYear / 12;
  }, 0);

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

== INCOME BY SOURCE (all time, monthly totals) ==
${incomeSection || "  No income data found"}

== ALL EXPENSE TRANSACTIONS (grouped by merchant, newest first) ==
${truncationNote}
${expenseSection || "  No expense transactions found"}

${subs ? `== SUBSCRIPTIONS / RECURRING ==\n${subs}\n` : ""}${cashSection ? `== CASH COMMITMENTS (off-statement, est. ${fmt(cashMonthly)}/mo) ==\n${cashSection}\n` : ""}== MONTHLY TREND (all months) ==
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
