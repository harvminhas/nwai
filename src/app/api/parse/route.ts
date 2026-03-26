import { NextRequest, NextResponse } from "next/server";
import {
  getFirebaseAdmin,
  FirebaseAdminCredentialsError,
  getStorageBucketName,
} from "@/lib/firebase-admin";
import {
  parseStatementImage,
  parseStatementPdf,
} from "@/lib/parseStatement";
import { merchantSlug, applyRulesAndRecalculate } from "@/lib/applyRules";
import { buildAccountSlug } from "@/lib/accountSlug";
import { getYearMonth } from "@/lib/consolidate";
import { inferFinancialDNA } from "@/lib/financialDNA";
import { generateAgentInsights } from "@/lib/agentInsights";
import {
  extractAllTransactions,
  categoryTotalsForMonth,
  incomeTotalForMonth,
  expenseTotalForMonth,
  buildMonthlyTrend,
} from "@/lib/extractTransactions";
import type { ParsedStatementData } from "@/lib/types";
import type { AgentContext } from "@/lib/agentInsights";

export const maxDuration = 120;

function computeAccountSlug(parsed: { bankName?: string; accountId?: string }): string {
  return buildAccountSlug(parsed.bankName, parsed.accountId);
}

const ERROR_MESSAGE =
  "We couldn't read this statement. Try a clearer image or different format.";

function isPdfBuffer(buf: Buffer): boolean {
  return buf.length >= 4 && buf.slice(0, 4).toString("ascii") === "%PDF";
}

