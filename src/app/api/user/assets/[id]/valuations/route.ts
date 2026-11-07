import { NextRequest, NextResponse } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase-admin";
import { invalidateFinancialProfileCache } from "@/lib/financialProfile";
import { getTodayInNewYork, isValidDateString } from "@/lib/dateUtils";
import type { AssetValuation, ManualAsset } from "@/lib/types";

function authToken(req: NextRequest): string | null {
  const h = req.headers.get("authorization");
  return h?.startsWith("Bearer ") ? h.slice(7) : null;
}

/**
 * POST /api/user/assets/[id]/valuations
 * Add a new dated valuation entry to an asset.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const token = authToken(req);
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { auth, db } = getFirebaseAdmin();
    const { uid } = await auth.verifyIdToken(token);
    const { id } = await params;
    const body = await req.json();

    // Validate inputs
    const { valueCents, effectiveDate: providedDate } = body;

    if (typeof valueCents !== "number" || !Number.isFinite(valueCents)) {
      return NextResponse.json({ error: "valueCents must be a finite number" }, { status: 400 });
    }

    // Default to today in America/New_York if not provided
    const effectiveDate = providedDate || getTodayInNewYork();

    if (!isValidDateString(effectiveDate)) {
      return NextResponse.json({ error: "effectiveDate must be a valid YYYY-MM-DD date" }, { status: 400 });
    }

    // Fetch asset doc
    const assetRef = db.collection("users").doc(uid).collection("manualAssets").doc(id);
    const assetDoc = await assetRef.get();

    if (!assetDoc.exists) {
      return NextResponse.json({ error: "Asset not found" }, { status: 404 });
    }

    const asset = assetDoc.data() as ManualAsset;

    // Build new valuation entry
    const newValuation: AssetValuation = {
      effectiveDate,
      valueCents,
      createdAt: new Date().toISOString(),
    };

    // Initialize valuations array if this is the first edit
    let valuations: AssetValuation[] = asset.valuations || [];

    // First valuation on a legacy asset: preserve current value as baseline
    if (valuations.length === 0) {
      const baselineCents = Math.round(asset.value * 100);
      const baselineDate = asset.startDate || asset.updatedAt?.slice?.(0, 10) || getTodayInNewYork();
      
      valuations.push({
        effectiveDate: baselineDate,
        valueCents: baselineCents,
        createdAt: asset.updatedAt || new Date().toISOString(),
      });
    }

    // Check for duplicate date (same-day edits)
    const existingIndex = valuations.findIndex((v) => v.effectiveDate === effectiveDate);
    
    if (existingIndex >= 0) {
      // Replace existing entry for this date (same-day edit)
      valuations[existingIndex] = newValuation;
    } else {
      // Add new entry
      valuations.push(newValuation);
    }

    // Sort ascending by effectiveDate (deterministic order)
    valuations.sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate));

    // Update asset with new valuations array and current value
    const latestValuation = valuations[valuations.length - 1];
    const currentValue = latestValuation.valueCents / 100;

    await assetRef.update({
      valuations,
      value: currentValue, // Keep legacy field in sync with latest valuation
      updatedAt: new Date(),
    });

    await invalidateFinancialProfileCache(uid, db);

    return NextResponse.json({ ok: true, valuations });
  } catch (err) {
    console.error("POST /api/user/assets/[id]/valuations error:", err);
    return NextResponse.json({ error: "Failed to add valuation" }, { status: 500 });
  }
}

/**
 * DELETE /api/user/assets/[id]/valuations
 * Delete a specific valuation entry by effectiveDate.
 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const token = authToken(req);
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { auth, db } = getFirebaseAdmin();
    const { uid } = await auth.verifyIdToken(token);
    const { id } = await params;
    
    const url = new URL(req.url);
    const effectiveDate = url.searchParams.get("effectiveDate");

    if (!effectiveDate) {
      return NextResponse.json({ error: "effectiveDate query parameter required" }, { status: 400 });
    }

    if (!isValidDateString(effectiveDate)) {
      return NextResponse.json({ error: "effectiveDate must be a valid YYYY-MM-DD date" }, { status: 400 });
    }

    // Fetch asset doc
    const assetRef = db.collection("users").doc(uid).collection("manualAssets").doc(id);
    const assetDoc = await assetRef.get();

    if (!assetDoc.exists) {
      return NextResponse.json({ error: "Asset not found" }, { status: 404 });
    }

    const asset = assetDoc.data() as ManualAsset;
    let valuations: AssetValuation[] = asset.valuations || [];

    if (valuations.length === 0) {
      return NextResponse.json({ error: "No valuations to delete" }, { status: 400 });
    }

    // Find and remove the entry
    const indexToRemove = valuations.findIndex((v) => v.effectiveDate === effectiveDate);

    if (indexToRemove < 0) {
      return NextResponse.json({ error: "Valuation not found for this date" }, { status: 404 });
    }

    // Guard: cannot delete if it's the only valuation (would erase all history)
    if (valuations.length === 1) {
      return NextResponse.json(
        { error: "Cannot delete the only valuation. Edit the value instead or delete the asset." },
        { status: 400 }
      );
    }

    // Remove the entry
    valuations.splice(indexToRemove, 1);

    // Update current value to match the latest remaining valuation
    const latestValuation = valuations[valuations.length - 1];
    const currentValue = latestValuation.valueCents / 100;

    await assetRef.update({
      valuations,
      value: currentValue,
      updatedAt: new Date(),
    });

    await invalidateFinancialProfileCache(uid, db);

    return NextResponse.json({ ok: true, valuations });
  } catch (err) {
    console.error("DELETE /api/user/assets/[id]/valuations error:", err);
    return NextResponse.json({ error: "Failed to delete valuation" }, { status: 500 });
  }
}
