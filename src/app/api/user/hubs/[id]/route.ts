/**
 * GET    /api/user/hubs/[id]         — get one hub with its linked transactions
 * PUT    /api/user/hubs/[id]         — update hub name/color
 * DELETE /api/user/hubs/[id]         — delete hub and all its links
 */

import { NextRequest, NextResponse } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase-admin";
import { resolveAccess } from "@/lib/access/resolveAccess";
import type { GeneralHub, ExpenseTransaction, IncomeTransaction } from "@/lib/types";
import { getFinancialProfile } from "@/lib/financialProfile";
import { txFingerprint } from "@/lib/txFingerprint";

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { db } = getFirebaseAdmin();
  const access = await resolveAccess(req, db);
  if (!access) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { targetUid } = access;
  const params = await context.params;
  const hubId = params.id;

  try {
    const hubDoc = await db.doc(`users/${targetUid}/hubs/${hubId}`).get();
    if (!hubDoc.exists) {
      return NextResponse.json({ error: "Hub not found" }, { status: 404 });
    }

    const hubData = hubDoc.data()!;
    const hub: GeneralHub = {
      id: hubDoc.id,
      name: hubData.name ?? "",
      color: hubData.color ?? "blue",
      createdAt: hubData.createdAt?.toDate?.()?.toISOString?.() ?? hubData.createdAt ?? new Date().toISOString(),
      updatedAt: hubData.updatedAt?.toDate?.()?.toISOString?.() ?? hubData.updatedAt ?? new Date().toISOString(),
    };

    // Fetch all transaction links that reference this hub
    const linksSnap = await db.collection(`users/${targetUid}/txLinks`).get();
    const linkedFingerprints = new Set<string>();
    
    for (const doc of linksSnap.docs) {
      const data = doc.data();
      const links = data.links ?? [];
      if (links.some((l: { hubId: string }) => l.hubId === hubId)) {
        linkedFingerprints.add(doc.id);
      }
    }

    // Load transactions from financial profile
    const profile = await getFinancialProfile(targetUid, db);
    const expenseTxns = profile.expenseTxns ?? [];
    const incomeTxns = profile.incomeTxns ?? [];

    // Match transactions by fingerprint (compute fingerprint for each transaction)
    const matchedExpense = expenseTxns
      .filter((tx) => {
        const fp = txFingerprint(tx.accountSlug, tx.date, tx.amount, tx.merchant);
        return linkedFingerprints.has(fp);
      })
      .map((tx) => ({
        ...tx,
        fingerprint: txFingerprint(tx.accountSlug, tx.date, tx.amount, tx.merchant),
        type: "expense" as const,
      }));

    const matchedIncome = incomeTxns
      .filter((tx) => {
        const fp = txFingerprint(tx.accountSlug, tx.date, tx.amount, tx.source);
        return linkedFingerprints.has(fp);
      })
      .map((tx) => ({
        ...tx,
        fingerprint: txFingerprint(tx.accountSlug, tx.date, tx.amount, tx.source),
        merchant: tx.source,
        category: tx.category ?? "Income",
        type: "income" as const,
      }));

    const transactions = [...matchedExpense, ...matchedIncome].sort(
      (a, b) => (b.date ?? "").localeCompare(a.date ?? "")
    );

    const total = matchedExpense.reduce((sum, tx) => sum + tx.amount, 0);

    return NextResponse.json({ hub, transactions, total });
  } catch (err) {
    console.error(`[hubs/${hubId}] GET error`, err);
    return NextResponse.json({ error: "Failed to load hub" }, { status: 500 });
  }
}

export async function PUT(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { db } = getFirebaseAdmin();
  const access = await resolveAccess(req, db);
  if (!access) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { actorUid } = access;
  const params = await context.params;
  const hubId = params.id;

  try {
    const body = await req.json() as {
      name?: string;
      color?: string;
    };

    if (!body.name && !body.color) {
      return NextResponse.json({ error: "name or color is required" }, { status: 400 });
    }

    const ref = db.doc(`users/${actorUid}/hubs/${hubId}`);
    const snap = await ref.get();
    
    if (!snap.exists) {
      return NextResponse.json({ error: "Hub not found" }, { status: 404 });
    }

    const updates: Record<string, unknown> = {
      updatedAt: new Date(),
    };

    if (body.name?.trim()) {
      updates.name = body.name.trim();
    }

    if (body.color) {
      updates.color = body.color;
    }

    await ref.update(updates);

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(`[hubs/${hubId}] PUT error`, err);
    return NextResponse.json({ error: "Failed to update hub" }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { db } = getFirebaseAdmin();
  const access = await resolveAccess(req, db);
  if (!access) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { actorUid } = access;
  const params = await context.params;
  const hubId = params.id;

  try {
    // Delete the hub document
    await db.doc(`users/${actorUid}/hubs/${hubId}`).delete();

    // Remove all links to this hub from transactions
    const linksSnap = await db.collection(`users/${actorUid}/txLinks`).get();
    const batch = db.batch();

    for (const doc of linksSnap.docs) {
      const data = doc.data();
      const links = data.links ?? [];
      const filtered = links.filter((l: { hubId: string }) => l.hubId !== hubId);
      
      if (filtered.length !== links.length) {
        if (filtered.length === 0) {
          batch.delete(doc.ref);
        } else {
          batch.update(doc.ref, {
            links: filtered,
            updatedAt: new Date().toISOString(),
          });
        }
      }
    }

    // Remove all links to this hub from accounts
    const accountLinksSnap = await db.collection(`users/${actorUid}/accountLinks`).get();
    for (const doc of accountLinksSnap.docs) {
      const data = doc.data();
      const links = data.links ?? [];
      const filtered = links.filter((l: { hubId: string }) => l.hubId !== hubId);
      
      if (filtered.length !== links.length) {
        if (filtered.length === 0) {
          batch.delete(doc.ref);
        } else {
          batch.update(doc.ref, {
            links: filtered,
            updatedAt: new Date().toISOString(),
          });
        }
      }
    }

    await batch.commit();

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(`[hubs/${hubId}] DELETE error`, err);
    return NextResponse.json({ error: "Failed to delete hub" }, { status: 500 });
  }
}