export async function POST(request: NextRequest) {
  let statementId: string | undefined;
  try {
    const body = await request.json();
    statementId = (body as { statementId?: string }).statementId;
    console.log("[parse] received statementId:", statementId, "| AI_PROVIDER:", process.env.AI_PROVIDER, "| GEMINI_API_KEY set:", !!process.env.GEMINI_API_KEY?.trim());
    if (!statementId) {
      return NextResponse.json(
        { error: "Missing statementId" },
        { status: 400 }
      );
    }

    const { db, storage } = getFirebaseAdmin();
    const statementRef = db.collection("statements").doc(statementId);
    const doc = await statementRef.get();
    if (!doc.exists) {
      return NextResponse.json({ error: "Statement not found" }, { status: 404 });
    }

    const data = doc.data();
    const fileUrl = data?.fileUrl as string;
    if (!fileUrl) {
      await statementRef.update({
        status: "error",
        errorMessage: ERROR_MESSAGE,
      });
      return NextResponse.json({ error: ERROR_MESSAGE }, { status: 400 });
    }

    const bucketNameToUse =
      (data?.storageBucket as string) || getStorageBucketName();
    const bucket = storage.bucket(bucketNameToUse);
    const [contents] = await bucket.file(fileUrl).download();
    const buffer = Buffer.from(contents);
    const base64 = buffer.toString("base64");

    const contentType = (data?.contentType as string | undefined)?.toLowerCase() || "";
    const fileName = (data?.fileName as string | undefined)?.toLowerCase() || "";

    // Block CSV files that may have slipped through (belt-and-suspenders)
    if (fileName.endsWith(".csv") || contentType.includes("csv")) {
      await statementRef.update({
        status: "error",
        errorMessage: "CSV files are not supported. Please upload a PDF or photo of your bank statement.",
      });
      return NextResponse.json(
        { error: "CSV files are not supported. Please upload a PDF or photo of your bank statement." },
        { status: 400 }
      );
    }

    let parsedData: Awaited<ReturnType<typeof parseStatementImage>>;

    if (contentType.includes("pdf") || isPdfBuffer(buffer)) {
      parsedData = await parseStatementPdf(base64);
    } else {
      let mediaType: "image/png" | "image/jpeg" | "image/gif" | "image/webp" =
        "image/png";
      if (
        contentType.includes("jpeg") ||
        contentType.includes("jpg") ||
        buffer[0] === 0xff
      ) {
        mediaType = "image/jpeg";
      } else if (contentType.includes("png") || buffer[0] === 0x89) {
        mediaType = "image/png";
      } else if (contentType.includes("webp")) {
        mediaType = "image/webp";
      }
      parsedData = await parseStatementImage(base64, mediaType);
    }

    // Apply user's saved category rules if this is an authenticated statement
    const userId = data?.userId as string | null;
    if (userId) {
      const rulesSnap = await db.collection(`users/${userId}/categoryRules`).get();
      if (!rulesSnap.empty) {
        const rules = new Map(
          rulesSnap.docs.map((d) => [d.data().slug ?? merchantSlug(d.data().merchant), d.data().category])
        );
        parsedData = applyRulesAndRecalculate(parsedData, rules);
      }
    }

    // Compute indexing fields for dedup queries
    const slug = computeAccountSlug(parsedData);
    const yearMonth = parsedData.statementDate ? getYearMonth(parsedData.statementDate) : null;

    await statementRef.update({
      parsedData,
      status: "completed",
      errorMessage: null,
      accountSlug: slug,
      yearMonth: yearMonth ?? null,
    });

    // Mark older statements for the same account+month as superseded
    if (userId && slug && yearMonth) {
      const olderSnap = await db
        .collection("statements")
        .where("userId", "==", userId)
        .where("accountSlug", "==", slug)
        .where("yearMonth", "==", yearMonth)
        .get();
      const batch = db.batch();
      let hasBatchOps = false;
      for (const doc of olderSnap.docs) {
        if (doc.id !== statementId) {
          batch.update(doc.ref, { superseded: true, supersededBy: statementId });
          hasBatchOps = true;
        }
      }
      if (hasBatchOps) await batch.commit();
    }

    // ── Agent pipeline (fire-and-forget — never blocks parse response) ──────
    if (userId && slug && yearMonth) {
      runAgentPipeline(userId, statementId!, db).catch((e) =>
        console.error("[agent] Pipeline failed:", e)
      );
    }

    return NextResponse.json({ ok: true, status: "completed", accountSlug: slug });
  } catch (err) {
    console.error("Parse error:", err);

    const errMessage = err instanceof Error ? err.message : String(err);

    const isAiConfigError =
      err instanceof Error &&
      (errMessage.includes("GEMINI_API_KEY") ||
        errMessage.includes("ANTHROPIC_API_KEY") ||
        errMessage.includes("authentication method") ||
        errMessage.includes("apiKey") ||
        errMessage.includes("authToken"));

    const isFirebaseCredError = err instanceof FirebaseAdminCredentialsError;

    const code = err && typeof err === "object" ? (err as { code?: number }).code : undefined;
    const isFirestoreNotFound = code === 5;

    let friendlyMessage = ERROR_MESSAGE;
    if (isAiConfigError) {
      friendlyMessage = "AI provider API key missing or invalid. Check your environment variables.";
    } else if (isFirebaseCredError) {
      friendlyMessage = "Server setup incomplete: Firebase Admin credentials missing.";
    } else if (isFirestoreNotFound) {
      friendlyMessage = "Firestore not set up. Create a Firestore database in Firebase Console.";
    }

    // Always mark statement as error so the client stops polling
    if (statementId) {
      try {
        const { db } = getFirebaseAdmin();
        await db.collection("statements").doc(statementId).update({
          status: "error",
          errorMessage: friendlyMessage,
        });
      } catch (_) {}
    }

    return NextResponse.json({ error: friendlyMessage }, { status: isFirebaseCredError || isFirestoreNotFound ? 503 : 500 });
  }
}

// ── Agent pipeline ─────────────────────────────────────────────────────────────
// Runs after parse completes. Builds Financial DNA and generates insight cards.
// All spending/income figures are derived from ACTUAL TRANSACTION DATES —
// statements are only used as ingestion vehicles.

