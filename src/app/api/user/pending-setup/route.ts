import { NextRequest, NextResponse } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase-admin";
import { resolveAccess } from "@/lib/access/resolveAccess";

export interface PendingAccount {
  accountSlug: string;
  accountName: string;
  accountType: string;
  /** All statement IDs for this slug that still need setup */
  statementIds: string[];
  /** Primary statement ID — oldest first, used for backfill */
  primaryStatementId: string;
  firstBalance: number;
  firstStatementYearMonth: string;
  oldestMonth: string;
  slugIsAccountNumber: boolean;
  inferredCurrency: string;
  accountConfirmNeeded: boolean;
  backfillPromptNeeded: boolean;
  bankTypeKey?: string;
  existingAccounts: { slug: string; label: string }[];
  suggestedSlug?: string;
  statementCount: number;
  txCount: number;
}

export interface ExistingIngested {
  accountSlug: string;
  accountName: string;
  accountType: string;
  statementCount: number;
  txCount: number;
  oldestMonth: string;
  newestMonth: string;
}

export interface PendingSetupResponse {
  pendingAccounts: PendingAccount[];
  pendingCount: number;
  /** Accounts from the current batch (batchIds) that were auto-ingested with no action needed */
  batchIngested: ExistingIngested[];
  batchStatementCount: number;
  batchTxCount: number;
}

export async function GET(request: NextRequest) {
  try {
    const { db } = getFirebaseAdmin();
    const access = await resolveAccess(request, db);
    if (!access) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const uid = access.targetUid;

    // Optional: batch IDs passed from the setup page to show context for this session
    const batchParam = request.nextUrl.searchParams.get("ids");
    const batchIds = batchParam ? batchParam.split(",").filter(Boolean) : [];

    // Query for statements needing setup
    const [bfSnap, acSnap] = await Promise.all([
      db.collection("statements")
        .where("userId", "==", uid)
        .where("backfillPromptNeeded", "==", true)
        .get(),
      db.collection("statements")
        .where("userId", "==", uid)
        .where("accountConfirmNeeded", "==", true)
        .get(),
    ]);

    // Merge and deduplicate by statement ID
    const seen = new Set<string>();
    const pendingDocs: FirebaseFirestore.QueryDocumentSnapshot[] = [];
    for (const doc of [...bfSnap.docs, ...acSnap.docs]) {
      if (!seen.has(doc.id)) { seen.add(doc.id); pendingDocs.push(doc); }
    }

    // Group pending by accountSlug
    const bySlug = new Map<string, typeof pendingDocs>();
    for (const doc of pendingDocs) {
      const slug = (doc.data().accountSlug as string) ?? doc.id;
      if (!bySlug.has(slug)) bySlug.set(slug, []);
      bySlug.get(slug)!.push(doc);
    }

    const pendingAccounts: PendingAccount[] = [];
    for (const [slug, docs] of bySlug.entries()) {
      // Sort oldest statement first for backfill context
      docs.sort((a, b) => {
        const ym = (d: typeof docs[0]) => (d.data().yearMonth as string) ?? "";
        return ym(a).localeCompare(ym(b));
      });
      const primary = docs[0];
      const data = primary.data();
      const parsed = (data.parsedData ?? {}) as Record<string, unknown>;
      const txCount = docs.reduce((sum, d) => {
        const p = (d.data().parsedData ?? {}) as Record<string, unknown>;
        return sum + ((p.expenses as { transactions?: unknown[] })?.transactions?.length ?? 0) +
               ((p.income as { transactions?: unknown[] })?.transactions?.length ?? 0);
      }, 0);

      pendingAccounts.push({
        accountSlug:             slug,
        accountName:             (parsed.accountName as string) ?? (data.accountSlug as string) ?? "New account",
        accountType:             (parsed.accountType as string) ?? "other",
        statementIds:            docs.map((d) => d.id),
        primaryStatementId:      primary.id,
        firstBalance:            (parsed.netWorth as number) ?? 0,
        firstStatementYearMonth: (data.yearMonth as string) ?? "",
        oldestMonth:             (data.backfillOldestMonth as string) ?? "",
        slugIsAccountNumber:     (data.slugIsAccountNumber as boolean) ?? false,
        inferredCurrency:        (data.inferredCurrency as string) ?? "USD",
        accountConfirmNeeded:    (data.accountConfirmNeeded as boolean) ?? false,
        backfillPromptNeeded:    (data.backfillPromptNeeded as boolean) ?? false,
        bankTypeKey:             (data.bankTypeKey as string) ?? undefined,
        existingAccounts:        (data.existingAccounts as { slug: string; label: string }[]) ?? [],
        suggestedSlug:           (data.suggestedSlug as string) ?? undefined,
        statementCount:          docs.length,
        txCount,
      });
    }

    // Batch context: fetch the batch statement docs (if ids provided)
    let batchIngested: ExistingIngested[] = [];
    let batchStatementCount = 0;
    let batchTxCount = 0;

    if (batchIds.length > 0) {
      // Firestore `in` queries limited to 30 at a time
      const chunks: string[][] = [];
      for (let i = 0; i < batchIds.length; i += 30) chunks.push(batchIds.slice(i, i + 30));
      const batchDocs: FirebaseFirestore.DocumentData[] = [];
      for (const chunk of chunks) {
        const snap = await db.collection("statements").where("__name__", "in", chunk).get();
        batchDocs.push(...snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      }

      batchStatementCount = batchDocs.length;
      const pendingIds = new Set(pendingDocs.map((d) => d.id));

      // Group non-pending batch docs by slug
      const ingestedBySlug = new Map<string, typeof batchDocs>();
      for (const doc of batchDocs) {
        if (pendingIds.has(doc.id)) continue; // skip pending ones
        const slug = (doc.accountSlug as string) ?? doc.id;
        if (!ingestedBySlug.has(slug)) ingestedBySlug.set(slug, []);
        ingestedBySlug.get(slug)!.push(doc);
      }

      for (const [slug, docs] of ingestedBySlug.entries()) {
        const months = docs.map((d) => (d.yearMonth as string) ?? "").filter(Boolean).sort();
        const txs = docs.reduce((sum, d) => {
          const p = (d.parsedData ?? {}) as Record<string, unknown>;
          const t = ((p.expenses as { transactions?: unknown[] })?.transactions?.length ?? 0) +
                    ((p.income as { transactions?: unknown[] })?.transactions?.length ?? 0);
          batchTxCount += t;
          return sum + t;
        }, 0);
        const firstDoc = docs[0];
        const parsed = (firstDoc.parsedData ?? {}) as Record<string, unknown>;
        batchIngested.push({
          accountSlug:   slug,
          accountName:   (parsed.accountName as string) ?? (firstDoc.accountSlug as string) ?? slug,
          accountType:   (parsed.accountType as string) ?? "other",
          statementCount: docs.length,
          txCount:       txs,
          oldestMonth:   months[0] ?? "",
          newestMonth:   months[months.length - 1] ?? "",
        });
      }
    }

    const response: PendingSetupResponse = {
      pendingAccounts,
      pendingCount: pendingAccounts.length,
      batchIngested,
      batchStatementCount,
      batchTxCount,
    };

    return NextResponse.json(response);
  } catch (err) {
    console.error("[pending-setup GET]", err);
    return NextResponse.json({ error: "Failed to load" }, { status: 500 });
  }
}
