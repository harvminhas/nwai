import { NextRequest, NextResponse } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase-admin";
import type { UserStatementSummary } from "@/lib/types";

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { auth, db } = getFirebaseAdmin();
    const decoded = await auth.verifyIdToken(token);
    const uid = decoded.uid;

    const snapshot = await db
      .collection("statements")
      .where("userId", "==", uid)
      .get();

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
      };
    });

    statements.sort((a, b) => {
      const tA = new Date(a.uploadedAt).getTime();
      const tB = new Date(b.uploadedAt).getTime();
      return tB - tA;
    });

    return NextResponse.json({ statements });
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
