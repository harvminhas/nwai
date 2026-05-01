import { NextRequest, NextResponse } from "next/server";
import {
  getFirebaseAdmin,
  FirebaseAdminCredentialsError,
  getStorageBucketName,
} from "@/lib/firebase-admin";
import { randomUUID, createHash } from "crypto";

export const maxDuration = 30;

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

// Configurable upload limits for free-tier users.
// Override via env vars to adjust without a code deploy.
// ONE_TIME: lifetime allotment, carries over indefinitely.
// MONTHLY:  resets on the 1st of each month, unused quota does NOT carry over.
const FREE_ONETIME_UPLOADS = parseInt(
  process.env.FREE_ONETIME_UPLOADS ?? "50", 10
);
const FREE_MONTHLY_UPLOADS = parseInt(
  process.env.FREE_MONTHLY_UPLOADS ?? "8", 10
);
const ALLOWED_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/jpg",
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
      nameLower.endsWith(".jpeg");
    if (!ALLOWED_TYPES.some((t) => t === type) && !extOk) {
      return NextResponse.json(
        { error: "Please upload a PDF or image of your bank statement." },
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
        const existingStatus = dup.data().status as string | undefined;

        // If the previous attempt failed, reset it so the client can re-trigger parsing.
        // Do NOT create a second storage copy — reuse the original file.
        if (existingStatus === "error") {
          await dup.ref.update({ status: "processing", errorMessage: null });
          return NextResponse.json({ statementId: dup.id, retrying: true });
        }

        return NextResponse.json(
          {
            error: "duplicate",
            message: "You've already uploaded this exact file.",
            existingStatementId: dup.id,
            existingStatus,
          },
          { status: 409 }
        );
      }
    }

    // Enforce upload limits and track usage for free-tier users.
    if (userId) {
      const usersRef = db.collection("users").doc(userId);
      const userDoc  = await usersRef.get();
      const userData = userDoc.exists ? userDoc.data() ?? {} : {};
      const now      = new Date();

      const userPlan: string = userData.plan ?? "free";
      const isPaidPlan = userPlan === "pro" || userPlan === "family";

      if (!isPaidPlan) {
        // ── One-time pool ────────────────────────────────────────────────────
        // Tracks total uploads across the account's lifetime.
        // Decrements once; never resets.
        const onetimeUsed: number = userData.onetimeUploadsUsed ?? 0;
        const onetimeRemaining = Math.max(0, FREE_ONETIME_UPLOADS - onetimeUsed);

        if (onetimeRemaining > 0) {
          // Consume from one-time allotment
          await usersRef.set(
            {
              uid: userId,
              email: decoded?.email ?? "",
              displayName: decoded?.name ?? decoded?.email ?? "",
              onetimeUploadsUsed: onetimeUsed + 1,
              updatedAt: now,
              ...(userDoc.exists ? {} : { createdAt: now }),
            },
            { merge: true }
          );
        } else {
          // ── Monthly pool ───────────────────────────────────────────────────
          // Resets on the 1st of each calendar month; unused quota does NOT carry over.
          const monthStart     = new Date(now.getFullYear(), now.getMonth(), 1);
          const storedResetAt: Date | null = userData.monthlyUploadsResetAt?.toDate?.() ?? null;
          const isNewMonth = !storedResetAt || storedResetAt < monthStart;
          const monthlyUsed: number = isNewMonth ? 0 : (userData.monthlyUploadsUsed ?? 0);

          if (monthlyUsed >= FREE_MONTHLY_UPLOADS) {
            return NextResponse.json(
              {
                error: `You've used your ${FREE_MONTHLY_UPLOADS} monthly uploads and your ${FREE_ONETIME_UPLOADS} one-time uploads. Upgrade for unlimited uploads.`,
              },
              { status: 403 }
            );
          }

          const nextReset = new Date(now.getFullYear(), now.getMonth() + 1, 1);
          await usersRef.set(
            {
              uid: userId,
              email: decoded?.email ?? "",
              displayName: decoded?.name ?? decoded?.email ?? "",
              monthlyUploadsUsed: monthlyUsed + 1,
              monthlyUploadsResetAt: nextReset,
              updatedAt: now,
              ...(userDoc.exists ? {} : { createdAt: now }),
            },
            { merge: true }
          );
        }
      } else {
        // Paid plan — unlimited; just ensure user doc exists
        await usersRef.set(
          {
            uid: userId,
            email: decoded?.email ?? "",
            displayName: decoded?.name ?? decoded?.email ?? "",
            updatedAt: now,
            ...(userDoc.exists ? {} : { createdAt: now }),
          },
          { merge: true }
        );
      }
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
