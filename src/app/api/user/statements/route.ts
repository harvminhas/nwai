import { NextRequest, NextResponse } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase-admin";
import { resolveAccess } from "@/lib/access/resolveAccess";
import type { UserStatementSummary } from "@/lib/types";
import { FREE_ONETIME_UPLOADS, FREE_MONTHLY_UPLOADS } from "@/lib/plans";

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { db } = getFirebaseAdmin();
    const access = await resolveAccess(request, db);
    if (!access) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const uid = access.targetUid;

    const [snapshot, userDoc] = await Promise.all([
      db.collection("statements").where("userId", "==", uid).get(),
      db.collection("users").doc(uid).get(),
    ]);
    const userData = userDoc.exists ? userDoc.data() ?? {} : {};

    const statements: UserStatementSummary[] = snapshot.docs.map((doc) => {
      const d = doc.data();
      const uploadedAt = d.uploadedAt?.toDate?.() ?? d.uploadedAt;
      return {
        id: doc.id,
        uploadedAt:
          typeof uploadedAt === "object" && uploadedAt instanceof Date
            ? uploadedAt.toISOString()
            : String(uploadedAt),
        fileName: d.fileName ?? "",
        netWorth: d.parsedData?.netWorth,
        statementDate: d.parsedData?.statementDate,
        bankName: d.parsedData?.bankName,
        accountId: d.parsedData?.accountId,
        accountName: d.parsedData?.accountName,
        accountType: d.parsedData?.accountType,
        status: d.status ?? "processing",
        superseded: d.superseded === true,
        supersededBy: d.supersededBy,
        source: d.source ?? "pdf",
        csvDateRange: d.csvDateRange,
        txCount: (
          (d.parsedData?.expenses?.transactions?.length ?? 0) +
          (d.parsedData?.income?.transactions?.length ?? 0)
        ) || undefined,
        interestRate: typeof d.parsedData?.interestRate === "number" ? d.parsedData.interestRate : null,
        subAccounts: Array.isArray(d.parsedData?.subAccounts) && d.parsedData.subAccounts.length > 0
          ? d.parsedData.subAccounts
          : undefined,
      };
    });

    statements.sort((a, b) => {
      const tA = new Date(a.uploadedAt).getTime();
      const tB = new Date(b.uploadedAt).getTime();
      return tB - tA;
    });

    // Build quota info for display on the statements page
    const userPlan: string = userData.plan ?? "free";
    const isPro = userPlan === "pro" || userPlan === "family";
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const nextReset = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const storedResetAt: Date | null = userData.monthlyUploadsResetAt?.toDate?.() ?? null;
    const isNewMonth = !storedResetAt || storedResetAt < monthStart;
    const onetimeUsed: number = userData.onetimeUploadsUsed ?? 0;
    const monthlyUsed: number = isNewMonth ? 0 : (userData.monthlyUploadsUsed ?? 0);
    const quota = {
      isPro,
      onetimeUsed,
      onetimeLimit: FREE_ONETIME_UPLOADS,
      onetimeRemaining: Math.max(0, FREE_ONETIME_UPLOADS - onetimeUsed),
      monthlyUsed,
      monthlyLimit: FREE_MONTHLY_UPLOADS,
      monthlyResetAt: nextReset.toISOString(),
    };

    const homeCurrency: string = userData.homeCurrency ?? userData.currency ?? "USD";

    return NextResponse.json({ statements, quota, homeCurrency });
  } catch (err) {
    console.error("User statements error:", err);
    if (err && typeof err === "object" && "code" in err && (err as { code: string }).code === "auth/id-token-expired") {
      return NextResponse.json({ error: "Token expired" }, { status: 401 });
    }
    return NextResponse.json(
      { error: "Failed to load statements. Try logging out and back in." },
      { status: 500 }
    );
  }
}
