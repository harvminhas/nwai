/**
 * GET  /api/user/events  — list all active events with spent totals
 * POST /api/user/events  — create a new event (project or service)
 */

import { NextRequest, NextResponse } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase-admin";
import { resolveAccess } from "@/lib/access/resolveAccess";
import { getFinancialProfile } from "@/lib/financialProfile";
import type {
  UserEvent,
  TxTag,
  EventSummary,
  VisitLog,
  ServiceRecentActivity,
  ProjectLedgerEntry,
  ProjectRecentExpense,
} from "@/lib/events/types";
import { txFingerprint } from "@/lib/txFingerprint";
import { randomUUID } from "crypto";

/** Ledger rows merged with statement tags for project list cards */
const LEDGER_FETCH_FOR_MERGE = 25;

function buildRecentProjectExpenses(
  statements: { fingerprint: string; date: string; amount: number; merchant: string }[],
  ledger: ProjectLedgerEntry[],
): ProjectRecentExpense[] {
  type Row = { sortKey: string; expense: ProjectRecentExpense };
  const rows: Row[] = [];
  for (const s of statements) {
    rows.push({
      sortKey: `${s.date}\0${s.fingerprint}`,
      expense: {
        kind: "statement",
        id: s.fingerprint,
        date: s.date,
        amount: s.amount,
        merchant: s.merchant,
      },
    });
  }
  for (const L of ledger) {
    const tie = L.createdAt ?? L.id;
    rows.push({
      sortKey: `${L.date}\0${tie}`,
      expense: {
        kind: "ledger",
        id: L.id,
        date: L.date,
        amount: L.amount,
        note: L.note,
        category: L.category,
        entryType: L.entryType,
      },
    });
  }
  rows.sort((a, b) => b.sortKey.localeCompare(a.sortKey));
  return rows.slice(0, 3).map((r) => r.expense);
}

/** Last N merged rows for service list cards (visits + statement payments). */
const VISITS_FETCH_FOR_MERGE = 25;

function buildRecentActivities(
  visits: VisitLog[],
  payments: { fingerprint: string; date: string; amount: number; merchant: string }[],
): ServiceRecentActivity[] {
  type Row = { sortKey: string; activity: ServiceRecentActivity };
  const rows: Row[] = [];
  for (const v of visits) {
    const tie = v.createdAt ?? v.id;
    rows.push({
      sortKey: `${v.date}\0${tie}`,
      activity: { kind: "visit", id: v.id, date: v.date, visit: v },
    });
  }
  for (const p of payments) {
    rows.push({
      sortKey: `${p.date}\0${p.fingerprint}`,
      activity: {
        kind: "statement",
        id: p.fingerprint,
        date: p.date,
        amount: p.amount,
        merchant: p.merchant,
      },
    });
  }
  rows.sort((a, b) => b.sortKey.localeCompare(a.sortKey));
  return rows.slice(0, 3).map((r) => r.activity);
}

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

    // Build fingerprint → txn fields for lookup (amount, date, merchant label)
    const txByFingerprint = new Map<string, { amount: number; date: string; merchant: string }>();
    for (const tx of profile.expenseTxns) {
      const fp = txFingerprint(tx.accountSlug, tx.date, tx.amount, tx.merchant);
      txByFingerprint.set(fp, { amount: Math.abs(tx.amount), date: tx.date, merchant: tx.merchant });
    }

    /** Statement-tagged payments per service event (for merged activity feed on list cards) */
    const statementPaymentsByEvent = new Map<
      string,
      { fingerprint: string; date: string; amount: number; merchant: string }[]
    >();

    /** Statement-tagged tx rows per project (for list card expense feed) */
    const projectStatementByEvent = new Map<
      string,
      { fingerprint: string; date: string; amount: number; merchant: string }[]
    >();

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

          const payRow = {
            fingerprint: fpKey,
            date: tx.date,
            amount: tx.amount,
            merchant: tx.merchant,
          };
          const payList = statementPaymentsByEvent.get(eventId) ?? [];
          payList.push(payRow);
          statementPaymentsByEvent.set(eventId, payList);
        }

        if ((ev.kind ?? "project") === "project") {
          const stmtRow = {
            fingerprint: fpKey,
            date: tx.date,
            amount: tx.amount,
            merchant: tx.merchant,
          };
          const stmtList = projectStatementByEvent.get(eventId) ?? [];
          stmtList.push(stmtRow);
          projectStatementByEvent.set(eventId, stmtList);
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
    const recentVisitsById = new Map<string, VisitLog[]>();
    if (serviceIds.length > 0) {
      await Promise.all(
        serviceIds.map(async (sid) => {
          const snap = await db
            .collection(`users/${targetUid}/events/${sid}/visits`)
            .orderBy("date", "desc")
            .limit(VISITS_FETCH_FOR_MERGE)
            .get();
          const logs: VisitLog[] = snap.docs.map((d) => ({ id: d.id, ...d.data() } as VisitLog));
          recentVisitsById.set(sid, logs);
        }),
      );
    }

    const eventsWithActivities: EventSummary[] = events.map((ev) =>
      ev.kind === "service"
        ? {
            ...ev,
            recentActivities: buildRecentActivities(
              recentVisitsById.get(ev.id) ?? [],
              statementPaymentsByEvent.get(ev.id) ?? [],
            ),
          }
        : ev,
    );

    const projectIds = events.filter((e) => (e.kind ?? "project") === "project").map((e) => e.id);
    const ledgerByProjectId = new Map<string, ProjectLedgerEntry[]>();
    if (projectIds.length > 0) {
      await Promise.all(
        projectIds.map(async (pid) => {
          const snap = await db
            .collection(`users/${targetUid}/events/${pid}/ledger`)
            .orderBy("date", "desc")
            .limit(LEDGER_FETCH_FOR_MERGE)
            .get();
          const entries: ProjectLedgerEntry[] = snap.docs.map(
            (d) => ({ id: d.id, ...d.data() } as ProjectLedgerEntry),
          );
          ledgerByProjectId.set(pid, entries);
        }),
      );
    }

    const eventsOut: EventSummary[] = eventsWithActivities.map((ev) =>
      (ev.kind ?? "project") === "project"
        ? {
            ...ev,
            recentProjectExpenses: buildRecentProjectExpenses(
              projectStatementByEvent.get(ev.id) ?? [],
              ledgerByProjectId.get(ev.id) ?? [],
            ),
          }
        : ev,
    );

    return NextResponse.json({ events: eventsOut });
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
