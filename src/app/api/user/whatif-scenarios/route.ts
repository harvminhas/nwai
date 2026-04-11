/**
 * GET  /api/user/whatif-scenarios  — list all saved What-If scenarios
 * POST /api/user/whatif-scenarios  — create a new scenario
 */

import { NextRequest, NextResponse } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase-admin";
import { resolveAccess } from "@/lib/access/resolveAccess";
import type { WhatIfScenario, ScenarioColor, TemplateId } from "@/lib/whatIf/types";
import { colorForIndex } from "@/lib/whatIf/types";
import { randomUUID } from "crypto";

const VALID_TEMPLATE_IDS = new Set(["purchase", "buyrent", "car", "levers", "salary", "payoff"]);

export async function GET(req: NextRequest) {
  const { db } = getFirebaseAdmin();
  const access  = await resolveAccess(req, db);
  if (!access) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { targetUid } = access;

  try {
    const snap = await db
      .collection(`users/${targetUid}/whatIfScenarios`)
      .orderBy("createdAt", "asc")
      .get();

    const scenarios: WhatIfScenario[] = snap.docs.map((d) => ({
      id: d.id,
      ...(d.data() as Omit<WhatIfScenario, "id">),
    }));

    return NextResponse.json({ scenarios });
  } catch (err) {
    console.error("whatif-scenarios GET error", err);
    return NextResponse.json({ error: "Failed to load scenarios" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const { db } = getFirebaseAdmin();
  const access  = await resolveAccess(req, db);
  if (!access) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { actorUid } = access;

  try {
    const body = await req.json() as {
      name:       string;
      templateId: string;
      inputs:     Record<string, number | string | boolean>;
      color?:     ScenarioColor;
    };

    if (!body.name || typeof body.name !== "string") {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }
    if (!VALID_TEMPLATE_IDS.has(body.templateId)) {
      return NextResponse.json({ error: "invalid templateId" }, { status: 400 });
    }

    // Auto-assign color from the count of existing scenarios (round-robin)
    let color = body.color;
    if (!color) {
      const countSnap = await db
        .collection(`users/${actorUid}/whatIfScenarios`)
        .count()
        .get();
      color = colorForIndex(countSnap.data().count);
    }

    const now = new Date().toISOString();
    const id  = randomUUID();

    const doc: Omit<WhatIfScenario, "id"> = {
      name:       body.name.trim(),
      templateId: body.templateId as TemplateId,
      inputs:     body.inputs ?? {},
      enabled:    true,
      color,
      createdAt:  now,
      updatedAt:  now,
    };

    await db.collection(`users/${actorUid}/whatIfScenarios`).doc(id).set(doc);

    return NextResponse.json({ scenario: { id, ...doc } }, { status: 201 });
  } catch (err) {
    console.error("whatif-scenarios POST error", err);
    return NextResponse.json({ error: "Failed to create scenario" }, { status: 500 });
  }
}
