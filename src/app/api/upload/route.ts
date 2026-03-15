import { NextRequest, NextResponse } from "next/server";
import {
  getFirebaseAdmin,
  FirebaseAdminCredentialsError,
  getStorageBucketName,
} from "@/lib/firebase-admin";
import { randomUUID, createHash } from "crypto";

function isBucketNotFound(err: unknown): boolean {
  if (err && typeof err === "object") {
    const status = (err as { status?: number }).status;
    const message = String((err as { message?: string }).message || "");
    return status === 404 || message.includes("does not exist");
  }
  return false;
}

/** Firestore NOT_FOUND (5) = database not created or wrong project. */
function isFirestoreNotFound(err: unknown): boolean {
  if (err && typeof err === "object") {
    const code = (err as { code?: number }).code;
    const message = String((err as { message?: string }).message || "");
    return code === 5 || message.includes("NOT_FOUND");
  }
  return false;
}

const MAX_SIZE = 10 * 1024 * 1024; // 10MB
const FREE_UPLOADS_PER_MONTH = 5;
const ALLOWED_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/jpg",
  "text/csv",
  "application/csv",
  "text/comma-separated-values",
];

export async function POST(request: NextRequest) {
  try {
    let userId: string | null = null;
    let decoded: { uid: string; email?: string; name?: string } | null = null;
    const authHeader = request.headers.get("authorization");
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (token) {
      try {
        const { auth } = getFirebaseAdmin();
        decoded = await auth.verifyIdToken(token);
        userId = decoded.uid;
      } catch (_) {
        // proceed as unauthenticated
      }
    }

    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    if (!file || typeof file === "string") {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    if (file.size > MAX_SIZE) {
      return NextResponse.json(
        { error: "Please upload a file under 10MB" },
        { status: 400 }
      );
    }

    const type = file.type.toLowerCase();
    const nameLower = file.name.toLowerCase();
    const extOk =
      nameLower.endsWith(".pdf") ||
      nameLower.endsWith(".png") ||
      nameLower.endsWith(".jpg") ||
      nameLower.endsWith(".jpeg") ||
      nameLower.endsWith(".csv");
    if (!ALLOWED_TYPES.some((t) => t === type) && !extOk) {
      return NextResponse.json(
        { error: "Please upload PDF, CSV, PNG, or JPG" },
        { status: 400 }
      );
    }

    const { db, storage } = getFirebaseAdmin();
    const projectId =
      process.env.FIREBASE_PROJECT_ID ||
      process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
    let bucketName = getStorageBucketName();

    const buffer = Buffer.from(await file.arrayBuffer());
    const fileHash = createHash("sha256").update(buffer).digest("hex");

    // Check for exact duplicate BEFORE counting against the monthly limit
    if (userId) {
      const dupSnap = await db
        .collection("statements")
        .where("userId", "==", userId)
        .where("fileHash", "==", fileHash)
        .limit(1)
        .get();
      if (!dupSnap.empty) {
        const dup = dupSnap.docs[0];
        return NextResponse.json(
          {
            error: "duplicate",
            message: "You've already uploaded this exact file.",
            existingStatementId: dup.id,
            existingStatus: dup.data().status,
          },
          { status: 409 }
        );
      }
    }

    // Check and increment monthly upload counter (only for genuine new uploads)
    if (userId) {
      const usersRef = db.collection("users").doc(userId);
      const userDoc = await usersRef.get();
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

      // Count actual statements this month — no stale counter issues
      const uploadsSnap = await db
        .collection("statements")
        .where("userId", "==", userId)
        .where("uploadedAt", ">=", monthStart)
        .get();
      const uploadsThisMonth = uploadsSnap.size;

      if (uploadsThisMonth >= FREE_UPLOADS_PER_MONTH) {
        return NextResponse.json(
          { error: "Free plan limit: 5 uploads per month. Upgrade for more." },
          { status: 403 }
        );
      }
      const nextReset = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      await usersRef.set(
        {
          uid: userId,
          email: decoded?.email ?? "",
          displayName: decoded?.name ?? decoded?.email ?? "",
          plan: "free",
          uploadsThisMonth: uploadsThisMonth + 1,
          uploadsResetAt: nextReset,
          updatedAt: now,
          ...(userDoc.exists ? {} : { createdAt: now }),
        },
        { merge: true }
      );
    }

    const statementId = randomUUID();
    const ext = file.name.split(".").pop() || "bin";
    const storagePath = `statements/${statementId}/statement.${ext}`;

    let bucket = storage.bucket(bucketName);
    try {
      const storageFile = bucket.file(storagePath);
      await storageFile.save(buffer, {
        contentType: file.type,
        metadata: { contentType: file.type },
      });
    } catch (bucketErr) {
      if (isBucketNotFound(bucketErr) && projectId) {
        bucketName = `${projectId}.appspot.com`;
        bucket = storage.bucket(bucketName);
        const storageFile = bucket.file(storagePath);
        await storageFile.save(buffer, {
          contentType: file.type,
          metadata: { contentType: file.type },
        });
      } else {
        throw bucketErr;
      }
    }

    const statementRef = db.collection("statements").doc(statementId);
    await statementRef.set({
      id: statementId,
      userId,
      uploadedAt: new Date(),
      fileName: file.name,
      fileUrl: storagePath,
      storageBucket: bucketName,
      contentType: file.type,
      status: "processing",
      fileHash,
    });

    // Parse is triggered by the client after this response, not here,
    // because Vercel terminates server-side background fetches when the response is sent.
    return NextResponse.json({ statementId });
  } catch (err) {
    if (err instanceof FirebaseAdminCredentialsError) {
      return NextResponse.json(
        {
          error:
            "Server setup incomplete: Firebase Admin credentials are missing. Add FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY to .env.local (from Firebase Console > Project Settings > Service Accounts > Generate new private key).",
        },
        { status: 503 }
      );
    }
    if (isFirestoreNotFound(err)) {
      return NextResponse.json(
        {
          error:
            "Firestore is not set up. In Firebase Console: Build → Firestore Database → Create database (choose a location, start in production or test mode). Then try again.",
        },
        { status: 503 }
      );
    }
    console.error("Upload error:", err);
    return NextResponse.json(
      { error: "Upload failed. Please try again." },
      { status: 500 }
    );
  }
}
