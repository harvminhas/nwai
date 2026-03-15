"use client";

import { useEffect, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { getFirebaseClient } from "@/lib/firebase";
import ExpensesCard from "@/components/ExpensesCard";
import type { Expenses } from "@/lib/types";

export default function StatementExpenses({
  expenses,
  statementId,
}: {
  expenses: Expenses;
  statementId: string;
}) {
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    const { auth } = getFirebaseClient();
    return onAuthStateChanged(auth, async (user) => {
      if (user) setToken(await user.getIdToken());
      else setToken(null);
    });
  }, []);

  return (
    <ExpensesCard
      expenses={expenses}
      statementId={token ? statementId : undefined}
      authToken={token ?? undefined}
    />
  );
}
