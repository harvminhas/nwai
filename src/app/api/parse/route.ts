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
import { TransientAiError } from "@/lib/gemini-provider";
import { merchantSlug, applyRulesAndRecalculate } from "@/lib/applyRules";
import { buildAccountSlug } from "@/lib/accountSlug";
import { getYearMonth } from "@/lib/consolidate";
import { fireInsightEvent } from "@/lib/insights/index";
import { invalidateFinancialProfileCache } from "@/lib/financialProfile";
import { inferCurrencyFromBankName } from "@/lib/currencyUtils";
import type { ParsedStatementData } from "@/lib/types";

export const maxDuration = 120;

function computeAccountSlug(parsed: { bankName?: string; accountId?: string; accountName?: string; accountType?: string }): string {
  return buildAccountSlug(parsed.bankName, parsed.accountId, parsed.accountName, parsed.accountType);
}

const ERROR_MESSAGE =
  "We couldn't read this statement. Try a clearer image or different format.";

function isPdfBuffer(buf: Buffer): boolean {
  return buf.length >= 4 && buf.slice(0, 4).toString("ascii") === "%PDF";
}

export async function POST(request: NextRequest) {
  let statementId: string | undefined;
  // Declared outside try so the catch block can capture whatever the AI returned
  let partialParsedData: Awaited<ReturnType<typeof parseStatementImage>> | undefined;
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
        status: "needs_review",
        parseError: ERROR_MESSAGE,
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
        status: "needs_review",
        parseError: "CSV files are not supported. Please upload a PDF or photo of your bank statement.",
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
    // Capture AI result so the catch block can persist partial data if something
    // downstream (Firestore writes, slug logic, etc.) throws unexpectedly.
    partialParsedData = parsedData;

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

    // ── Account ID: generate a stable synthetic ID when none was extracted ──────
    // When there is no real account number, we generate a short alphanumeric ID
    // (starts with a letter so it's distinguishable from real 4-digit card numbers)
    // and persist it per user per bank+type. Every subsequent upload of the same
    // account automatically reuses it — no changes needed in any data builder.
    // bankTypeKey is the bank+type fallback slug used as the override map key.
    const bankTypeKey = computeAccountSlug({ ...parsedData, accountId: undefined });
    const hasRealAccountId = !!parsedData.accountId;
    let accountConfirmNeeded = false;
    let existingAccounts: { slug: string; label: string }[] = [];
    let suggestedSlug: string | undefined;

    if (!hasRealAccountId && userId) {
      const overrideRef = db.collection(`users/${userId}/accountSlugOverrides`).doc(bankTypeKey);
      const overrideDoc = await overrideRef.get();

      let syntheticId: string;
      if (overrideDoc.exists && overrideDoc.data()?.confirmedAccountId) {
        // Reuse the previously confirmed account ID as the default
        syntheticId = overrideDoc.data()!.confirmedAccountId as string;
        // Pre-select the previously confirmed account in the modal — stored override
        // takes priority over fuzzy matching which runs later as a fallback only.
        if (overrideDoc.data()?.confirmedSlug) {
          suggestedSlug = overrideDoc.data()!.confirmedSlug as string;
        }
      } else {
        // First time seeing this bank+type — generate and persist a stable ID
        syntheticId = "s" + Math.random().toString(36).slice(2, 5);
        await overrideRef.set({ confirmedAccountId: syntheticId }, { merge: true });
      }
      parsedData = { ...parsedData, accountId: syntheticId };
      // Always show the confirm prompt when no real account number was found —
      // the override pre-selects the best option but the user always confirms.
      accountConfirmNeeded = true;
    }

    // Compute slug from (possibly patched) parsedData — now always stable
    const slug = computeAccountSlug(parsedData);
    const yearMonth = parsedData.statementDate ? getYearMonth(parsedData.statementDate) : null;
    const slugIsAccountNumber = /^\d{4}$/.test(slug ?? "");

    // ── New-account detection — check before writing "completed" so we can
    // include backfillPromptNeeded in the SAME update. A separate update would
    // race against the onSnapshot listener and the flag could arrive after the
    // listener has already unsubscribed following the "completed" event.
    let backfillPromptNeeded = false;
    let backfillOldestMonth: string | null = null;
    const inferredCurrency = inferCurrencyFromBankName(parsedData.bankName, parsedData.currency);
    if (userId && slug) {
      try {
        const allUserStmts = await db
          .collection("statements")
          .where("userId", "==", userId)
          .where("status", "==", "completed")
          .get();

        // Build existing accounts list (shown in prompt when accountConfirmNeeded)
        if (accountConfirmNeeded) {
          type Candidate = { slug: string; label: string; yearMonth: string; isAcctNum: boolean };
          const byNormLabel = new Map<string, Candidate>();
          for (const d of allUserStmts.docs) {
            const dd = d.data();
            const s  = dd.accountSlug as string | undefined;
            if (!s) continue;
            const p = dd.parsedData as Record<string, unknown> | undefined;
            const label =
              (p?.accountName as string | undefined) ||
              `${p?.bankName ?? ""} ${p?.accountType ?? ""}`.trim() ||
              s;
            const normLabel = label.toLowerCase().replace(/[®™\s]+/g, " ").replace(/[^a-z0-9 ]/g, "").trim();
            const isAcctNum = /^\d{4}$/.test(s);
            const ym        = (dd.yearMonth as string) ?? "";
            const existing  = byNormLabel.get(normLabel);
            if (!existing) {
              byNormLabel.set(normLabel, { slug: s, label, yearMonth: ym, isAcctNum });
            } else {
              const betterAcctNum = isAcctNum && !existing.isAcctNum;
              const moreRecent    = isAcctNum === existing.isAcctNum && ym > existing.yearMonth;
              if (betterAcctNum || moreRecent) byNormLabel.set(normLabel, { slug: s, label, yearMonth: ym, isAcctNum });
            }
          }
          const bySlug = new Map<string, Candidate>();
          for (const c of byNormLabel.values()) {
            const prev = bySlug.get(c.slug);
            if (!prev) { bySlug.set(c.slug, c); continue; }
            const betterAcctNum = c.isAcctNum && !prev.isAcctNum;
            const moreRecent    = c.isAcctNum === prev.isAcctNum && c.yearMonth > prev.yearMonth;
            if (betterAcctNum || moreRecent) bySlug.set(c.slug, c);
          }
          existingAccounts = Array.from(bySlug.values())
            .map(({ slug: s, label }) => ({ slug: s, label }))
            .sort((a, b) => a.label.localeCompare(b.label));

          // Fuzzy pre-selection
          const bankNorm = (parsedData.bankName ?? "").toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
          const acctNorm = (parsedData.accountName ?? "").toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
          const match = existingAccounts.find((a) => {
            const lbl = a.label.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
            return (bankNorm.length > 2 && lbl.includes(bankNorm)) ||
                   (acctNorm.length > 4 && (lbl.includes(acctNorm) || acctNorm.includes(lbl)));
          });
          if (!suggestedSlug && match) suggestedSlug = match.slug;
        }

        const effectiveSlug = slug;
        const existingSlugs = new Set(
          allUserStmts.docs.map((d) => d.data().accountSlug as string).filter(Boolean)
        );
        // isFirstForSlug: this account has never had a completed statement before
        const isFirstForSlug = !existingSlugs.has(effectiveSlug);

        if (isFirstForSlug) {
          backfillPromptNeeded = true;
          const allMonths = allUserStmts.docs
            .map((d) => d.data().yearMonth as string)
            .filter(Boolean)
            .sort();
          backfillOldestMonth = allMonths[0] ?? null;
        }

        // When there IS a real account ID but the slug is new (e.g. first upload had no
        // account number so slug was bank-type, now a real last-4 slug appears), check
        // for a fuzzy bank+type match against existing accounts so the user can confirm
        // "add to existing" and skip the backfill currency/age questions entirely.
        if (!accountConfirmNeeded && isFirstForSlug && allUserStmts.docs.length > 0) {
          type Candidate = { slug: string; label: string; yearMonth: string; isAcctNum: boolean };
          const byNormLabel2 = new Map<string, Candidate>();
          for (const d of allUserStmts.docs) {
            const dd = d.data();
            const s  = dd.accountSlug as string | undefined;
            if (!s) continue;
            const p = dd.parsedData as Record<string, unknown> | undefined;
            const label =
              (p?.accountName as string | undefined) ||
              `${p?.bankName ?? ""} ${p?.accountType ?? ""}`.trim() ||
              s;
            const normLabel = label.toLowerCase().replace(/[®™\s]+/g, " ").replace(/[^a-z0-9 ]/g, "").trim();
            const isAcctNum = /^\d{4}$/.test(s);
            const ym        = (dd.yearMonth as string) ?? "";
            const existing  = byNormLabel2.get(normLabel);
            if (!existing) {
              byNormLabel2.set(normLabel, { slug: s, label, yearMonth: ym, isAcctNum });
            } else {
              const betterAcctNum = isAcctNum && !existing.isAcctNum;
              const moreRecent    = isAcctNum === existing.isAcctNum && ym > existing.yearMonth;
              if (betterAcctNum || moreRecent) byNormLabel2.set(normLabel, { slug: s, label, yearMonth: ym, isAcctNum });
            }
          }
          const bySlug2 = new Map<string, Candidate>();
          for (const c of byNormLabel2.values()) {
            const prev = bySlug2.get(c.slug);
            if (!prev) { bySlug2.set(c.slug, c); continue; }
            if ((c.isAcctNum && !prev.isAcctNum) || (c.isAcctNum === prev.isAcctNum && c.yearMonth > prev.yearMonth))
              bySlug2.set(c.slug, c);
          }
          const candidates = Array.from(bySlug2.values())
            .map(({ slug: s, label }) => ({ slug: s, label }))
            .sort((a, b) => a.label.localeCompare(b.label));

          const bankNorm2 = (parsedData.bankName ?? "").toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
          const acctNorm2 = (parsedData.accountName ?? "").toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
          const match2 = candidates.find((a) => {
            const lbl = a.label.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
            return (bankNorm2.length > 2 && lbl.includes(bankNorm2)) ||
                   (acctNorm2.length > 4 && (lbl.includes(acctNorm2) || acctNorm2.includes(lbl)));
          });

          // Only prompt if there's a likely match — avoids nagging for truly new accounts.
          // backfillPromptNeeded stays true so that if user picks "New account", the
          // currency/age steps still follow.
          if (match2) {
            accountConfirmNeeded = true;
            existingAccounts = candidates;
            suggestedSlug = match2.slug;
          }
        }
      } catch (e) {
        console.error("[parse] backfill detection failed:", e);
      }
    }

    await statementRef.update({
      parsedData,
      status: "completed",
      errorMessage: null,
      accountSlug: slug,
      yearMonth: yearMonth ?? null,
      slugIsAccountNumber,
      // Included in this same write so the onSnapshot fires with all fields set:
      ...(accountConfirmNeeded && {
        accountConfirmNeeded: true,
        bankTypeKey,   // bank+type key used as the override map key
        existingAccounts,
        ...(suggestedSlug ? { suggestedSlug } : {}),
      }),
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

    const isTransientAiError = err instanceof TransientAiError;

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
    if (isTransientAiError) {
      friendlyMessage = "AI is temporarily unavailable due to high demand. Please try again in a few minutes.";
    } else if (isAiConfigError) {
      friendlyMessage = "AI provider API key missing or invalid. Check your environment variables.";
    } else if (isFirebaseCredError) {
      friendlyMessage = "Server setup incomplete: Firebase Admin credentials missing.";
    } else if (isFirestoreNotFound) {
      friendlyMessage = "Firestore not set up. Create a Firestore database in Firebase Console.";
    }

    // Transient AI errors and config errors are temporary — keep as "error" so
    // the user sees "Retry" rather than being asked to enter data manually.
    // Genuine parse failures go to "needs_review" so the user can fill in the
    // fields themselves from the statement detail page.
    // IMPORTANT: never overwrite a document that is already "completed".
    if (statementId) {
      try {
        const { db } = getFirebaseAdmin();
        const ref = db.collection("statements").doc(statementId);
        const snap = await ref.get();
        const currentStatus = snap.exists ? (snap.data()?.status as string | undefined) : undefined;
        if (currentStatus !== "completed") {
          const isRetryable = isTransientAiError || isAiConfigError || isFirebaseCredError || isFirestoreNotFound;
          if (isRetryable) {
            await ref.update({ status: "error", errorMessage: friendlyMessage });
          } else {
            await ref.update({
              status: "needs_review",
              parseError: friendlyMessage,
              ...(partialParsedData ? { partialParsedData } : {}),
            });
          }
        }
      } catch (_) {}
    }

    return NextResponse.json({ error: friendlyMessage }, { status: isFirebaseCredError || isFirestoreNotFound ? 503 : 500 });
  }
}
