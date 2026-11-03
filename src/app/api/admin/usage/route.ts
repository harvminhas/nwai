/**
 * Admin usage endpoint: user stats and AI cost estimates.
 * GET /api/admin/usage?month=YYYY-MM (defaults to current month)
 * 
 * Requires: email === 'harvminhas@gmail.com' && email_verified
 */

import { NextRequest, NextResponse } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase-admin";
import { authBearerToken, requireAdminDecoded } from "@/lib/adminAuth";
import { resolvePlan } from "@/app/api/user/plan/route";
import { COST_PER_STATEMENT_USD, COST_PER_ASK_USD } from "@/lib/aiCostEstimate";

export interface AdminUsageRow {
  uid: string;
  email: string;
  plan: string;
  signupDate: string | null;
  totalStatements: number;
  statementsThisMonth: number;
  asksThisMonth: number;
  estimatedCost: number;
}

export interface AdminUsageSummary {
  month: string;
  totalUsers: number;
  totalStatements: number;
  totalAsks: number;
  totalEstimatedCost: number;
  users: AdminUsageRow[];
}

function getCurrentMonth(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

export async function GET(req: NextRequest) {
  // Require admin with verified email
  const decoded = await requireAdminDecoded(authBearerToken(req));
  if (!decoded) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  
  // Extra check: require email_verified
  if (!decoded.email_verified) {
    return NextResponse.json({ error: "Email not verified" }, { status: 403 });
  }

  // Require exact email match
  if (decoded.email !== "harvminhas@gmail.com") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { auth, db } = getFirebaseAdmin();
  
  // Parse month parameter (default to current month)
  const url = new URL(req.url);
  const month = url.searchParams.get("month") || getCurrentMonth();

  // Parse month to get date range
  const [year, monthNum] = month.split("-").map(Number);
  const monthStart = new Date(Date.UTC(year, monthNum - 1, 1));
  const monthEnd = new Date(Date.UTC(year, monthNum, 1));

  // 1. Get all Firebase Auth users
  const usersMap = new Map<string, {
    email: string;
    createdAt: string | null;
    totalStatements: number;
    statementsThisMonth: number;
  }>();

  let pageToken: string | undefined;
  const maxUsers = 25000;
  
  do {
    const page = await auth.listUsers(1000, pageToken);
    for (const u of page.users) {
      usersMap.set(u.uid, {
        email: u.email || "no-email",
        createdAt: u.metadata.creationTime || null,
        totalStatements: 0,
        statementsThisMonth: 0,
      });
    }
    pageToken = page.pageToken;
    if (usersMap.size >= maxUsers) break;
  } while (pageToken);

  // 2. Count statements (all time and this month)
  const statementsSnap = await db.collection("statements").get();
  
  for (const doc of statementsSnap.docs) {
    const d = doc.data();
    const uid = typeof d.userId === "string" ? d.userId : "";
    if (!uid || !usersMap.has(uid)) continue;

    const user = usersMap.get(uid)!;
    user.totalStatements += 1;

    // Check if uploaded this month
    const uploadedAt = d.uploadedAt?.toDate?.() || d.uploadedAt;
    if (uploadedAt instanceof Date) {
      if (uploadedAt >= monthStart && uploadedAt < monthEnd) {
        user.statementsThisMonth += 1;
      }
    }
  }

  // 3. Get AI usage for the selected month (from aiUsage subcollection)
  const asksMap = new Map<string, number>();
  
  for (const uid of usersMap.keys()) {
    const usageDoc = await db
      .collection("users")
      .doc(uid)
      .collection("aiUsage")
      .doc(month)
      .get();
    
    if (usageDoc.exists) {
      const data = usageDoc.data();
      asksMap.set(uid, data?.count || 0);
    }
  }

  // 4. Build rows with plan info
  const rows: AdminUsageRow[] = [];
  
  for (const [uid, user] of usersMap.entries()) {
    const asksThisMonth = asksMap.get(uid) || 0;
    const estimatedCost = 
      (user.statementsThisMonth * COST_PER_STATEMENT_USD) +
      (asksThisMonth * COST_PER_ASK_USD);

    // Get plan (uses existing resolvePlan logic)
    const userDoc = await db.collection("users").doc(uid).get();
    const userData = userDoc.data();
    const planId = resolvePlan(userData);

    rows.push({
      uid,
      email: user.email,
      plan: planId || "free",
      signupDate: user.createdAt,
      totalStatements: user.totalStatements,
      statementsThisMonth: user.statementsThisMonth,
      asksThisMonth,
      estimatedCost,
    });
  }

  // Sort by email
  rows.sort((a, b) => a.email.localeCompare(b.email));

  // 5. Calculate totals
  const totalStatements = rows.reduce((sum, r) => sum + r.statementsThisMonth, 0);
  const totalAsks = rows.reduce((sum, r) => sum + r.asksThisMonth, 0);
  const totalEstimatedCost = rows.reduce((sum, r) => sum + r.estimatedCost, 0);

  const summary: AdminUsageSummary = {
    month,
    totalUsers: rows.length,
    totalStatements,
    totalAsks,
    totalEstimatedCost,
    users: rows,
  };

  return NextResponse.json(summary);
}
