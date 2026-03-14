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
import { AnthropicConfigError } from "@/lib/anthropic";

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

    await statementRef.update({
      parsedData,
      status: "completed",
      errorMessage: null,
    });

    return NextResponse.json({ ok: true, status: "completed" });
  } catch (err) {
    console.error("Parse error:", err);
    const isAnthropicAuthError =
      err instanceof AnthropicConfigError ||
      (err &&
        typeof err === "object" &&
        typeof (err as Error).message === "string" &&
        ((err as Error).message.includes("authentication method") ||
          (err as Error).message.includes("apiKey") ||
          (err as Error).message.includes("authToken")));
    if (isAnthropicAuthError) {
      return NextResponse.json(
        {
          error:
            "Anthropic API key missing or invalid. Set ANTHROPIC_API_KEY in .env.local (get a key at https://console.anthropic.com/) and restart the dev server.",
        },
        { status: 503 }
      );
    }
    if (err instanceof FirebaseAdminCredentialsError) {
      return NextResponse.json(
        {
          error:
            "Server setup incomplete: Firebase Admin credentials missing. Add FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY to .env.local.",
        },
        { status: 503 }
      );
    }
    const code = err && typeof err === "object" ? (err as { code?: number }).code : undefined;
    if (code === 5) {
      return NextResponse.json(
        {
          error:
            "Firestore not set up. Create a Firestore database in Firebase Console (Build → Firestore Database → Create database).",
        },
        { status: 503 }
      );
    }
    if (statementId) {
      try {
        const { db } = getFirebaseAdmin();
        await db.collection("statements").doc(statementId).update({
          status: "error",
          errorMessage: ERROR_MESSAGE,
        });
      } catch (_) {}
    }
    return NextResponse.json(
      { error: ERROR_MESSAGE },
      { status: 500 }
    );
  }
}
