import { NextRequest, NextResponse } from "next/server";
import { getFirebaseAdmin, getStorageBucketName } from "@/lib/firebase-admin";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // 5 minutes

/**
 * Cron job to purge expired statement files from Storage.
 * 
 * Deletes files for statements where:
 * - fileExpiresAt is set and in the past (failed parses after 24h)
 * 
 * Protected by CRON_SECRET header.
 */
export async function GET(req: NextRequest) {
  // Verify cron secret
  const authHeader = req.headers.get("authorization");
  const secret = process.env.CRON_SECRET;
  
  if (!secret) {
    console.error("[purge-statement-files] CRON_SECRET not configured");
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }
  
  if (authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { db, storage } = getFirebaseAdmin();
    const now = new Date().toISOString();
    
    // Find statements with expired files
    const expiredSnap = await db.collection("statements")
      .where("fileExpiresAt", "<=", now)
      .limit(100) // Process in batches
      .get();
    
    let deleted = 0;
    let errors = 0;
    
    for (const doc of expiredSnap.docs) {
      const data = doc.data();
      const fileUrl = data.fileUrl as string | undefined;
      
      if (!fileUrl) {
        // Already deleted or no file, just clear the expiry flag
        await doc.ref.update({
          fileExpiresAt: null,
        });
        continue;
      }
      
      try {
        const bucketName = (data.storageBucket as string) || getStorageBucketName();
        const bucket = storage.bucket(bucketName);
        await bucket.file(fileUrl).delete();
        
        await doc.ref.update({
          fileUrl: "",
          fileDeletedAt: new Date().toISOString(),
          fileExpiresAt: null,
        });
        
        deleted++;
        console.log(`[purge-statement-files] Deleted expired file: ${fileUrl}`);
      } catch (err) {
        console.error(`[purge-statement-files] Error deleting ${fileUrl}:`, err);
        errors++;
      }
    }
    
    console.log(`[purge-statement-files] Processed ${expiredSnap.size} expired files: ${deleted} deleted, ${errors} errors`);
    
    return NextResponse.json({
      ok: true,
      processed: expiredSnap.size,
      deleted,
      errors,
    });
  } catch (error) {
    console.error("[purge-statement-files] Error:", error);
    return NextResponse.json(
      { error: "Failed to purge files" },
      { status: 500 }
    );
  }
}
