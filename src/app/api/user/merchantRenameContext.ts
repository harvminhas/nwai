/**
 * Load the shared merchant rename context (sourceMappings + merchantDisplayNames).
 * Firestore reads stay in the API layer; resolution is the pure helper in merchantAliases.
 */

import type { Firestore } from "firebase-admin/firestore";
import {
  merchantRenameContextFromRecords,
  type MerchantRenameContext,
} from "@/lib/merchantAliases";

export async function loadMerchantRenameContext(
  uid: string,
  db: Firestore,
): Promise<MerchantRenameContext> {
  const [mappingsSnap, displayNamesSnap] = await Promise.all([
    db.collection(`users/${uid}/sourceMappings`).get(),
    db.collection(`users/${uid}/merchantDisplayNames`).get(),
  ]);
  return merchantRenameContextFromRecords(
    mappingsSnap.docs.map(
      (doc) =>
        doc.data() as { canonical: string; alias: string; status?: string; type?: string },
    ),
    displayNamesSnap.docs.map((doc) => ({
      id: doc.id,
      displayName: (doc.data() as { displayName?: string }).displayName,
    })),
  );
}
