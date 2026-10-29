#!/usr/bin/env tsx

/**
 * Migration script to mask account numbers in existing data.
 * 
 * Masks account numbers (parsedData.accountId) to last 4 digits only.
 * Preserves existing slugs and doc IDs - does NOT rename/change them.
 * 
 * If a slug itself contains a full account number (>4 digits), reports it
 * rather than attempting to rename (which would break links).
 * 
 * Updates:
 * - statements parsedData.accountId
 * - Does NOT touch slugs or doc IDs
 * 
 * Usage:
 *   tsx scripts/mask-account-numbers.ts <uid>              # Dry run for one user
 *   tsx scripts/mask-account-numbers.ts <uid> --apply      # Execute for one user
 *   tsx scripts/mask-account-numbers.ts --all-users        # Dry run for all users
 *   tsx scripts/mask-account-numbers.ts --all-users --apply # Execute for all users
 */

import { getFirebaseAdmin } from "../src/lib/firebase-admin";
import { maskAccountNumber } from "../src/lib/accountMasking";
import { buildAccountSlug } from "../src/lib/accountSlug";

const args = process.argv.slice(2);
const uid = args.find(arg => !arg.startsWith("--"));
const ALL_USERS = args.includes("--all-users");
const DRY_RUN = !args.includes("--apply");

if (!uid && !ALL_USERS) {
  console.error("Usage:");
  console.error("  tsx scripts/mask-account-numbers.ts <uid>              # Dry run for one user");
  console.error("  tsx scripts/mask-account-numbers.ts <uid> --apply      # Execute for one user");
  console.error("  tsx scripts/mask-account-numbers.ts --all-users        # Dry run for all users");
  console.error("  tsx scripts/mask-account-numbers.ts --all-users --apply # Execute for all users");
  process.exit(1);
}

async function main() {
  const targetUser = ALL_USERS ? "all users" : uid;
  console.log(`Masking account numbers in existing data for ${targetUser}`);
  console.log(DRY_RUN ? "DRY RUN - no changes will be made" : "APPLY MODE - data will be updated");
  console.log("=".repeat(80));

  const { db } = getFirebaseAdmin();

  // Find all statements with parsedData.accountId
  let query = db.collection("statements");
  
  if (!ALL_USERS && uid) {
    query = query.where("userId", "==", uid) as any;
  }
  
  const statementsSnap = await query.get();

  const toMask: Array<{
    id: string;
    originalAccountId: string;
    maskedAccountId: string;
    slug: string;
    userId: string;
  }> = [];

  const slugsWithFullNumbers: string[] = [];

  for (const doc of statementsSnap.docs) {
    const data = doc.data();
    
    // Filter by user if not scanning all users
    if (!ALL_USERS && uid && data.userId !== uid) {
      continue;
    }
    
    const parsedData = data.parsedData as Record<string, any> | undefined;
    const accountId = parsedData?.accountId as string | undefined;
    const slug = data.accountSlug as string | undefined;

    if (accountId && accountId.length > 4) {
      const masked = maskAccountNumber(accountId);
      if (masked && masked !== accountId) {
        // Compute slug from ORIGINAL unmasked accountId
        const computedSlug = buildAccountSlug(
          parsedData?.bankName as string | undefined,
          accountId,
          parsedData?.accountName as string | undefined,
          parsedData?.accountType as string | undefined
        );
        
        toMask.push({
          id: doc.id,
          originalAccountId: accountId,
          maskedAccountId: masked,
          computedSlug,
          slug: slug || "no-slug",
          userId: data.userId as string,
        });
      }
    }

    // Check if slug itself contains a full account number
    if (slug && /\d{5,}/.test(slug)) {
      slugsWithFullNumbers.push(slug);
    }
  }

  console.log(`\nFound ${toMask.length} statements with account numbers longer than 4 digits\n`);

  if (slugsWithFullNumbers.length > 0) {
    console.log(`⚠️  WARNING: ${slugsWithFullNumbers.length} slugs contain full account numbers (>4 digits):`);
    const unique = [...new Set(slugsWithFullNumbers)];
    for (const slug of unique.slice(0, 10)) {
      console.log(`  ${slug}`);
    }
    if (unique.length > 10) {
      console.log(`  ... and ${unique.length - 10} more`);
    }
    console.log("These slugs will NOT be renamed (would break existing links)");
    console.log("Only the parsedData.accountId field will be masked\n");
  }

  if (toMask.length === 0) {
    console.log("No account numbers to mask");
    return;
  }

  // Group by user for reporting
  const byUser = new Map<string, number>();
  for (const item of toMask) {
    byUser.set(item.userId, (byUser.get(item.userId) || 0) + 1);
  }

  console.log("Statements by user:");
  for (const [userId, count] of byUser) {
    console.log(`  ${userId}: ${count} statements`);
  }
  console.log();

  if (DRY_RUN) {
    console.log("DRY RUN - would mask the following account numbers:");
    for (const item of toMask.slice(0, 10)) {
      console.log(`  ${item.id}: ${item.originalAccountId} → ${item.maskedAccountId} (slug: ${item.computedSlug || item.slug})`);
    }
    if (toMask.length > 10) {
      console.log(`  ... and ${toMask.length - 10} more`);
    }
    console.log("\nRun with --apply to actually mask these account numbers");
    return;
  }

  // APPLY mode - actually update
  console.log("Masking account numbers...");
  let updated = 0;
  let errors = 0;

  // Process in batches of 500 (Firestore batch limit)
  const batchSize = 500;
  for (let i = 0; i < toMask.length; i += batchSize) {
    const batch = db.batch();
    const chunk = toMask.slice(i, i + batchSize);

    for (const item of chunk) {
      try {
        const docRef = db.collection("statements").doc(item.id);
        const doc = await docRef.get();
        if (!doc.exists) continue;

        const data = doc.data()!;
        const parsedData = data.parsedData as Record<string, any>;

        // CRITICAL: Store computed slug BEFORE masking changes accountId
        // so all consumers can read it instead of recomputing from masked ID
        const updatePayload: Record<string, any> = {
          "parsedData.accountId": item.maskedAccountId,
        };
        
        if (item.computedSlug) {
          updatePayload["parsedData.accountSlug"] = item.computedSlug;
        }
        
        batch.update(docRef, updatePayload);

        updated++;
      } catch (err) {
        console.error(`  Error updating ${item.id}:`, err);
        errors++;
      }
    }

    await batch.commit();
    console.log(`  Updated ${Math.min(i + batchSize, toMask.length)}/${toMask.length}...`);
  }

  console.log(`\nDone: ${updated} updated, ${errors} errors`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
