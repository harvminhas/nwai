/**
 * Admin-only API for managing promo campaigns.
 * Only accessible to users whose email is in ADMIN_EMAILS.
 *
 * GET    — list all campaigns
 * POST   — create a new campaign
 * PATCH  — toggle active flag on an existing campaign
 */

import { NextRequest, NextResponse } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase-admin";
import { Timestamp } from "firebase-admin/firestore";

const ADMIN_EMAILS = ["harvminhas@gmail.com"];

function authToken(req: NextRequest): string | null {
  const h = req.headers.get("authorization");
  return h?.startsWith("Bearer ") ? h.slice(7) : null;
}

async function requireAdmin(token: string | null) {
  if (!token) return null;
  const { auth } = getFirebaseAdmin();
  try {
    const decoded = await auth.verifyIdToken(token);
    if (!ADMIN_EMAILS.includes(decoded.email ?? "")) return null;
    return decoded;
  } catch {
    return null;
  }
}

// ── GET — list all campaigns ──────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const admin = await requireAdmin(authToken(req));
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { db } = getFirebaseAdmin();
  const snap = await db.collection("promoCodes").orderBy("createdAt", "desc").get();

  const campaigns = snap.docs.map((d) => {
    const data = d.data();
    return {
      code:             d.id,
      active:           data.active ?? false,
      durationDays:     data.durationDays ?? 0,
      maxRedemptions:   data.maxRedemptions ?? null,
      redemptionCount:  data.redemptionCount ?? 0,
      description:      data.description ?? "",
      expiresAt:        (data.expiresAt as Timestamp | undefined)?.toDate().toISOString() ?? null,
    };
  });

  return NextResponse.json({ campaigns });
}

// ── POST — create a new campaign ──────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const admin = await requireAdmin(authToken(req));
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const code = (body.code as string | undefined)?.toUpperCase().trim();
  if (!code) return NextResponse.json({ error: "Code is required" }, { status: 400 });

  const durationDays   = Number(body.durationDays ?? 90);
  const maxRedemptions = Number(body.maxRedemptions ?? 0);
  const description    = (body.description as string | undefined)?.trim() ?? "";

  if (!description) return NextResponse.json({ error: "Description is required" }, { status: 400 });
  if (durationDays <= 0) return NextResponse.json({ error: "durationDays must be > 0" }, { status: 400 });

  const { db } = getFirebaseAdmin();
  const ref = db.collection("promoCodes").doc(code);
  const existing = await ref.get();
  if (existing.exists) {
    return NextResponse.json({ error: `Code "${code}" already exists.` }, { status: 409 });
  }

  await ref.set({
    active:           true,
    plan:             "pro",
    durationDays,
    maxRedemptions:   maxRedemptions > 0 ? maxRedemptions : null,
    redemptionCount:  0,
    description,
    expiresAt:        null,
    createdAt:        Timestamp.now(),
    createdBy:        admin.email ?? admin.uid,
  });

  console.log(`[admin/promo-campaigns] created code=${code} by=${admin.email}`);
  return NextResponse.json({ ok: true, code });
}

// ── PATCH — toggle active / update fields ────────────────────────────────────

export async function PATCH(req: NextRequest) {
  const admin = await requireAdmin(authToken(req));
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const code = (body.code as string | undefined)?.toUpperCase().trim();
  if (!code) return NextResponse.json({ error: "Code is required" }, { status: 400 });

  const { db } = getFirebaseAdmin();
  const ref = db.collection("promoCodes").doc(code);
  const snap = await ref.get();
  if (!snap.exists) return NextResponse.json({ error: "Code not found" }, { status: 404 });

  const updates: Record<string, unknown> = {};
  if (typeof body.active === "boolean") updates.active = body.active;
  if (typeof body.durationDays === "number") updates.durationDays = body.durationDays;
  if (typeof body.maxRedemptions === "number") updates.maxRedemptions = body.maxRedemptions > 0 ? body.maxRedemptions : null;

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  await ref.update(updates);

  console.log(`[admin/promo-campaigns] updated code=${code} updates=${JSON.stringify(updates)} by=${admin.email}`);
  return NextResponse.json({ ok: true });
}
