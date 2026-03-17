/**
 * GET /api/user/account-rates/history?accountKey=xxx
 * Returns the user-saved APR change history for an account.
 * AI-extracted history is derived separately from accountStatementHistory on the client.
 */
import { NextRequest, NextResponse } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase-admin";

function authToken(req: NextRequest): string | null {
  const h = req.headers.get("authorization");
  return h?.startsWith("Bearer ") ? h.slice(7) : null;
}

export interface RateHistoryEntry {
  rate: number;
  source: "user" | "ai";
  changedAt: string; // ISO date string
  note: string | null;
}

export async function GET(req: NextRequest) {
  const token = authToken(req);
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const accountKey = searchParams.get("accountKey");
  if (!accountKey) return NextResponse.json({ error: "accountKey required" }, { status: 400 });

  try {
    const { auth, db } = getFirebaseAdmin();
    const { uid } = await auth.verifyIdToken(token);

    const snap = await db
      .collection("users").doc(uid)
      .collection("accountRates").doc(accountKey)
      .collection("history")
      .orderBy("changedAt", "desc")
      .get();

    const entries: RateHistoryEntry[] = snap.docs.map((d) => {
      const data = d.data();
      return {
        rate: data.rate as number,
        source: (data.source as "user" | "ai") ?? "user",
        changedAt: data.changedAt?.toDate?.()?.toISOString?.() ?? new Date().toISOString(),
        note: data.note ?? null,
      };
    });

    return NextResponse.json({ history: entries });
  } catch (err) {
    console.error("GET /api/user/account-rates/history error:", err);
    return NextResponse.json({ error: "Failed to load rate history" }, { status: 500 });
  }
}
