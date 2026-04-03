import { NextRequest, NextResponse } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase-admin";
import type { SourceMapping } from "@/lib/sourceMappings";

async function getUid(request: NextRequest): Promise<string | null> {
  const token = request.headers.get("authorization")?.replace("Bearer ", "");
  if (!token) return null;
  try {
    const { auth } = getFirebaseAdmin();
    const decoded = await auth.verifyIdToken(token);
    return decoded.uid;
  } catch {
    return null;
  }
}

/** GET /api/user/source-mappings — return all mappings for the user */
export async function GET(request: NextRequest) {
  const uid = await getUid(request);
  if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { db } = getFirebaseAdmin();
  const snap = await db.collection(`users/${uid}/sourceMappings`).get();
  const mappings: SourceMapping[] = snap.docs.map((d) => ({
    id: d.id,
    ...(d.data() as Omit<SourceMapping, "id">),
  }));
  return NextResponse.json({ mappings });
}

/**
 * POST /api/user/source-mappings — batch upsert mappings.
 * Body: { mappings: SourceMapping[] }
 * Uses canonical+alias as the document ID so re-submissions are idempotent.
 */
export async function POST(request: NextRequest) {
  const uid = await getUid(request);
  if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const incoming: SourceMapping[] = body.mappings ?? [];
  if (!Array.isArray(incoming) || incoming.length === 0) {
    return NextResponse.json({ error: "No mappings provided" }, { status: 400 });
  }

  const { db } = getFirebaseAdmin();
  const batch = db.batch();
  for (const m of incoming) {
    // Stable doc ID: derived from the pair so upserts are idempotent
    const docId = m.pairKey?.replace(/\|/g, "_") ?? `${Date.now()}`;
    const ref = db.doc(`users/${uid}/sourceMappings/${docId}`);
    batch.set(ref, {
      type:         m.type,
      canonical:    m.canonical,
      alias:        m.alias,
      status:       m.status,
      pairKey:      m.pairKey ?? "",
      affectsCache: m.affectsCache ?? false,
      createdAt:    m.createdAt ?? new Date().toISOString(),
    }, { merge: true });
  }
  await batch.commit();

  return NextResponse.json({ saved: incoming.length });
}
