import Link from "next/link";
import { notFound } from "next/navigation";
import DashboardCtas from "@/components/DashboardCtas";
import { getFirebaseAdmin } from "@/lib/firebase-admin";
import type { StatementApiResponse, ParsedStatementData } from "@/lib/types";
import { computeStatementSnapshot } from "@/lib/statementSnapshot";
import SnapshotView from "./SnapshotView";

async function getStatement(id: string): Promise<StatementApiResponse | null> {
  try {
    const { db } = getFirebaseAdmin();
    const doc = await db.collection("statements").doc(id).get();
    if (!doc.exists) return null;
    const data = doc.data();
    return {
      status: (data?.status as StatementApiResponse["status"]) ?? "processing",
      parsedData: data?.parsedData as ParsedStatementData | undefined,
      errorMessage: data?.errorMessage as string | undefined,
      statementId: id,
    };
  } catch {
    return null;
  }
}

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const statement = await getStatement(id);

  if (!statement) notFound();

  if (statement.status === "processing") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="mx-auto h-12 w-12 animate-spin rounded-full border-4 border-purple-600 border-t-transparent" />
          <p className="mt-4 font-medium text-gray-900">Processing your statement…</p>
          <p className="mt-1 text-sm text-gray-500">This may take up to 30 seconds.</p>
          <Link href="/upload" className="mt-6 inline-block text-purple-600 hover:underline">
            Back to upload
          </Link>
        </div>
      </div>
    );
  }

  if (statement.status === "error") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
        <div className="max-w-md rounded-lg border border-red-200 bg-white p-8 text-center">
          <p className="text-red-800">{statement.errorMessage || "Something went wrong."}</p>
          <Link href="/upload"
            className="mt-6 inline-block rounded-lg bg-purple-600 px-6 py-2 font-medium text-white hover:bg-purple-700">
            Try again
          </Link>
        </div>
      </div>
    );
  }

  const data = statement.parsedData;
  if (!data) notFound();

  const snap = computeStatementSnapshot(data);

  return (
    <div className="min-h-screen bg-gray-50">

      {/* ── Top bar ────────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-40 border-b border-gray-100 bg-white/90 backdrop-blur-sm">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-4 py-3 sm:px-6">
          <Link href="/" className="font-bold text-purple-600 text-lg tracking-tight">
            networth<span className="text-gray-400">.online</span>
          </Link>
          <div className="flex items-center gap-3">
            <Link href="/login"
              className="text-sm font-medium text-gray-600 hover:text-gray-900 transition">
              Log in
            </Link>
            <Link href="/signup"
              className="rounded-lg bg-purple-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-purple-700 transition">
              Create free account
            </Link>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6 space-y-2">

        {/* ── Breadcrumb ───────────────────────────────────────────────────── */}
        <div className="flex items-center gap-2 text-sm text-gray-500 mb-4">
          <Link href="/upload" className="hover:text-purple-600">Upload another</Link>
          <span>/</span>
          <span className="font-medium text-gray-700">
            {data.bankName ?? "Statement"}
            {data.accountId && data.accountId !== "unknown" && (
              <span className="ml-1 text-gray-400">{data.accountId}</span>
            )}
          </span>
        </div>

        {/* ── Interactive snapshot (client component) ──────────────────────── */}
        <SnapshotView
          snap={snap}
          statementDate={data.statementDate}
          bankName={data.bankName}
          accountId={data.accountId}
          accountType={data.accountType}
          statementId={id}
        />

        {/* ── Upload more CTA ──────────────────────────────────────────────── */}
        <div className="pt-4">
          <DashboardCtas />
        </div>
      </div>
    </div>
  );
}
