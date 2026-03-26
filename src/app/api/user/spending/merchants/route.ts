import { NextRequest, NextResponse } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase-admin";
import { getYearMonth } from "@/lib/consolidate";
import { applyRulesAndRecalculate, merchantSlug } from "@/lib/applyRules";
import { buildAccountSlug } from "@/lib/accountSlug";
import type { ParsedStatementData, ExpenseTransaction } from "@/lib/types";

export interface MerchantSummary {
  slug: string;
  name: string;          // canonical display name (most-used spelling)
  category: string;
  total: number;
  count: number;         // transaction count
  avgAmount: number;
  lastDate: string | null;
  firstDate: string | null;
  /** Total per yearMonth: [{ ym, total, count }] */
  monthly: { ym: string; total: number; count: number }[];
  /** All transactions, newest first */
  transactions: (ExpenseTransaction & { ym: string })[];
}

function accountDisplayLabel(parsed: ParsedStatementData): string {
  if (parsed.accountName) return parsed.accountName;
  const slug = buildAccountSlug(parsed.bankName, parsed.accountId);
  const bank = (parsed.bankName ?? "").trim();
  if (slug === "unknown") return bank || "Unknown Account";
  return [bank, `••••${slug}`].filter(Boolean).join(" ");
}

function docYearMonth(d: FirebaseFirestore.DocumentData): string {
  const parsed = d.parsedData as ParsedStatementData | undefined;
  let ym = parsed?.statementDate ? getYearMonth(parsed.statementDate) : "";
  if (!ym) {
    const raw = d.uploadedAt?.toDate?.() ?? d.uploadedAt;
    if (raw) {
      const t =
        typeof raw === "object" && "toISOString" in raw
          ? (raw as Date).toISOString()
          : String(raw);
      ym = t.slice(0, 7);
    }
  }
  return ym;
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const slugFilter = searchParams.get("slug")?.trim() ?? null; // optional: single merchant

  try {
    const { auth, db } = getFirebaseAdmin();
    const decoded = await auth.verifyIdToken(token);
    const uid = decoded.uid;

    // Load category rules
    const rulesSnap = await db
      .collection("users").doc(uid).collection("categoryRules").get();
    const rulesMap = new Map<string, string>();
    for (const r of rulesSnap.docs) {
      const d = r.data();
      if (d.slug && d.category) rulesMap.set(d.slug as string, d.category as string);
    }

    // Load all completed statements
    const stmtSnap = await db
      .collection("statements")
      .where("userId", "==", uid)
      .where("status", "==", "completed")
      .get();

    // Deduplicate: keep only the most-recently-uploaded doc per account × statement-month.
    // This mirrors extractAllTransactions and prevents double-counting re-uploads.
    const bestDocPerSlugYm = new Map<string, FirebaseFirestore.QueryDocumentSnapshot>();
    for (const doc of stmtSnap.docs) {
      const d = doc.data();
      const parsed = d.parsedData as ParsedStatementData | undefined;
      if (!parsed) continue;
      const stmtYm = docYearMonth(d);
      if (!stmtYm) continue;
      const acctSlug = buildAccountSlug(parsed.bankName, parsed.accountId);
      const key = `${acctSlug}|${stmtYm}`;
      const existing = bestDocPerSlugYm.get(key);
      if (!existing) {
        bestDocPerSlugYm.set(key, doc);
      } else {
        const existTs = existing.data().uploadedAt?.toDate?.()?.getTime() ?? 0;
        const thisTs  = d.uploadedAt?.toDate?.()?.getTime() ?? 0;
        if (thisTs > existTs) bestDocPerSlugYm.set(key, doc);
      }
    }

    // Aggregate by merchant slug across deduplicated statements.
    // Monthly buckets use the transaction's own date, not the statement period.
    const map = new Map<string, {
      names: Record<string, number>;   // name → occurrence count
      category: string;
      total: number;
      count: number;
      dates: string[];
      monthly: Map<string, { total: number; count: number }>;
      transactions: (ExpenseTransaction & { ym: string })[];
    }>();

    for (const doc of bestDocPerSlugYm.values()) {
      const d = doc.data();
      const parsed = d.parsedData as ParsedStatementData;
      const stmtYm = docYearMonth(d);

      // Apply category rules
      const withRules = applyRulesAndRecalculate(parsed, rulesMap);
      const label = accountDisplayLabel(parsed);
      const txns: ExpenseTransaction[] = (withRules.expenses?.transactions ?? []).map((t) => ({ ...t, accountLabel: label }));

      for (const txn of txns) {
        const slug = merchantSlug(txn.merchant);
        if (!slug) continue;
        if (slugFilter && slug !== slugFilter) continue;

        // Use the transaction's own date for the monthly bucket (transaction-date principle).
        // Fall back to the statement month only when the transaction has no date.
        const txYm = txn.date ? txn.date.slice(0, 7) : stmtYm;

        let entry = map.get(slug);
        if (!entry) {
          entry = {
            names: {},
            category: txn.category ?? "other",
            total: 0,
            count: 0,
            dates: [],
            monthly: new Map(),
            transactions: [],
          };
          map.set(slug, entry);
        }

        // Track name occurrences to pick canonical name
        entry.names[txn.merchant] = (entry.names[txn.merchant] ?? 0) + 1;
        entry.category = txn.category ?? entry.category;
        entry.total += Math.abs(txn.amount);
        entry.count += 1;
        if (txn.date) entry.dates.push(txn.date);

        const mo = entry.monthly.get(txYm) ?? { total: 0, count: 0 };
        mo.total += Math.abs(txn.amount);
        mo.count += 1;
        entry.monthly.set(txYm, mo);

        entry.transactions.push({ ...txn, ym: txYm });
      }
    }

    // Build result array
    const merchants: MerchantSummary[] = Array.from(map.entries()).map(([slug, e]) => {
      // Canonical name = most-used spelling
      const name = Object.entries(e.names).sort((a, b) => b[1] - a[1])[0]?.[0] ?? slug;
      const sortedDates = [...e.dates].sort();
      const monthly = Array.from(e.monthly.entries())
        .map(([ym, v]) => ({ ym, ...v }))
        .sort((a, b) => a.ym.localeCompare(b.ym));
      const transactions = [...e.transactions].sort((a, b) =>
        (b.date ?? b.ym).localeCompare(a.date ?? a.ym)
      );
      return {
        slug,
        name,
        category: e.category,
        total: e.total,
        count: e.count,
        avgAmount: e.count > 0 ? e.total / e.count : 0,
        lastDate: sortedDates.at(-1) ?? null,
        firstDate: sortedDates[0] ?? null,
        monthly,
        transactions,
      };
    });

    // Sort by total desc
    merchants.sort((a, b) => b.total - a.total);

    if (slugFilter) {
      return NextResponse.json({ merchant: merchants[0] ?? null });
    }
    return NextResponse.json({ merchants });
  } catch (err) {
    console.error("merchants route error", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
