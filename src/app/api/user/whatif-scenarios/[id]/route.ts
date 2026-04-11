/**
 * PUT    /api/user/whatif-scenarios/[id]  — update a scenario
 * DELETE /api/user/whatif-scenarios/[id]  — delete a scenario
 */

import { NextRequest, NextResponse } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase-admin";
import { resolveAccess } from "@/lib/access/resolveAccess";
import type { ScenarioColor } from "@/lib/whatIf/types";

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { db }  = getFirebaseAdmin();
  const access  = await resolveAccess(req, db);
  if (!access) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { actorUid } = access;

  const { id } = await params;

  try {
    const body = await req.json() as {
      name?:    string;
      inputs?:  Record<string, number | string | boolean>;
      enabled?: boolean;
      color?:   ScenarioColor;
    };

    const ref = db.collection(`users/${actorUid}/whatIfScenarios`).doc(id);
    const existing = await ref.get();
    if (!existing.exists) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };
    if (body.name    !== undefined) updates.name    = body.name.trim();
    if (body.inputs  !== undefined) updates.inputs  = body.inputs;
    if (body.enabled !== undefined) updates.enabled = body.enabled;
    if (body.color   !== undefined) updates.color   = body.color;

    await ref.update(updates);

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("whatif-scenarios PUT error", err);
    return NextResponse.json({ error: "Failed to update scenario" }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { db }  = getFirebaseAdmin();
  const access  = await resolveAccess(req, db);
  if (!access) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { actorUid } = access;

  const { id } = await params;

  try {
    await db.collection(`users/${actorUid}/whatIfScenarios`).doc(id).delete();
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("whatif-scenarios DELETE error", err);
    return NextResponse.json({ error: "Failed to delete scenario" }, { status: 500 });
  }
}
