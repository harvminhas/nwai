#!/usr/bin/env tsx

/**
 * One-off script to purge stored statement files for successfully parsed statements.
 * 
 * Finds statements with:
 * - status = "completed"
 * - fileUrl is not empty
 * - Optionally: for a specific user
 * 
 * Deletes the files from Storage and sets fileUrl = "", fileDeletedAt.
 * 
 * Usage:
 *   tsx scripts/purge-stored-statement-files.ts <uid>             # Dry run for one user
 *   tsx scripts/purge-stored-statement-files.ts <uid> --apply     # Execute for one user
 *   tsx scripts/purge-stored-statement-files.ts --all-users       # Dry run for all users
 *   tsx scripts/purge-stored-statement-files.ts --all-users --apply  # Execute for all users
 */

import { getFirebaseAdmin, getStorageBucketName } from "../src/lib/firebase-admin";

const args = process.argv.slice(2);
const uid = args.find(arg => !arg.startsWith("--"));
const ALL_USERS = args.includes("--all-users");
const DRY_RUN = !args.includes("--apply");

if (!uid && !ALL_USERS) {
  console.error("Usage:");
  console.error("  tsx scripts/purge-stored-statement-files.ts <uid>              # Dry run for one user");
  console.error("  tsx scripts/purge-stored-statement-files.ts <uid> --apply      # Execute for one user");
  console.error("  tsx scripts/purge-stored-statement-files.ts --all-users        # Dry run for all users");
  console.error("  tsx scripts/purge-stored-statement-files.ts --all-users --apply # Execute for all users");
  process.exit(1);
}

async function main() {
  const targetUser = ALL_USERS ? "all users" : uid;
  console.log(`Purging stored statement files for ${targetUser}`);
  console.log(DRY_RUN ? "DRY RUN - no changes will be made" : "APPLY MODE - files will be deleted");
  console.log("=".repeat(80));

  const { db, storage } = getFirebaseAdmin();

  // Find completed statements with non-empty fileUrl
  let query = db.collection("statements").where("status", "==", "completed");
  
  if (!ALL_USERS && uid) {
    query = query.where("userId", "==", uid);
  }
  
  const completedSnap = await query.get();

  const toDelete: Array<{
    id: string;
    fileUrl: string;
    bucketName: string;
    yearMonth: string | null;
    userId: string;
  }> = [];

  for (const doc of completedSnap.docs) {
    const data = doc.data();
    const fileUrl = data.fileUrl as string | undefined;

    if (fileUrl && fileUrl.trim() !== "") {
      const bucketName = (data.storageBucket as string) || getStorageBucketName();
      toDelete.push({
        id: doc.id,
        fileUrl,
        bucketName,
        yearMonth: data.yearMonth as string | null,
        userId: data.userId as string,
      });
    }
  }

  console.log(`\nFound ${toDelete.length} completed statements with stored files\n`);

  if (toDelete.length === 0) {
    console.log("No files to purge");
    return;
  }

  // Group by user for reporting
  const byUser = new Map<string, number>();
  for (const item of toDelete) {
    byUser.set(item.userId, (byUser.get(item.userId) || 0) + 1);
  }

  console.log("Files by user:");
  for (const [userId, count] of byUser) {
    console.log(`  ${userId}: ${count} files`);
  }
  console.log();

  if (DRY_RUN) {
    console.log("DRY RUN - would delete the following files:");
    for (const item of toDelete.slice(0, 10)) {
      console.log(`  ${item.id} (${item.yearMonth || "no month"}): ${item.fileUrl}`);
    }
    if (toDelete.length > 10) {
      console.log(`  ... and ${toDelete.length - 10} more`);
    }
    console.log("\nRun with --apply to actually delete these files");
    return;
  }

  // APPLY mode - actually delete
  console.log("Deleting files...");
  let deleted = 0;
  let errors = 0;
  const now = new Date().toISOString();

  for (const item of toDelete) {
    try {
      const bucket = storage.bucket(item.bucketName);
      await bucket.file(item.fileUrl).delete();

      await db.collection("statements").doc(item.id).update({
        fileUrl: "",
        fileDeletedAt: now,
      });

      deleted++;
      if (deleted % 10 === 0) {
        console.log(`  Deleted ${deleted}/${toDelete.length}...`);
      }
    } catch (err) {
      console.error(`  Error deleting ${item.id}:`, err);
      errors++;
    }
  }

  console.log(`\nDone: ${deleted} deleted, ${errors} errors`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
