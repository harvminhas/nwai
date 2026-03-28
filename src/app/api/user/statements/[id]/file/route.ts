import { NextRequest, NextResponse } from "next/server";
import { getFirebaseAdmin, getStorageBucketName } from "@/lib/firebase-admin";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const token = request.headers.get("authorization")?.replace("Bearer ", "");
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { auth, db, storage } = getFirebaseAdmin();
    const decoded = await auth.verifyIdToken(token);
    const uid = decoded.uid;

    const { id } = await params;
    const doc = await db.collection("statements").doc(id).get();

    if (!doc.exists) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const data = doc.data()!;

    // Ensure the statement belongs to this user
    if (data.userId !== uid) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const fileUrl = data.fileUrl as string | undefined;
    if (!fileUrl) {
      return NextResponse.json({ error: "No file attached to this statement" }, { status: 404 });
    }

    const bucketName = (data.storageBucket as string | undefined) || getStorageBucketName();
    const bucket = storage.bucket(bucketName);
    const [contents] = await bucket.file(fileUrl).download();

    const contentType =
      (data.contentType as string | undefined) ||
      (fileUrl.toLowerCase().endsWith(".pdf") ? "application/pdf" : "image/jpeg");

    const fileName = (data.fileName as string | undefined) || fileUrl.split("/").pop() || "document";

    return new NextResponse(contents as unknown as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `inline; filename="${fileName}"`,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (err) {
    console.error("[statements/file] error", err);
    return NextResponse.json({ error: "Failed to retrieve file" }, { status: 500 });
  }
}
