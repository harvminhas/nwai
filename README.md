# networth.online MVP

Financial intelligence web app: upload a bank statement (PDF/image), get instant net worth, income/expenses, subscriptions, savings rate, and AI-generated insights.

## Tech stack

- **Frontend:** Next.js 14+ (App Router), TypeScript, Tailwind CSS
- **Database:** Firebase Firestore
- **Auth:** Firebase Auth (email/password + Google)
- **Storage:** Firebase Storage
- **AI:** Anthropic Claude (statement parsing)
- **Hosting:** Vercel

## Setup

1. Clone and install:
   ```bash
   npm install
   ```

2. Copy env and configure:
   ```bash
   cp .env.example .env.local
   ```
   Fill in:
   - All `NEXT_PUBLIC_FIREBASE_*` from Firebase Console > Project Settings
   - Firebase Admin: `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` (from Service account)
   - `ANTHROPIC_API_KEY` from Anthropic

3. Firebase Console (required or uploads will fail):
   - **Firestore:** Build → Firestore Database → **Create database** (pick region; test mode is fine for dev). If you skip this, you get `NOT_FOUND` on upload.
   - **Storage:** Build → Storage → Get started (creates the default bucket).
   - **Auth:** Enable Email/Password and Google sign-in.
   - Deploy Firestore indexes: `npx firebase deploy --only firestore:indexes` (if using Firebase CLI and `firestore.indexes.json`)

4. Run:
   ```bash
   npm run dev
   ```

5. Optional: add `public/dashboard-preview.png` for the landing hero image.

**Upload formats:** PDF (Claude reads the document), CSV (bank transaction export), or PNG/JPG screenshots.

## Routes

- `/` – Landing
- `/upload` – Upload statement
- `/dashboard/[id]` – View parsed statement
- `/account/login`, `/account/signup` – Auth
- `/account/dashboard` – User’s statement list (protected)

## API

- `POST /api/upload` – Upload file (multipart); optional `Authorization: Bearer <idToken>`
- `POST /api/parse` – Internal; triggered by upload
- `GET /api/statement/[id]` – Get statement status/data
- `GET /api/user/statements` – List current user’s statements (requires auth)
