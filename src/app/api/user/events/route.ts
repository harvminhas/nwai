/**
 * GET  /api/user/events  — list all active events with spent totals
 * POST /api/user/events  — create a new event (project or service)
 */

import { NextRequest, NextResponse } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase-admin";
import { resolveAccess } from "@/lib/access/resolveAccess";
import { getFinancialProfile } from "@/lib/financialProfile";
import type { UserEvent, TxTag, EventSummary, VisitLog } from "@/lib/events/types";
import { txFingerprint } from "@/lib/txFingerprint";
import { randomUUID } from "crypto";

export async function GET(req: NextRequest) {
  const { db } = getFirebaseAdmin();
  const access = await resolveAccess(req, db);
  if (!access) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { targetUid } = access;

  try {
    const [eventsSnap, tagsSnap, profile] = await Promise.all([
      db.collection(`users/${targetUid}/events`).orderBy("createdAt", "desc").get(),
      db.collection(`users/${targetUid}/txTags`).get(),
      getFinancialProfile(targetUid, db),
    ]);

    const currentYear = new Date().getFullYear().toString();

    // Build fingerprint → { amount, date } for quick lookup
    const txByFingerprint = new Map<string, { amount: number; date: string }>();
    for (const tx of profile.expenseTxns) {
      const fp = txFingerprint(tx.accountSlug, tx.date, tx.amount, tx.merchant);
      txByFingerprint.set(fp, { amount: Math.abs(tx.amount), date: tx.date });
    }

    const eventsById = new Map(
      eventsSnap.docs.map((d) => [d.id, { id: d.id, ...d.data() } as UserEvent]),
    );

    // Build per-event totals + service visit data
    const totals       = new Map<string, { totalSpent: number; txCount: number }>();
    const svcVisits    = new Map<string, { visitsByMonth: Record<string, number>; paymentsByMonth: Record<string, number>; lastVisitDate?: string }>();

    for (const tagDoc of tagsSnap.docs) {
      const tag = tagDoc.data() as TxTag;
      const fpKey = tag.txFingerprint ?? tagDoc.id;
      const tx  = txByFingerprint.get(fpKey);
      if (!tx) continue;

      for (const eventId of tag.eventIds ?? []) {
        const ev = eventsById.get(eventId);
        if (!ev) continue;

        // Annual/service events only count current-year transactions
        if (ev.type === "annual" && !tx.date.startsWith(currentYear)) continue;

        // Totals
        const prev = totals.get(eventId) ?? { totalSpent: 0, txCount: 0 };
        totals.set(eventId, { totalSpent: prev.totalSpent + tx.amount, txCount: prev.txCount + 1 });

        // Service visit + payment tracking
        if (ev.kind === "service") {
          const existing = svcVisits.get(eventId) ?? { visitsByMonth: {}, paymentsByMonth: {} };
          const ym = tx.date.substring(0, 7); // YYYY-MM
          existing.visitsByMonth[ym]    = (existing.visitsByMonth[ym]    ?? 0) + 1;
          existing.paymentsByMonth[ym]  = (existing.paymentsByMonth[ym]  ?? 0) + 1;
          if (!existing.lastVisitDate || tx.date > existing.lastVisitDate) {
            existing.lastVisitDate = tx.date;
          }
          svcVisits.set(eventId, existing);
        }
      }
    }

    const events: EventSummary[] = eventsSnap.docs
      .map((d) => {
        const ev = { id: d.id, ...d.data() } as UserEvent;
        const { totalSpent, txCount } = totals.get(ev.id) ?? { totalSpent: 0, txCount: 0 };

        // For services: prefer denormalized visit data from the event doc;
        // fall back to tx-based computation for events predating visit logging.
        let visitsByMonth:   Record<string, number> | undefined;
        let paymentsByMonth: Record<string, number> | undefined;
        let lastVisitDate: string | undefined = ev.lastVisitDate;

        if (ev.kind === "service") {
          const svc = svcVisits.get(ev.id);

          // Filter stored visitsByMonth to current year for timeline display
          if (ev.visitsByMonth && Object.keys(ev.visitsByMonth).length > 0) {
            visitsByMonth = Object.fromEntries(
              Object.entries(ev.visitsByMonth).filter(([ym]) => ym.startsWith(currentYear)),
            );
          }
          // Fall back to tx-based if no visit logs yet
          if (!visitsByMonth || Object.keys(visitsByMonth).length === 0) {
            visitsByMonth = svc?.visitsByMonth;
          }
          if (!lastVisitDate) {
            lastVisitDate = svc?.lastVisitDate;
          }

          // Merge paymentsByMonth: cash (stored on doc) + tagged transactions (computed above)
          const cashPbm = ev.paymentsByMonth
            ? Object.fromEntries(
                Object.entries(ev.paymentsByMonth).filter(([ym]) => ym.startsWith(currentYear)),
              )
            : {};
          const txPbm = svc?.paymentsByMonth ?? {};
          const merged: Record<string, number> = { ...txPbm };
          for (const [ym, count] of Object.entries(cashPbm)) {
            merged[ym] = (merged[ym] ?? 0) + count;
          }
          if (Object.keys(merged).length > 0) paymentsByMonth = merged;
        }

        const visitCount     = ev.visitCount;
        const cashVisitCount = ev.cashVisitCount ?? 0;
        const cashTotal      = ev.cashTotal ?? 0;
        const ledgerTotal    = ev.ledgerTotal ?? 0;
        const paidCount      = txCount + cashVisitCount;
        const unbilledCount  = visitCount != null ? Math.max(0, visitCount - paidCount) : undefined;

        return {
          ...ev,
          totalSpent: totalSpent + cashTotal + ledgerTotal,
          txCount,
          paidCount,
          ...(visitsByMonth   ? { visitsByMonth }   : {}),
          ...(paymentsByMonth ? { paymentsByMonth }  : {}),
          ...(lastVisitDate   ? { lastVisitDate }    : {}),
          ...(unbilledCount != null ? { unbilledCount } : {}),
        };
      })
      .filter((ev) => !ev.archivedAt);

    const serviceIds = events.filter((e) => e.kind === "service").map((e) => e.id);
    const recentById = new Map<string, VisitLog[]>();
    if (serviceIds.length > 0) {
      await Promise.all(
        serviceIds.map(async (sid) => {
          const snap = await db
            .collection(`users/${targetUid}/events/${sid}/visits`)
            .orderBy("date", "desc")
            .limit(3)
            .get();
          const logs: VisitLog[] = snap.docs.map((d) => ({ id: d.id, ...d.data() } as VisitLog));
          recentById.set(sid, logs);
        }),
      );
    }

    const eventsWithLogs: EventSummary[] = events.map((ev) =>
      ev.kind === "service"
        ? { ...ev, recentVisitLogs: recentById.get(ev.id) ?? [] }
        : ev,
    );

    return NextResponse.json({ events: eventsWithLogs });
  } catch (err) {
    console.error("[events] GET error", err);
    return NextResponse.json({ error: "Failed to load events" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const { db } = getFirebaseAdmin();
  const access = await resolveAccess(req, db);
  if (!access) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { actorUid } = access;

  try {
    const body = await req.json().catch(() => ({})) as Partial<UserEvent>;
    if (!body.name?.trim()) return NextResponse.json({ error: "name required" }, { status: 400 });

    const now  = new Date().toISOString();
    const id   = randomUUID();
    const kind = body.kind ?? "project";

    const event: UserEvent = {
      id,
      name: body.name.trim(),
      kind,
      type: kind === "service" ? "annual" : (body.type ?? "one-off"),
      color: body.color ?? (kind === "service" ? "blue" : "purple"),
      createdAt: now,
      // Budget + timeframe (all events)
      ...(body.budget   != null  && !Number.isNaN(Number(body.budget)) && { budget: Number(body.budget) }),
      ...(body.startDate         && { startDate: body.startDate        }),
      ...(body.endDate           && { endDate:   body.endDate          }),
      ...(body.date              && { date:      body.date             }),
      // Recurring (service) fields
      ...(kind === "service" && body.cadence        && { cadence:       body.cadence       }),
      ...(kind === "service" && body.seasonStart    && { seasonStart:   body.seasonStart   }),
      ...(kind === "service" && body.seasonEnd      && { seasonEnd:     body.seasonEnd     }),
      ...(kind === "service" && body.billingMethod  && { billingMethod: body.billingMethod }),
      ...(kind === "service" && body.avgPerVisit != null && { avgPerVisit: Number(body.avgPerVisit) }),
    };

    await db.doc(`users/${actorUid}/events/${id}`).set(event);
    return NextResponse.json({ event }, { status: 201 });
  } catch (err) {
    console.error("[events] POST error", err);
    return NextResponse.json({ error: "Failed to create event" }, { status: 500 });
  }
}
