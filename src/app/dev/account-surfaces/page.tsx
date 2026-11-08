import { Suspense } from "react";
import { AccountSurfacesPreview } from "./PreviewClient";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Account surfaces preview",
  robots: { index: false, follow: false },
};

/**
 * Unauthenticated harness that mounts production Assets/Debts tabs with synthetic
 * summaries. Lives outside /account so the Firebase account layout does not block it.
 */
export default function AccountSurfacesPreviewPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[50vh] items-center justify-center text-sm text-gray-500">
          Loading preview…
        </div>
      }
    >
      <AccountSurfacesPreview />
    </Suspense>
  );
}
