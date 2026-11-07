import { NextRequest, NextResponse } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase-admin";
import { invalidateFinancialProfileCache } from "@/lib/financialProfile";
import { getTodayInNewYork, isValidDateString } from "@/lib/dateUtils";
import type { AssetValuation, ManualAsset } from "@/lib/types";
import { randomBytes } from "crypto";

function authToken(req: NextRequest): string | null {
  const h = req.headers.get("authorization");
  return h?.startsWith("Bearer ") ? h.slice(7) : null;
}

function generateValuationId(): string {
  return randomBytes(16).toString("hex");
}

/**
 * POST /api/user/assets/[id]/valuations
 * Add a new dated valuation entry to an asset.
 * Uses Firestore transactions for atomic updates.
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

    const assetRef = db.collection("users").doc(uid).collection("manualAssets").doc(id);

    // Use transaction for atomic read-modify-write
    const result = await db.runTransaction(async (transaction) => {
      const assetDoc = await transaction.get(assetRef);

      if (!assetDoc.exists) {
        throw new Error("Asset not found");
      }

      const asset = assetDoc.data() as ManualAsset;

      // Build new valuation entry with unique ID
      const newValuation: AssetValuation = {
        id: generateValuationId(),
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
          id: generateValuationId(),
          effectiveDate: baselineDate,
          valueCents: baselineCents,
          createdAt: asset.updatedAt || new Date().toISOString(),
        });
      }

      // Add new entry (multiple same-day entries allowed, each with unique ID)
      valuations.push(newValuation);

      // Sort by effectiveDate ascending, then by createdAt for same-day determinism
      valuations.sort((a, b) => {
        const dateCmp = a.effectiveDate.localeCompare(b.effectiveDate);
        if (dateCmp !== 0) return dateCmp;
        return a.createdAt.localeCompare(b.createdAt);
      });

      // Update asset with new valuations array and current value
      const latestValuation = valuations[valuations.length - 1];
      const currentValue = latestValuation.valueCents / 100;

      transaction.update(assetRef, {
        valuations,
        value: currentValue, // Keep legacy field in sync with latest valuation
        updatedAt: new Date(),
      });

      return { valuations };
    });

    await invalidateFinancialProfileCache(uid, db);

    return NextResponse.json({ ok: true, valuations: result.valuations });
  } catch (err) {
    console.error("POST /api/user/assets/[id]/valuations error:", err);
    if (err instanceof Error && err.message === "Asset not found") {
      return NextResponse.json({ error: "Asset not found" }, { status: 404 });
    }
    return NextResponse.json({ error: "Failed to add valuation" }, { status: 500 });
  }
}

/**
 * DELETE /api/user/assets/[id]/valuations
 * Delete a specific valuation entry by ID.
 * Uses Firestore transactions for atomic updates.
 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const token = authToken(req);
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { auth, db } = getFirebaseAdmin();
    const { uid } = await auth.verifyIdToken(token);
    const { id } = await params;
    
    const url = new URL(req.url);
    const valuationId = url.searchParams.get("valuationId");

    if (!valuationId) {
      return NextResponse.json({ error: "valuationId query parameter required" }, { status: 400 });
    }

    const assetRef = db.collection("users").doc(uid).collection("manualAssets").doc(id);

    // Use transaction for atomic read-modify-write
    const result = await db.runTransaction(async (transaction) => {
      const assetDoc = await transaction.get(assetRef);

      if (!assetDoc.exists) {
        throw new Error("Asset not found");
      }

      const asset = assetDoc.data() as ManualAsset;
      let valuations: AssetValuation[] = asset.valuations || [];

      if (valuations.length === 0) {
        throw new Error("No valuations to delete");
      }

      // Find and remove the entry by ID
      const indexToRemove = valuations.findIndex((v) => v.id === valuationId);

      if (indexToRemove < 0) {
        throw new Error("Valuation not found");
      }

      // Guard: cannot delete if it's the only valuation (would erase all history)
      if (valuations.length === 1) {
        throw new Error("Cannot delete the only valuation. Edit the value instead or delete the asset.");
      }

      // Remove the entry
      valuations.splice(indexToRemove, 1);

      // Update current value to match the latest remaining valuation
      const latestValuation = valuations[valuations.length - 1];
      const currentValue = latestValuation.valueCents / 100;

      transaction.update(assetRef, {
        valuations,
        value: currentValue,
        updatedAt: new Date(),
      });

      return { valuations };
    });

    await invalidateFinancialProfileCache(uid, db);

    return NextResponse.json({ ok: true, valuations: result.valuations });
  } catch (err) {
    console.error("DELETE /api/user/assets/[id]/valuations error:", err);
    if (err instanceof Error) {
      if (err.message === "Asset not found") {
        return NextResponse.json({ error: "Asset not found" }, { status: 404 });
      }
      if (err.message === "No valuations to delete") {
        return NextResponse.json({ error: "No valuations to delete" }, { status: 400 });
      }
      if (err.message === "Valuation not found") {
        return NextResponse.json({ error: "Valuation not found" }, { status: 404 });
      }
      if (err.message.includes("Cannot delete the only valuation")) {
        return NextResponse.json({ error: err.message }, { status: 400 });
      }
    }
    return NextResponse.json({ error: "Failed to delete valuation" }, { status: 500 });
  }
}
