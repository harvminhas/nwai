import { NextRequest, NextResponse } from "next/server";
import { getFirebaseAdmin, getStorageBucketName } from "@/lib/firebase-admin";
import { sendPdfRequest, sendVisionRequest } from "@/lib/ai";
import { SYSTEM_PROMPT, extractJson } from "@/lib/parseStatement";

export const maxDuration = 120;

export async function POST(request: NextRequest) {
  const token = request.headers.get("authorization")?.replace("Bearer ", "");
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { auth, db, storage } = getFirebaseAdmin();
    const decoded = await auth.verifyIdToken(token);
    const uid = decoded.uid;

    const body = await request.json().catch(() => ({}));
    const { statementId } = body as { statementId?: string };
    if (!statementId) {
      return NextResponse.json({ error: "statementId is required" }, { status: 400 });
    }

    const doc = await db.collection("statements").doc(statementId).get();
    if (!doc.exists) return NextResponse.json({ error: "Statement not found" }, { status: 404 });

    const data = doc.data()!;
    if (data.userId !== uid) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const fileUrl = data.fileUrl as string | undefined;
    if (!fileUrl) return NextResponse.json({ error: "No file attached" }, { status: 400 });

    const bucketName = (data.storageBucket as string | undefined) || getStorageBucketName();
    const [contents] = await storage.bucket(bucketName).file(fileUrl).download();
    const base64 = Buffer.from(contents).toString("base64");

    const contentType = (data.contentType as string | undefined)?.toLowerCase() || "";
    const fileName    = (data.fileName    as string | undefined)?.toLowerCase() || "";
    const isPdf = fileName.endsWith(".pdf") || contentType.includes("pdf");

    const userPrompt = isPdf
      ? "Analyze this bank statement PDF and return the JSON now."
      : "Analyze this bank statement image and return the JSON now.";

    let rawResponse = "";
    let parseError  = "";
    let parsed: unknown = null;

    try {
      if (isPdf) {
        rawResponse = await sendPdfRequest(SYSTEM_PROMPT, userPrompt, base64);
      } else {
        const mediaType = contentType.includes("png") ? "image/png"
          : contentType.includes("gif") ? "image/gif"
          : contentType.includes("webp") ? "image/webp"
          : "image/jpeg";
        rawResponse = await sendVisionRequest(SYSTEM_PROMPT, userPrompt, base64, mediaType);
      }
    } catch (err) {
      parseError = err instanceof Error ? err.message : String(err);
    }

    // Try to parse the raw JSON using the same repair-aware extractor as the main parser
    if (rawResponse) {
      try {
        parsed = JSON.parse(extractJson(rawResponse));
      } catch (err) {
        parseError = (parseError ? parseError + "\n" : "") +
          "JSON parse error: " + (err instanceof Error ? err.message : String(err));
      }
    }

    return NextResponse.json({
      statementId,
      fileName: data.fileName ?? "",
      systemPrompt: SYSTEM_PROMPT,
      rawResponse,
      parsed,
      parseError: parseError || null,
    });
  } catch (err) {
    console.error("[debug/parse]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
