import { getApps, getApp, initializeApp, cert, type App } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";

export class FirebaseAdminCredentialsError extends Error {
  constructor() {
    super(
      "Firebase Admin credentials not set. Add FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY to .env.local. " +
        "Get them from Firebase Console > Project Settings > Service Accounts > Generate new private key."
    );
    this.name = "FirebaseAdminCredentialsError";
  }
}

function initAdminApp(): App {
  if (getApps().length === 0) {
    const projectId = process.env.FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");

    if (projectId && clientEmail && privateKey) {
      const storageBucket =
        process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ||
        `${projectId}.appspot.com`;
      return initializeApp({
        credential: cert({ projectId, clientEmail, privateKey }),
        storageBucket,
      });
    }
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      return initializeApp({ projectId: projectId || undefined });
    }
    throw new FirebaseAdminCredentialsError();
  }
  return getApp() as App;
}

let _app: App;

export function getFirebaseAdmin() {
  if (!_app) _app = initAdminApp();
  return {
    app: _app,
    auth: getAuth(_app),
    db: getFirestore(_app),
    storage: getStorage(_app),
  };
}

/** Resolve storage bucket: use env bucket, or default to projectId.appspot.com (Firebase default). */
export function getStorageBucketName(): string {
  const projectId =
    process.env.FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const envBucket = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;
  if (envBucket) return envBucket;
  if (projectId) return `${projectId}.appspot.com`;
  throw new Error("Missing Firebase project id or storage bucket in env");
}
