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
import { fireInsightEvent } from "@/lib/insights/index";
import { invalidateFinancialProfileCache } from "@/lib/financialProfile";
import { inferCurrencyFromBankName } from "@/lib/currencyUtils";
import type { ParsedStatementData } from "@/lib/types";

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

    // ── New-account detection — check before writing "completed" so we can
    // include backfillPromptNeeded in the SAME update. A separate update would
    // race against the onSnapshot listener and the flag could arrive after the
    // listener has already unsubscribed following the "completed" event.
    let backfillPromptNeeded = false;
    let backfillOldestMonth: string | null = null;
    // inferredCurrency: best-guess currency for the new account.
    // The user confirms or overrides this in the currency prompt.
    const inferredCurrency = inferCurrencyFromBankName(parsedData.bankName, parsedData.currency);
    if (userId && slug) {
      try {
        const allUserStmts = await db
          .collection("statements")
          .where("userId", "==", userId)
          .where("status", "==", "completed")
          .select("accountSlug", "yearMonth")
          .get();

        const existingSlugs = new Set(
          allUserStmts.docs
            .map((d) => d.data().accountSlug as string)
            .filter(Boolean)
        );
        // isFirstForSlug: this account has never had a completed statement before
        const isFirstForSlug = !existingSlugs.has(slug);

        if (isFirstForSlug) {
          backfillPromptNeeded = true;
          // Oldest month across all other completed statements — used for the
          // ">6 months" age bucket to know how far back to estimate.
          const allMonths = allUserStmts.docs
            .map((d) => d.data().yearMonth as string)
            .filter(Boolean)
            .sort();
          backfillOldestMonth = allMonths[0] ?? null;
        }
      } catch (e) {
        console.error("[parse] backfill detection failed:", e);
      }
    }

    // True when the slug is a 4-digit account number (not a bank-name fallback).
    // Used by the client to tailor the soft-duplicate advisory message.
    const slugIsAccountNumber = /^\d{4}$/.test(slug ?? "");

    await statementRef.update({
      parsedData,
      status: "completed",
      errorMessage: null,
      accountSlug: slug,
      yearMonth: yearMonth ?? null,
      slugIsAccountNumber,
      // Included in this same write so the onSnapshot fires with all fields set:
      ...(backfillPromptNeeded && {
        backfillPromptNeeded: true,
        backfillOldestMonth,
        inferredCurrency,
      }),
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

    // Await cache invalidation so the stale cache is gone before we respond.
    // The client's next data fetch will always see fresh data.
    if (userId) {
      await invalidateFinancialProfileCache(userId, db);
    }

    // Fire insight event — fire-and-forget, never blocks the parse response.
    if (userId) {
      fireInsightEvent({ type: "statement.parsed", meta: { statementId } }, userId, db)
        .catch((e) => console.error("[insights] statement.parsed event failed:", e));
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

    // Mark statement as error so the client stops polling.
    // IMPORTANT: only overwrite if the document is NOT already "completed" —
    // a failed re-parse must never destroy previously-parsed good data.
    if (statementId) {
      try {
        const { db } = getFirebaseAdmin();
        const ref = db.collection("statements").doc(statementId);
        const snap = await ref.get();
        const currentStatus = snap.exists ? (snap.data()?.status as string | undefined) : undefined;
        if (currentStatus !== "completed") {
          await ref.update({ status: "error", errorMessage: friendlyMessage });
        }
      } catch (_) {}
    }

    return NextResponse.json({ error: friendlyMessage }, { status: isFirebaseCredError || isFirestoreNotFound ? 503 : 500 });
  }
}