async function runAgentPipeline(
  uid: string,
  statementId: string,
  db: FirebaseFirestore.Firestore
): Promise<void> {
  // 1. Extract all transactions using actual transaction dates (not statement dates)
  const txData = await extractAllTransactions(uid, db);
  const { expenseTxns, incomeTxns, accountSnapshots, subscriptions, latestTxMonth, allTxMonths } = txData;

  if (!latestTxMonth) {
    // No transactions at all yet — still build DNA from balances if possible
    const allSnap = await db
      .collection("statements")
      .where("userId", "==", uid)
      .where("status", "==", "completed")
      .get();
    type DocEntry = { yearMonth: string; parsed: ParsedStatementData };
    const allDocs: DocEntry[] = [];
    for (const doc of allSnap.docs) {
      const d = doc.data();
      const parsed = d.parsedData as ParsedStatementData | undefined;
      if (!parsed) continue;
      let ym = parsed.statementDate ? getYearMonth(parsed.statementDate) : "";
      if (!ym) {
        const raw = d.uploadedAt?.toDate?.() ?? d.uploadedAt;
        if (raw) {
          const t = typeof raw === "object" && "toISOString" in raw
            ? (raw as Date).toISOString() : String(raw);
          ym = t.slice(0, 7);
        }
      }
      if (ym) allDocs.push({ yearMonth: ym, parsed });
    }
    const dna = inferFinancialDNA(allDocs);
    await db.collection("users").doc(uid).set({ financialDNA: dna }, { merge: true });
    return;
  }

  // 2. Build Financial DNA from all statements (uses statement dates for inferred profile)
  const allSnap = await db
    .collection("statements")
    .where("userId", "==", uid)
    .where("status", "==", "completed")
    .get();
  type DocEntry = { yearMonth: string; parsed: ParsedStatementData };
  const allDocs: DocEntry[] = [];
  for (const doc of allSnap.docs) {
    const d = doc.data();
    const parsed = d.parsedData as ParsedStatementData | undefined;
    if (!parsed) continue;
    let ym = parsed.statementDate ? getYearMonth(parsed.statementDate) : "";
    if (!ym) {
      const raw = d.uploadedAt?.toDate?.() ?? d.uploadedAt;
      if (raw) {
        const t = typeof raw === "object" && "toISOString" in raw
          ? (raw as Date).toISOString() : String(raw);
        ym = t.slice(0, 7);
      }
    }
    if (ym) allDocs.push({ yearMonth: ym, parsed });
  }
  const dna = inferFinancialDNA(allDocs);
  await db.collection("users").doc(uid).set({ financialDNA: dna }, { merge: true });

  // 3. Build agent context from transaction-date-based data
  const currentMonth = latestTxMonth;

  // Net worth from carry-forward account balances + manual assets/liabilities
  const [manualAssetsSnap, manualLiabSnap, goalsSnap] = await Promise.all([
    db.collection("users").doc(uid).collection("manualAssets").get(),
    db.collection("users").doc(uid).collection("manualLiabilities").get(),
    db.collection("users").doc(uid).collection("goals").get(),
  ]);
  const manualAssetsTotal = manualAssetsSnap.docs.reduce((s, d) => s + (d.data().value ?? 0), 0);
  const manualLiabTotal   = manualLiabSnap.docs.reduce((s, d) => s + (d.data().balance ?? 0), 0);
  const assetsTotal = accountSnapshots.reduce((s, a) => s + Math.max(0, a.balance), 0) + manualAssetsTotal;
  const debtsTotal  = accountSnapshots.reduce((s, a) => s + Math.max(0, -a.balance), 0) + manualLiabTotal;

  // Spending and income for current month — from actual transaction dates
  const topCategories  = categoryTotalsForMonth(expenseTxns, currentMonth).slice(0, 8);
  const monthlyIncome  = incomeTotalForMonth(incomeTxns, currentMonth);
  const monthlyExpenses = expenseTotalForMonth(expenseTxns, currentMonth);

  // Monthly trend: last 6 months by transaction date
  const recentMonths = allTxMonths.slice(-6);
  const history = buildMonthlyTrend(expenseTxns, incomeTxns, recentMonths);

  const goals = goalsSnap.docs.map((d) => {
    const g = d.data();
    return {
      title: g.title ?? "Goal",
      targetAmount: g.targetAmount ?? 0,
      currentAmount: g.currentAmount ?? 0,
      emoji: g.emoji ?? "🎯",
    };
  });

  const ctx: AgentContext = {
    dna,
    currentMonth,
    spendingMonth: currentMonth,
    netWorth: assetsTotal - debtsTotal,
    monthlyIncome,
    monthlyExpenses,
    topExpenseCategories: topCategories,
    subscriptions,
    goalsProgress: goals,
    history,
    accounts: accountSnapshots.map((a) => ({
      label: `${a.bankName}${a.accountId ? ` ••••${a.accountId.slice(-4)}` : ""}`,
      type: a.accountType,
      balance: a.balance,
      apr: a.interestRate ?? undefined,
    })),
  };

  // 4. Generate insight cards
  const cards = await generateAgentInsights(ctx, statementId);
  if (cards.length === 0) return;

  // 5. Persist cards (replace any existing undismissed cards from previous runs)
  const userRef = db.collection("users").doc(uid);
  const existingSnap = await userRef.collection("agentInsights")
    .where("dismissed", "==", false)
    .get();

  const batch = db.batch();
  for (const doc of existingSnap.docs) batch.delete(doc.ref);
  for (const card of cards) {
    batch.set(userRef.collection("agentInsights").doc(card.id), card);
  }
  await batch.commit();

  console.log(`[agent] Generated ${cards.length} insight cards for uid=${uid}`);
}
