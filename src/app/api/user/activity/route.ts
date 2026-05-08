/**
 * GET /api/user/activity
 * Returns a merged, reverse-chronological activity feed for the user:
 *   - statement_upload  — every completed/error statement
 *   - category_rule     — every saved merchant→category rule
 *   - recurring_rule    — every saved recurring merchant rule
 *   - rate_change       — every manual APR/APY override saved per account
 */

import { NextRequest, NextResponse } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase-admin";
import { resolveAccess } from "@/lib/access/resolveAccess";

function authToken(req: NextRequest): string | null {
  const h = req.headers.get("authorization");
  return h?.startsWith("Bearer ") ? h.slice(7) : null;
}

export type ActivityEventType =
  | "statement_upload"
  | "statement_delete"
  | "category_rule"
  | "recurring_rule"
  | "rate_change";

export interface ActivityEvent {
  id: string;
  type: ActivityEventType;
  timestamp: string; // ISO
  title: string;
  subtitle: string | null;
  meta: Record<string, unknown>;
}

export async function GET(req: NextRequest) {
  const token = authToken(req);
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { db } = getFirebaseAdmin();
    const access = await resolveAccess(req, db);
    if (!access) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const uid = access.targetUid;

    const events: ActivityEvent[] = [];

    // ── 1. Statement uploads ──────────────────────────────────────────────────
    const stmtSnap = await db
      .collection("statements")
      .where("userId", "==", uid)
      .orderBy("uploadedAt", "desc")
      .limit(60)
      .get();

    for (const doc of stmtSnap.docs) {
      const d = doc.data();
      const status: string = d.status ?? "unknown";
      if (status === "pending" || status === "processing") continue;

      const bankName: string  = d.parsedData?.bankName ?? d.fileName ?? "Statement";
      const acctName: string  = d.parsedData?.accountName ?? "";
      const stmtDate: string  = d.parsedData?.statementDate ?? "";
      const acctType: string  = d.parsedData?.accountType ?? "";

      events.push({
        id: `stmt_${doc.id}`,
        type: "statement_upload",
        timestamp: d.uploadedAt?.toDate?.()?.toISOString?.() ?? new Date().toISOString(),
        title: acctName ? `${bankName} · ${acctName}` : bankName,
        subtitle: stmtDate ? `Statement date: ${stmtDate}` : null,
        meta: {
          statementId: doc.id,
          status,
          accountType: acctType,
          superseded: d.superseded ?? false,
          fileName: d.fileName ?? null,
          // Audit: present only when a partner uploaded on the owner's behalf
          ...(d.uploadedBy  ? { uploadedBy: d.uploadedBy }              : {}),
          ...(d.uploadedByEmail ? { uploadedByEmail: d.uploadedByEmail } : {}),
        },
      });
    }

    // ── 2. Category rules ─────────────────────────────────────────────────────
    const catSnap = await db
      .collection(`users/${uid}/categoryRules`)
      .orderBy("updatedAt", "desc")
      .limit(40)
      .get();

    for (const doc of catSnap.docs) {
      const d = doc.data();
      events.push({
        id: `cat_${doc.id}`,
        type: "category_rule",
        timestamp: d.updatedAt?.toDate?.()?.toISOString?.() ?? new Date().toISOString(),
        title: `Rule: "${d.merchant}" → ${d.category}`,
        subtitle: null,
        meta: { merchant: d.merchant, category: d.category },
      });
    }

    // ── 3. Recurring rules ────────────────────────────────────────────────────
    const recSnap = await db
      .collection(`users/${uid}/recurringRules`)
      .orderBy("updatedAt", "desc")
      .limit(40)
      .get();

    for (const doc of recSnap.docs) {
      const d = doc.data();
      events.push({
        id: `rec_${doc.id}`,
        type: "recurring_rule",
        timestamp: d.updatedAt?.toDate?.()?.toISOString?.() ?? new Date().toISOString(),
        title: `Recurring: "${d.merchant}"`,
        subtitle: d.frequency ? `${d.frequency} · ${d.category ?? ""}`.replace(/ · $/, "") : null,
        meta: { merchant: d.merchant, frequency: d.frequency, category: d.category ?? null },
      });
    }

    // ── 4. Manual APR / rate changes ──────────────────────────────────────────
    const ratesSnap = await db
      .collection(`users/${uid}/accountRates`)
      .get();

    await Promise.all(
      ratesSnap.docs.map(async (rateDoc) => {
        const histSnap = await rateDoc.ref
          .collection("history")
          .orderBy("changedAt", "desc")
          .limit(10)
          .get();

        for (const h of histSnap.docs) {
          const d = h.data();
          const accountKey: string = rateDoc.id;
          const bankName = accountKey.split("__")[0].replace(/_/g, " ");
          events.push({
            id: `rate_${rateDoc.id}_${h.id}`,
            type: "rate_change",
            timestamp: d.changedAt?.toDate?.()?.toISOString?.() ?? new Date().toISOString(),
            title: `APR updated: ${bankName}`,
            subtitle: `Set to ${d.rate}%${d.note ? ` · ${d.note}` : ""}`,
            meta: { accountKey, rate: d.rate, note: d.note ?? null },
          });
        }
      })
    );

    // ── 5. Statement deletions (audit log) ───────────────────────────────────
    const auditSnap = await db
      .collection(`users/${uid}/activityLog`)
      .orderBy("timestamp", "desc")
      .limit(40)
      .get();

    for (const doc of auditSnap.docs) {
      const d = doc.data();
      if (d.type !== "statement_delete") continue;
      const bankName: string  = d.bankName ?? d.accountName ?? d.fileName ?? "Statement";
      const byLabel: string   = d.actorEmail ? ` · by ${d.actorEmail}` : "";
      events.push({
        id: `del_${doc.id}`,
        type: "statement_delete",
        timestamp: d.timestamp?.toDate?.()?.toISOString?.() ?? new Date().toISOString(),
        title: `Deleted: ${bankName}`,
        subtitle: d.yearMonth ? `${d.yearMonth}${byLabel}` : byLabel.trimStart() || null,
        meta: {
          actorUid:    d.actorUid ?? null,
          actorEmail:  d.actorEmail ?? null,
          accountSlug: d.accountSlug ?? null,
          fileName:    d.fileName ?? null,
        },
      });
    }

    // ── Sort descending by timestamp ─────────────────────────────────────────
    events.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

    return NextResponse.json({ events: events.slice(0, 100) });
  } catch (err) {
    console.error("GET /api/user/activity error:", err);
    return NextResponse.json({ error: "Failed to load activity" }, { status: 500 });
  }
}
