import { NextRequest, NextResponse } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase-admin";
import { consolidateStatements, getYearMonth } from "@/lib/consolidate";
import type { ParsedStatementData, ManualAsset, AssetCategory } from "@/lib/types";

function docYearMonth(d: FirebaseFirestore.DocumentData): string {
  const parsed = d.parsedData as ParsedStatementData | undefined;
  let ym = parsed?.statementDate ? getYearMonth(parsed.statementDate) : "";
  if (!ym) {
    const raw = d.uploadedAt?.toDate?.() ?? d.uploadedAt;
    if (raw) {
      const t =
        typeof raw === "object" && "toISOString" in raw
          ? (raw as Date).toISOString()
          : String(raw);
      ym = t.slice(0, 7);
    }
  }
  return ym;
}

function matchesBank(parsed: ParsedStatementData, bankFilter: string | null): boolean {
  if (!bankFilter) return true;
  return (parsed.bankName ?? "").toLowerCase().replace(/\s+/g, "-") === bankFilter;
}

function matchesAccount(parsed: ParsedStatementData, accountFilter: string | null): boolean {
  if (!accountFilter) return true;
  const slug = accountSlug(parsed);
  return slug === accountFilter;
}

function accountSlug(parsed: ParsedStatementData): string {
  // Use accountId + bankName for uniqueness across banks
  const bank = (parsed.bankName ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const acct = (parsed.accountId ?? "unknown").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return acct !== "unknown" ? `${bank}-${acct}` : bank;
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const monthParam = searchParams.get("month")?.trim();
  const bankFilter = searchParams.get("bank")?.trim().toLowerCase() ?? null;
  const accountFilter = searchParams.get("account")?.trim().toLowerCase() ?? null;
  const useCurrent = !monthParam || monthParam === "current";

  try {
    const { auth, db } = getFirebaseAdmin();
    const decoded = await auth.verifyIdToken(token);
    const uid = decoded.uid;

    const snapshot = await db
      .collection("statements")
      .where("userId", "==", uid)
      .get();

    // Load manual assets in parallel
    const manualAssetsSnap = await db
      .collection("users").doc(uid).collection("manualAssets").get();
    const allManualAssets: ManualAsset[] = manualAssetsSnap.docs.map((d) => {
      const data = d.data();
      return {
        id: d.id,
        label: data.label ?? "",
        category: (data.category as AssetCategory) ?? "other",
        value: data.value ?? 0,
        linkedAccountSlug: data.linkedAccountSlug ?? undefined,
        updatedAt: data.updatedAt?.toDate?.()?.toISOString?.() ?? new Date().toISOString(),
      };
    });

    // When filtering by account, only include assets linked to that account
    const relevantManualAssets = accountFilter
      ? allManualAssets.filter((a) => a.linkedAccountSlug === accountFilter)
      : allManualAssets;
    const manualAssetsTotal = relevantManualAssets.reduce((sum, a) => sum + a.value, 0);

    // Collect completed + filter docs once, then apply latest-wins per account+month
    const allCompleted = snapshot.docs.filter((doc) => {
      const d = doc.data();
      if (d.status !== "completed" || !d.parsedData) return false;
      const parsed = d.parsedData as ParsedStatementData;
      if (!matchesBank(parsed, bankFilter)) return false;
      if (!matchesAccount(parsed, accountFilter)) return false;
      return true;
    });

    // For each account+month, keep only the most recently uploaded statement
    const latestByKey = new Map<string, typeof allCompleted[0]>();
    for (const doc of allCompleted) {
      const d = doc.data();
      const parsed = d.parsedData as ParsedStatementData;
      const ym = docYearMonth(d);
      const slug = accountSlug(parsed);
      const key = `${slug}::${ym}`;
      const existing = latestByKey.get(key);
      if (!existing) {
        latestByKey.set(key, doc);
      } else {
        const existingTime = existing.data().uploadedAt?.toDate?.()?.getTime() ?? 0;
        const thisTime = d.uploadedAt?.toDate?.()?.getTime() ?? 0;
        if (thisTime > existingTime) latestByKey.set(key, doc);
      }
    }
    const completedDocs = Array.from(latestByKey.values());

    const yearMonths = new Set<string>();
    for (const doc of completedDocs) {
      const ym = docYearMonth(doc.data());
      if (ym) yearMonths.add(ym);
    }

    const month = useCurrent
      ? yearMonths.size > 0
        ? Array.from(yearMonths).sort().reverse()[0]!
        : null
      : monthParam!;

    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      if (useCurrent) {
        return NextResponse.json({ error: "No completed statements yet." }, { status: 404 });
      }
      return NextResponse.json(
        { error: "Query param month must be YYYY-MM, e.g. month=2024-03" },
        { status: 400 }
      );
    }

    const byMonth: ParsedStatementData[] = completedDocs
      .filter((doc) => docYearMonth(doc.data()) === month)
      .map((doc) => doc.data().parsedData as ParsedStatementData);

    const consolidated = consolidateStatements(byMonth, month);

    // Fold in manual assets
    const totalAssets = (consolidated.assets ?? Math.max(0, consolidated.netWorth)) + manualAssetsTotal;
    const adjustedNetWorth = totalAssets - (consolidated.debts ?? Math.max(0, -consolidated.netWorth));
    const enrichedConsolidated = {
      ...consolidated,
      assets: totalAssets,
      netWorth: adjustedNetWorth,
    };

    const [y, m] = month.split("-").map(Number);
    const prevDate = new Date(y, m - 2, 1);
    const prevMonth =
      prevDate.getFullYear().toString().padStart(4, "0") +
      String(prevDate.getMonth() + 1).padStart(2, "0");

    const prevStatements: ParsedStatementData[] = completedDocs
      .filter((doc) => docYearMonth(doc.data()) === prevMonth)
      .map((doc) => doc.data().parsedData as ParsedStatementData);

    let previousMonth: { netWorth: number; assets: number; debts: number } | null = null;
    if (prevStatements.length > 0) {
      const prev = consolidateStatements(prevStatements, prevMonth);
      previousMonth = {
        netWorth: prev.netWorth,
        assets: prev.assets ?? Math.max(0, prev.netWorth),
        debts: prev.debts ?? Math.max(0, -prev.netWorth),
      };
    }

    const history: { yearMonth: string; netWorth: number }[] = [];
    for (const ym of Array.from(yearMonths).sort()) {
      const forMonth: ParsedStatementData[] = completedDocs
        .filter((doc) => docYearMonth(doc.data()) === ym)
        .map((doc) => doc.data().parsedData as ParsedStatementData);
      if (forMonth.length > 0) {
        const c = consolidateStatements(forMonth, ym);
        // Add manual assets to history too (they don't change month-to-month here, just use current value)
        const hAssets = (c.assets ?? Math.max(0, c.netWorth)) + manualAssetsTotal;
        const hNetWorth = hAssets - (c.debts ?? Math.max(0, -c.netWorth));
        history.push({ yearMonth: ym, netWorth: hNetWorth });
      }
    }

    return NextResponse.json({
      data: enrichedConsolidated,
      count: byMonth.length,
      previousMonth,
      yearMonth: month,
      history,
      manualAssets: relevantManualAssets,
    });
  } catch (err) {
    console.error("Consolidated statements error:", err);
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code: string }).code === "auth/id-token-expired"
    ) {
      return NextResponse.json({ error: "Token expired" }, { status: 401 });
    }
    return NextResponse.json({ error: "Failed to load consolidated data." }, { status: 500 });
  }
}
