import { NextRequest, NextResponse } from "next/server";
import {
  getFirebaseAdmin,
  FirebaseAdminCredentialsError,
  getStorageBucketName,
} from "@/lib/firebase-admin";
import {
  parseStatementImage,
  parseStatementPdf,
  parseStatementCsv,
} from "@/lib/parseStatement";
import { merchantSlug, applyRulesAndRecalculate } from "@/lib/applyRules";
import { getYearMonth } from "@/lib/consolidate";

function computeAccountSlug(parsed: { bankName?: string; accountId?: string }): string {
  const bank = (parsed.bankName ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const acct = (parsed.accountId ?? "unknown").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return acct !== "unknown" ? `${bank}-${acct}` : bank;
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

    let parsedData: Awaited<ReturnType<typeof parseStatementImage>>;

    const treatAsCsv =
      fileName.endsWith(".csv") || contentType.includes("csv");

    if (contentType.includes("pdf") || isPdfBuffer(buffer)) {
      parsedData = await parseStatementPdf(base64);
    } else if (treatAsCsv) {
      const text = buffer.toString("utf8");
      if (text.length < 20) {
        await statementRef.update({
          status: "error",
          errorMessage: "CSV file is empty or too small.",
        });
        return NextResponse.json({ error: "Invalid CSV" }, { status: 400 });
      }
      parsedData = await parseStatementCsv(text);
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

    return NextResponse.json({ ok: true, status: "completed" });
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
