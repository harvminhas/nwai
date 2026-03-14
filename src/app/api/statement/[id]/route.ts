import { NextRequest, NextResponse } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase-admin";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: "Missing statement id" }, { status: 400 });
    }

    const { db } = getFirebaseAdmin();
    const doc = await db.collection("statements").doc(id).get();
    if (!doc.exists) {
      return NextResponse.json({ error: "Statement not found" }, { status: 404 });
    }

    const data = doc.data();
    const status = data?.status ?? "processing";
    const response: {
      status: string;
      parsedData?: unknown;
      errorMessage?: string;
      statementId?: string;
    } = { status, statementId: id };

    if (status === "completed" && data?.parsedData) {
      response.parsedData = data.parsedData;
    }
    if (status === "error" && data?.errorMessage) {
      response.errorMessage = data.errorMessage;
    }

    return NextResponse.json(response);
  } catch (err) {
    console.error("Get statement error:", err);
    return NextResponse.json(
      { error: "Failed to load statement" },
      { status: 500 }
    );
  }
}
