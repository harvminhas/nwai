/**
 * POST /api/cron/refresh-external-data
 *
 * Fetches all due external data sources and pushes personalized insight cards
 * to relevant users.
 *
 * Security: requires a valid Firebase ID token belonging to an admin email.
 * Trigger manually from the app (debug page) or via any HTTP scheduler passing
 * the user's Bearer token.
 */

import { NextRequest, NextResponse } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase-admin";
import { runExternalDataPipeline } from "@/lib/external/pipeline";

export const maxDuration = 120;

const ALLOWED_EMAILS = ["harvminhas@gmail.com"];

export async function POST(request: NextRequest) {
  const token = request.headers.get("authorization")?.replace("Bearer ", "").trim();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { auth, db: adminDb } = getFirebaseAdmin();
  let email: string | undefined;
  try {
    const decoded = await auth.verifyIdToken(token);
    email = decoded.email;
  } catch {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }

  if (!email || !ALLOWED_EMAILS.includes(email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const db = adminDb;

  try {

    // Collect all active user IDs (users who have at least one completed statement)
    const stmtSnap = await db
      .collection("statements")
      .where("status", "==", "completed")
      .select("userId") // fetch only the userId field
      .get();

    const allUids = Array.from(
      new Set(stmtSnap.docs.map((d) => d.data().userId as string).filter(Boolean))
    );

    console.log(`[cron/external] running for ${allUids.length} users`);

    const result = await runExternalDataPipeline(allUids, db);

    return NextResponse.json({
      ok: true,
      users: allUids.length,
      ...result,
    });
  } catch (err) {
    console.error("[cron/external] error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
