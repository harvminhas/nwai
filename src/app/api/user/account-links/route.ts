/**
 * GET    /api/user/account-links?accountSlug=xxx       — get links for one account
 * POST   /api/user/account-links                        — add/update link on an account
 * DELETE /api/user/account-links                        — remove a link from an account
 */

import { NextRequest, NextResponse } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase-admin";
import { resolveAccess } from "@/lib/access/resolveAccess";
import { invalidateFinancialProfileCache } from "@/lib/financialProfile";
import type { AccountLinks, HubLink } from "@/lib/types";

export async function GET(req: NextRequest) {
  const { db } = getFirebaseAdmin();
  const access = await resolveAccess(req, db);
  if (!access) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { targetUid } = access;

  const accountSlug = new URL(req.url).searchParams.get("accountSlug");
  if (!accountSlug) return NextResponse.json({ error: "accountSlug required" }, { status: 400 });

  const snap = await db.doc(`users/${targetUid}/accountLinks/${accountSlug}`).get();
  const data = snap.exists ? (snap.data() as AccountLinks) : null;
  return NextResponse.json({ links: data?.links ?? [] });
}

export async function POST(req: NextRequest) {
  const { db } = getFirebaseAdmin();
  const access = await resolveAccess(req, db);
  if (!access) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { targetUid } = access;

  try {
    const body = await req.json() as {
      accountSlug: string;
      hubId: string;
      role: string;
    };

    if (!body.accountSlug || !body.hubId || !body.role) {
      return NextResponse.json({ error: "accountSlug, hubId, and role are required" }, { status: 400 });
    }

    const validRoles = ["finances", "secures", "funds", "spend_on", "grouped_under"];
    if (!validRoles.includes(body.role)) {
      return NextResponse.json({ error: `Invalid role. Must be one of: ${validRoles.join(", ")}` }, { status: 400 });
    }

    const ref = db.doc(`users/${targetUid}/accountLinks/${body.accountSlug}`);
    const now = new Date().toISOString();

    const snap = await ref.get();
    const existing = snap.exists ? (snap.data() as AccountLinks) : null;
    const links = existing?.links ?? [];

    // Check if this link already exists
    const alreadyLinked = links.some((l) => l.hubId === body.hubId && l.role === body.role);
    if (alreadyLinked) {
      return NextResponse.json({ error: "This link already exists" }, { status: 400 });
    }

    const newLink: HubLink = {
      hubId: body.hubId,
      role: body.role as HubLink["role"],
      createdAt: now,
    };

    const updated: AccountLinks = {
      accountSlug: body.accountSlug,
      links: [...links, newLink],
      updatedAt: now,
    };

    await ref.set(updated);
    await invalidateFinancialProfileCache(targetUid, db);

    return NextResponse.json({ ok: true, links: updated.links });
  } catch (err) {
    console.error("[account-links] POST error", err);
    return NextResponse.json({ error: "Failed to create link" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const { db } = getFirebaseAdmin();
  const access = await resolveAccess(req, db);
  if (!access) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { targetUid } = access;

  try {
    const body = await req.json() as {
      accountSlug: string;
      hubId: string;
      role: string;
    };

    if (!body.accountSlug || !body.hubId || !body.role) {
      return NextResponse.json({ error: "accountSlug, hubId, and role are required" }, { status: 400 });
    }

    const ref = db.doc(`users/${targetUid}/accountLinks/${body.accountSlug}`);
    const snap = await ref.get();
    
    if (!snap.exists) {
      return NextResponse.json({ error: "No links found for this account" }, { status: 404 });
    }

    const data = snap.data() as AccountLinks;
    const filtered = data.links.filter((l) => !(l.hubId === body.hubId && l.role === body.role));

    if (filtered.length === data.links.length) {
      return NextResponse.json({ error: "Link not found" }, { status: 404 });
    }

    if (filtered.length === 0) {
      await ref.delete();
    } else {
      await ref.update({
        links: filtered,
        updatedAt: new Date().toISOString(),
      });
    }

    await invalidateFinancialProfileCache(targetUid, db);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[account-links] DELETE error", err);
    return NextResponse.json({ error: "Failed to delete link" }, { status: 500 });
  }
}
