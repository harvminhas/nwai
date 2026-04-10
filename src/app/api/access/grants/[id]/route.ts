/**
 * DELETE /api/access/grants/[id]  — unlink partner (id is ignored; unlinks current user)
 */

import { NextRequest, NextResponse } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase-admin";
import { unlinkPartner } from "@/lib/access/linkedPartner";

function authToken(req: NextRequest): string | null {
  return req.headers.get("authorization")?.replace("Bearer ", "").trim() ?? null;
}

export async function DELETE(req: NextRequest) {
  const token = authToken(req);
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { auth, db } = getFirebaseAdmin();
    const { uid } = await auth.verifyIdToken(token);
    await unlinkPartner(uid, db);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[access/grants/unlink] DELETE error", err);
    return NextResponse.json({ error: "Failed to unlink" }, { status: 500 });
  }
}
