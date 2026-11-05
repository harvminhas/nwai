/**
 * GET    /api/user/hubs              — list all general hubs
 * POST   /api/user/hubs              — create a new general hub
 */

import { NextRequest, NextResponse } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase-admin";
import { resolveAccess } from "@/lib/access/resolveAccess";
import type { GeneralHub } from "@/lib/types";

const HUB_COLORS = [
  "blue", "purple", "pink", "green", "yellow", "orange", "red", "indigo", "teal", "cyan",
];

function randomColor(): string {
  return HUB_COLORS[Math.floor(Math.random() * HUB_COLORS.length)];
}

export async function GET(req: NextRequest) {
  const { db } = getFirebaseAdmin();
  const access = await resolveAccess(req, db);
  if (!access) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { targetUid } = access;

  try {
    const snap = await db.collection(`users/${targetUid}/hubs`)
      .orderBy("createdAt", "desc")
      .get();

    const hubs: GeneralHub[] = snap.docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        name: data.name ?? "",
        color: data.color ?? "blue",
        createdAt: data.createdAt?.toDate?.()?.toISOString?.() ?? data.createdAt ?? new Date().toISOString(),
        updatedAt: data.updatedAt?.toDate?.()?.toISOString?.() ?? data.updatedAt ?? new Date().toISOString(),
      };
    });

    return NextResponse.json({ hubs });
  } catch (err) {
    console.error("[hubs] GET error", err);
    return NextResponse.json({ error: "Failed to load hubs" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const { db } = getFirebaseAdmin();
  const access = await resolveAccess(req, db);
  if (!access) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { actorUid } = access;

  try {
    const body = await req.json() as {
      name: string;
      color?: string;
    };

    if (!body.name?.trim()) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }

    const now = new Date();
    const hubData = {
      name: body.name.trim(),
      color: body.color ?? randomColor(),
      createdAt: now,
      updatedAt: now,
    };

    const ref = await db.collection(`users/${actorUid}/hubs`).add(hubData);

    const hub: GeneralHub = {
      id: ref.id,
      name: hubData.name,
      color: hubData.color,
      createdAt: hubData.createdAt.toISOString(),
      updatedAt: hubData.updatedAt.toISOString(),
    };

    return NextResponse.json({ hub });
  } catch (err) {
    console.error("[hubs] POST error", err);
    return NextResponse.json({ error: "Failed to create hub" }, { status: 500 });
  }
}
