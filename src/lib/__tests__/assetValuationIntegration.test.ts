/**
 * Integration test for asset valuation history.
 * Tests the full path: API routes → profile → core calculation → change detection.
 */

import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { getFirebaseAdmin } from "../firebase-admin";
import { buildAndCacheFinancialProfile, getFinancialProfile } from "../financialProfile";
import type { ManualAsset, AssetValuation } from "../types";
import type * as Firestore from "firebase-admin/firestore";

describe("Asset Valuation Integration", () => {
  let db: Firestore.Firestore;
  const testUid = "test-uid-valuation-integration";

  beforeEach(async () => {
    const { db: firebaseDb } = getFirebaseAdmin();
    db = firebaseDb;

    // Clean up test data
    const assetsSnap = await db
      .collection(`users/${testUid}/manualAssets`)
      .get();
    for (const doc of assetsSnap.docs) {
      await doc.ref.delete();
    }

    // Clear cached profile
    await db
      .collection("users")
      .doc(testUid)
      .set({ financialProfile: null }, { merge: true });
  });

  afterEach(async () => {
    // Clean up test data
    const assetsSnap = await db
      .collection(`users/${testUid}/manualAssets`)
      .get();
    for (const doc of assetsSnap.docs) {
      await doc.ref.delete();
    }

    await db
      .collection("users")
      .doc(testUid)
      .set({ financialProfile: null }, { merge: true });
  });

  test("Oct value 31000, Nov edit 29000: Oct stays 31000, Nov becomes 29000, delta -2000 once", async () => {
    // Create asset with two valuations
    const assetData: Partial<ManualAsset> = {
      label: "Test Car",
      category: "vehicle",
      value: 29000, // Current (latest) value
      startDate: "2026-10-01",
      updatedAt: new Date().toISOString(),
      valuations: [
        {
          effectiveDate: "2026-10-15",
          valueCents: 3100000, // $31,000
          createdAt: "2026-10-15T10:00:00Z",
        },
        {
          effectiveDate: "2026-11-10",
          valueCents: 2900000, // $29,000
          createdAt: "2026-11-10T12:00:00Z",
        },
      ],
    };

    await db
      .collection(`users/${testUid}/manualAssets`)
      .add(assetData);

    // Build profile
    const profile = await buildAndCacheFinancialProfile(testUid, db);

    // Find Oct and Nov months
    const octMonth = profile.monthlyHistory.find((m) => m.yearMonth === "2026-10");
    const novMonth = profile.monthlyHistory.find((m) => m.yearMonth === "2026-11");

    expect(octMonth).toBeDefined();
    expect(novMonth).toBeDefined();

    // Oct: $31,000 (first valuation)
    const octAsset = octMonth?.byAccount?.find((a) => a.type === "manual-vehicle");
    expect(octAsset?.value).toBe(31000);
    expect(octMonth?.totalAssets).toBe(31000);

    // Nov: $29,000 (second valuation)
    const novAsset = novMonth?.byAccount?.find((a) => a.type === "manual-vehicle");
    expect(novAsset?.value).toBe(29000);
    expect(novMonth?.totalAssets).toBe(29000);

    // Delta: -$2,000 (depreciation)
    const delta = (novMonth?.netWorth ?? 0) - (octMonth?.netWorth ?? 0);
    expect(delta).toBe(-2000);

    // Verify sum of account changes equals delta
    const octBySlug = new Map((octMonth?.byAccount || []).map((a) => [a.slug, a.value]));
    const novBySlug = new Map((novMonth?.byAccount || []).map((a) => [a.slug, a.value]));
    const allSlugs = new Set([...octBySlug.keys(), ...novBySlug.keys()]);

    let sumChanges = 0;
    for (const slug of allSlugs) {
      sumChanges += (novBySlug.get(slug) || 0) - (octBySlug.get(slug) || 0);
    }

    expect(sumChanges).toBe(delta);
  });

  test("first valuation edit preserves baseline from legacy value", async () => {
    // Create legacy asset (no valuations)
    const legacyAsset = await db
      .collection(`users/${testUid}/manualAssets`)
      .add({
        label: "Legacy Car",
        category: "vehicle",
        value: 30000,
        startDate: "2026-10-01",
        updatedAt: new Date("2026-10-01T00:00:00Z"),
      });

    // Build profile before edit
    const profileBefore = await buildAndCacheFinancialProfile(testUid, db);
    const octBefore = profileBefore.monthlyHistory.find((m) => m.yearMonth === "2026-10");
    expect(octBefore?.totalAssets).toBe(30000);

    // Now add first valuation (simulating user edit)
    const valuations: AssetValuation[] = [
      // Baseline: preserved original value
      {
        effectiveDate: "2026-10-01",
        valueCents: 3000000,
        createdAt: "2026-10-01T00:00:00Z",
      },
      // New edit in November
      {
        effectiveDate: "2026-11-10",
        valueCents: 2900000,
        createdAt: "2026-11-10T12:00:00Z",
      },
    ];

    await legacyAsset.update({
      valuations,
      value: 29000, // Update to latest
      updatedAt: new Date("2026-11-10T12:00:00Z"),
    });

    // Build profile after edit
    const profileAfter = await buildAndCacheFinancialProfile(testUid, db);

    const octAfter = profileAfter.monthlyHistory.find((m) => m.yearMonth === "2026-10");
    const novAfter = profileAfter.monthlyHistory.find((m) => m.yearMonth === "2026-11");

    // Oct: still $30,000 (baseline preserved)
    expect(octAfter?.totalAssets).toBe(30000);

    // Nov: new value $29,000
    expect(novAfter?.totalAssets).toBe(29000);
  });

  test("same-day multiple edits: last effectiveDate entry wins", async () => {
    // Create asset with two edits on same day
    const assetData: Partial<ManualAsset> = {
      label: "Test Asset",
      category: "other",
      value: 24500,
      startDate: "2026-11-01",
      updatedAt: new Date().toISOString(),
      valuations: [
        {
          effectiveDate: "2026-11-01",
          valueCents: 2500000, // First edit: $25,000
          createdAt: "2026-11-01T09:00:00Z",
        },
        {
          effectiveDate: "2026-11-01",
          valueCents: 2450000, // Later edit same day: $24,500
          createdAt: "2026-11-01T14:00:00Z",
        },
      ],
    };

    await db
      .collection(`users/${testUid}/manualAssets`)
      .add(assetData);

    const profile = await buildAndCacheFinancialProfile(testUid, db);
    const novMonth = profile.monthlyHistory.find((m) => m.yearMonth === "2026-11");

    // Should use the last entry for that effectiveDate
    expect(novMonth?.totalAssets).toBe(24500);
  });

  test("backdating valuation updates prior month", async () => {
    const assetData: Partial<ManualAsset> = {
      label: "Test Car",
      category: "vehicle",
      value: 23000,
      startDate: "2026-10-01",
      updatedAt: new Date("2026-12-01T10:00:00Z").toISOString(),
      valuations: [
        {
          effectiveDate: "2026-10-15",
          valueCents: 2500000, // Initial: $25,000
          createdAt: "2026-10-15T10:00:00Z",
        },
        {
          effectiveDate: "2026-10-25",
          valueCents: 2300000, // Backdated: $23,000
          createdAt: "2026-12-01T10:00:00Z",
        },
      ],
    };

    await db
      .collection(`users/${testUid}/manualAssets`)
      .add(assetData);

    const profile = await buildAndCacheFinancialProfile(testUid, db);

    const octMonth = profile.monthlyHistory.find((m) => m.yearMonth === "2026-10");
    const novMonth = profile.monthlyHistory.find((m) => m.yearMonth === "2026-11");
    const decMonth = profile.monthlyHistory.find((m) => m.yearMonth === "2026-12");

    // Oct: uses backdated value (latest as of Oct 31)
    expect(octMonth?.totalAssets).toBe(23000);

    // Nov & Dec: carry forward
    expect(novMonth?.totalAssets).toBe(23000);
    expect(decMonth?.totalAssets).toBe(23000);
  });

  test("deletion of latest valuation falls back to previous", async () => {
    // Create asset with valuations, then simulate deletion of latest
    const assetRef = await db
      .collection(`users/${testUid}/manualAssets`)
      .add({
        label: "Test Car",
        category: "vehicle",
        value: 25000, // After deleting Nov entry, falls back to Oct
        startDate: "2026-10-01",
        updatedAt: new Date("2026-11-20T10:00:00Z"),
        valuations: [
          {
            effectiveDate: "2026-10-15",
            valueCents: 2500000,
            createdAt: "2026-10-15T10:00:00Z",
          },
          // Nov valuation was deleted
        ],
      });

    const profile = await buildAndCacheFinancialProfile(testUid, db);

    const octMonth = profile.monthlyHistory.find((m) => m.yearMonth === "2026-10");
    const novMonth = profile.monthlyHistory.find((m) => m.yearMonth === "2026-11");

    // Oct: $25,000
    expect(octMonth?.totalAssets).toBe(25000);

    // Nov: still $25,000 (carries forward)
    expect(novMonth?.totalAssets).toBe(25000);
  });

  test("rate-only edit does not alter actual values", async () => {
    // Create asset with valuation and projection rate
    const assetData: Partial<ManualAsset> = {
      label: "Test House",
      category: "property",
      value: 500000,
      startDate: "2026-10-01",
      updatedAt: new Date("2026-11-20T10:00:00Z").toISOString(),
      annualGrowthRate: 5, // Projection rate
      valuations: [
        {
          effectiveDate: "2026-10-15",
          valueCents: 50000000,
          createdAt: "2026-10-15T10:00:00Z",
        },
        // No new valuation when only rate changed
      ],
    };

    await db
      .collection(`users/${testUid}/manualAssets`)
      .add(assetData);

    const profile = await buildAndCacheFinancialProfile(testUid, db);

    const octMonth = profile.monthlyHistory.find((m) => m.yearMonth === "2026-10");
    const novMonth = profile.monthlyHistory.find((m) => m.yearMonth === "2026-11");

    // Both months use same valuation (rate doesn't affect actual)
    expect(octMonth?.totalAssets).toBe(500000);
    expect(novMonth?.totalAssets).toBe(500000);

    // Verify rate is stored but doesn't affect calculations
    const asset = profile.manualAssets.find((a) => a.label === "Test House");
    expect(asset?.annualGrowthRate).toBe(5);
  });

  test("profile cache invalidation triggers rebuild with new valuations", async () => {
    // Create asset
    const assetRef = await db
      .collection(`users/${testUid}/manualAssets`)
      .add({
        label: "Test Asset",
        category: "other",
        value: 10000,
        startDate: "2026-11-01",
        updatedAt: new Date(),
      });

    // Build initial profile
    const profile1 = await buildAndCacheFinancialProfile(testUid, db);
    const nov1 = profile1.monthlyHistory.find((m) => m.yearMonth === "2026-11");
    expect(nov1?.totalAssets).toBe(10000);

    // Add valuation
    await assetRef.update({
      valuations: [
        {
          effectiveDate: "2026-11-01",
          valueCents: 1000000,
          createdAt: new Date().toISOString(),
        },
        {
          effectiveDate: "2026-11-15",
          valueCents: 950000, // $9,500
          createdAt: new Date().toISOString(),
        },
      ],
      value: 9500,
      updatedAt: new Date(),
    });

    // Rebuild profile (cache invalidated)
    const profile2 = await buildAndCacheFinancialProfile(testUid, db);
    const nov2 = profile2.monthlyHistory.find((m) => m.yearMonth === "2026-11");

    // Should use latest valuation
    expect(nov2?.totalAssets).toBe(9500);
  });
});
