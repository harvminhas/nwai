import Link from "next/link";
import { notFound } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import NetWorthCard from "@/components/NetWorthCard";
import IncomeCard from "@/components/IncomeCard";
import StatementExpenses from "./StatementExpenses";
import SavingsRateCard from "@/components/SavingsRateCard";
import SubscriptionsCard from "@/components/SubscriptionsCard";
import InsightsSection from "@/components/InsightsSection";
import DashboardCtas from "@/components/DashboardCtas";
import { getFirebaseAdmin } from "@/lib/firebase-admin";
import type { StatementApiResponse, ParsedStatementData } from "@/lib/types";

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
          <p className="mt-1 text-sm text-gray-500">
            This may take up to 30 seconds.
          </p>
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
          <p className="text-red-800">
            {statement.errorMessage || "Something went wrong."}
          </p>
          <Link
            href="/upload"
            className="mt-6 inline-block rounded-lg bg-purple-600 px-6 py-2 font-medium text-white hover:bg-purple-700"
          >
            Try again
          </Link>
        </div>
      </div>
    );
  }

  const data = statement.parsedData;
  if (!data) notFound();

  const SPENDING_TYPES = ["checking", "savings", "credit"];
  const hasSpending = SPENDING_TYPES.includes(data.accountType ?? "") ||
    (data.income?.total ?? 0) > 0 ||
    (data.expenses?.total ?? 0) > 0 ||
    (data.subscriptions?.length ?? 0) > 0;
  const hasIncome = (data.accountType === "checking" || data.accountType === "savings") ||
    (data.income?.total ?? 0) > 0;

  return (
    <div className="min-h-screen bg-gray-50">
      <Sidebar />
      <div className="lg:pl-56">
        <div className="lg:hidden h-14" />
        <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
        <div className="mb-6 flex items-center gap-2 text-sm text-gray-500">
          <Link href="/account/dashboard" className="hover:text-purple-600">
            Dashboard
          </Link>
          <span>/</span>
          <span className="font-medium text-gray-700">
            {data.bankName ?? "Statement"}
            {data.accountId && data.accountId !== "unknown" && (
              <span className="ml-1 text-gray-400">{data.accountId}</span>
            )}
          </span>
        </div>

        <div className="mb-8">
          <NetWorthCard data={data} />
        </div>

        {hasSpending && (
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="space-y-6">
              {hasIncome && <IncomeCard income={data.income} />}
              <StatementExpenses expenses={data.expenses} statementId={id} />
            </div>
            <div className="space-y-6">
              {hasIncome && <SavingsRateCard data={data} />}
              <SubscriptionsCard subscriptions={data.subscriptions ?? []} />
            </div>
          </div>
        )}

        <InsightsSection insights={data.insights ?? []} />

        <DashboardCtas />
        </div>
      </div>
    </div>
  );
}
