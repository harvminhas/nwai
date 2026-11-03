/**
 * Manage account status (mark paid off, reopen, close).
 * 
 * POST /api/user/account-status
 * Body: { accountSlug: string, status: "open" | "paid_off" | "closed", statusDate: "YYYY-MM-DD" }
 */

import { NextRequest, NextResponse } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase-admin";
import { setAccountStatus, getAccountStatus, type AccountStatus } from "@/lib/accountStatus";
import { invalidateFinancialProfileCache } from "@/lib/financialProfile";

function authToken(req: NextRequest): string | null {
  const h = req.headers.get("authorization");
  return h?.startsWith("Bearer ") ? h.slice(7) : null;
}

export async function POST(req: NextRequest) {
  const token = authToken(req);
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { auth, db } = getFirebaseAdmin();
  let decoded;
  try {
    decoded = await auth.verifyIdToken(token);
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await req.json();
  const { accountSlug, status, statusDate } = body;

  // Validate inputs
  if (!accountSlug || typeof accountSlug !== "string") {
    return NextResponse.json({ error: "accountSlug required" }, { status: 400 });
  }

  if (!["open", "paid_off", "closed"].includes(status)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }

  if (!statusDate || !/^\d{4}-\d{2}-\d{2}$/.test(statusDate)) {
    return NextResponse.json({ error: "statusDate required (YYYY-MM-DD)" }, { status: 400 });
  }

  // Set the status
  await setAccountStatus(
    decoded.uid,
    {
      accountSlug,
      status: status as AccountStatus,
      statusDate,
      statusSource: "user",
      updatedAt: new Date().toISOString(),
    },
    db
  );

  // Invalidate financial profile cache so changes take effect immediately
  await invalidateFinancialProfileCache(decoded.uid, db);

  return NextResponse.json({ success: true });
}

export async function GET(req: NextRequest) {
  const token = authToken(req);
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { auth, db } = getFirebaseAdmin();
  let decoded;
  try {
    decoded = await auth.verifyIdToken(token);
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const accountSlug = url.searchParams.get("accountSlug");

  if (!accountSlug) {
    return NextResponse.json({ error: "accountSlug required" }, { status: 400 });
  }

  const status = await getAccountStatus(decoded.uid, accountSlug, db);
  
  return NextResponse.json({ 
    status: status?.status ?? "open",
    statusDate: status?.statusDate,
    statusSource: status?.statusSource,
  });
}
