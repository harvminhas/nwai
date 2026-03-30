/**
 * External Data Store.
 *
 * Reads and writes the global externalData/{dataType} collection in Firestore.
 * These documents are shared across all users — one document per data type.
 */

import type * as Firestore from "firebase-admin/firestore";
import type { ExternalDataPoint, ExternalDataType } from "./types";

const COLLECTION = "externalData";

/** Read a single external data point. Returns null if not yet fetched. */
export async function getExternalData(
  dataType: ExternalDataType,
  db: Firestore.Firestore,
): Promise<ExternalDataPoint | null> {
  const snap = await db.collection(COLLECTION).doc(dataType).get();
  if (!snap.exists) return null;
  return snap.data() as ExternalDataPoint;
}

/** Read all external data points. */
export async function getAllExternalData(
  db: Firestore.Firestore,
): Promise<ExternalDataPoint[]> {
  const snap = await db.collection(COLLECTION).get();
  return snap.docs.map((d) => d.data() as ExternalDataPoint);
}

/** Write (upsert) an external data point. */
export async function setExternalData(
  point: ExternalDataPoint,
  db: Firestore.Firestore,
): Promise<void> {
  await db.collection(COLLECTION).doc(point.dataType).set(point);
}

/**
 * Returns true if this data type is due for a refresh.
 * Compares nextRefreshAt against the current time.
 */
export function isDueForRefresh(point: ExternalDataPoint): boolean {
  return new Date(point.nextRefreshAt) <= new Date();
}
