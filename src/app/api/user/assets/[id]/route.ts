import { NextRequest, NextResponse } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase-admin";
import { invalidateFinancialProfileCache } from "@/lib/financialProfile";
import { getTodayInNewYork } from "@/lib/dateUtils";
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
 * PUT /api/user/assets/[id]
 * Update asset properties.
 * If value changes, automatically appends a dated valuation (unless creating new asset).
 * Name/rate-only edits don't append valuations.
 * Uses Firestore transactions for atomic updates.
 */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const token = authToken(req);
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  
  try {
    const { auth, db } = getFirebaseAdmin();
    const { uid } = await auth.verifyIdToken(token);
    const { id } = await params;
    const body = await req.json();
    const { label, category, value, linkedAccountSlug, startDate, annualGrowthRate } = body;
    
    if (!label || typeof value !== "number") {
      return NextResponse.json({ error: "label and value are required" }, { status: 400 });
    }
    
    // Validate startDate format and value if provided
    if (startDate !== undefined) {
      if (startDate !== null && typeof startDate !== 'string') {
        return NextResponse.json({ error: "startDate must be a string or null" }, { status: 400 });
      }
      if (startDate && !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
        return NextResponse.json({ error: "startDate must be YYYY-MM-DD format" }, { status: 400 });
      }
      if (startDate) {
        const date = new Date(startDate + 'T00:00:00Z'); // Parse as UTC midnight
        if (isNaN(date.getTime())) {
          return NextResponse.json({ error: "startDate must be a valid calendar date" }, { status: 400 });
        }
        // Verify it's a valid calendar date (catches 2024-02-30 etc)
        const [y, m, d] = startDate.split('-').map(Number);
        const testDate = new Date(y, m - 1, d);
        if (testDate.getFullYear() !== y || testDate.getMonth() !== m - 1 || testDate.getDate() !== d) {
          return NextResponse.json({ error: "startDate must be a valid calendar date" }, { status: 400 });
        }
      }
    }

    // Validate annualGrowthRate if provided
    if (annualGrowthRate !== undefined && annualGrowthRate !== null) {
      if (typeof annualGrowthRate !== 'number' || !Number.isFinite(annualGrowthRate)) {
        return NextResponse.json({ error: "annualGrowthRate must be a finite number or null" }, { status: 400 });
      }
      // Reasonable bounds: -100% to +100% per year
      if (annualGrowthRate < -100 || annualGrowthRate > 100) {
        return NextResponse.json({ error: "annualGrowthRate must be between -100 and 100" }, { status: 400 });
      }
    }
    
    const assetRef = db.collection("users").doc(uid).collection("manualAssets").doc(id);

    // Use transaction for atomic read-modify-write
    await db.runTransaction(async (transaction) => {
      const assetDoc = await transaction.get(assetRef);

      if (!assetDoc.exists) {
        throw new Error("Asset not found");
      }

      const existingAsset = assetDoc.data() as ManualAsset;
      const valueCentsNew = Math.round(value * 100);
      const valueCentsOld = Math.round(existingAsset.value * 100);
      const valueChanged = valueCentsNew !== valueCentsOld;

      // Build update object
      const doc: Record<string, unknown> = {
        label,
        category: category ?? "other",
        value,
        updatedAt: new Date(),
      };
      
      if (linkedAccountSlug !== undefined) {
        doc.linkedAccountSlug = linkedAccountSlug ?? null;
      }
      if (startDate !== undefined) {
        doc.startDate = startDate === null || startDate === "" ? null : startDate;
      }
      if (annualGrowthRate !== undefined) {
        doc.annualGrowthRate = annualGrowthRate === null || annualGrowthRate === "" ? null : annualGrowthRate;
      }

      // If value changed, append a dated valuation
      if (valueChanged) {
        let valuations: AssetValuation[] = existingAsset.valuations || [];

        // First valuation on a legacy asset: preserve OLD value as baseline
        if (valuations.length === 0) {
          const baselineCents = valueCentsOld;
          const baselineDate = existingAsset.startDate || existingAsset.updatedAt?.slice?.(0, 10) || getTodayInNewYork();
          
          valuations.push({
            id: generateValuationId(),
            effectiveDate: baselineDate,
            valueCents: baselineCents,
            createdAt: existingAsset.updatedAt || new Date().toISOString(),
          });
        }

        // Append new valuation for today
        const newValuation: AssetValuation = {
          id: generateValuationId(),
          effectiveDate: getTodayInNewYork(),
          valueCents: valueCentsNew,
          createdAt: new Date().toISOString(),
        };

        valuations.push(newValuation);

        // Sort by effectiveDate ascending, then by createdAt for same-day determinism
        valuations.sort((a, b) => {
          const dateCmp = a.effectiveDate.localeCompare(b.effectiveDate);
          if (dateCmp !== 0) return dateCmp;
          return a.createdAt.localeCompare(b.createdAt);
        });

        doc.valuations = valuations;
      }

      transaction.set(assetRef, doc, { merge: true });
    });

    await invalidateFinancialProfileCache(uid, db);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("PUT /api/user/assets/[id] error:", err);
    if (err instanceof Error && err.message === "Asset not found") {
      return NextResponse.json({ error: "Asset not found" }, { status: 404 });
    }
    return NextResponse.json({ error: "Failed to update asset" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const token = authToken(req);
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const { auth, db } = getFirebaseAdmin();
    const { uid } = await auth.verifyIdToken(token);
    const { id } = await params;
    await db.collection("users").doc(uid).collection("manualAssets").doc(id).delete();
    await invalidateFinancialProfileCache(uid, db);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("DELETE /api/user/assets/[id] error:", err);
    return NextResponse.json({ error: "Failed to delete asset" }, { status: 500 });
  }
}
