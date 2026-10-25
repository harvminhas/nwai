"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { getFirebaseClient } from "@/lib/firebase";
import { useActiveProfile } from "@/contexts/ActiveProfileContext";
import { MvpTopNav } from "@/components/MvpTopNav";

export default function AccountLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { buildHeaders } = useActiveProfile();
  const [token, setToken] = useState<string | null>(null);
  const [netWorthData, setNetWorthData] = useState<{
    netWorth: number;
    monthlyChange: number;
    currency: string;
  } | undefined>(undefined);

  useEffect(() => {
    const { auth } = getFirebaseClient();
    return onAuthStateChanged(auth, async (user) => {
      if (!user) {
        router.push("/login");
        return;
      }
      const tok = await user.getIdToken();
      setToken(tok);
    });
  }, [router]);

  const loadNetWorth = useCallback(async (tok: string) => {
    try {
      const res = await fetch("/api/user/net-worth-summary", {
        headers: buildHeaders(tok),
      });
      if (res.ok) {
        const data = await res.json();
        setNetWorthData({
          netWorth: data.netWorth ?? 0,
          monthlyChange: data.monthlyChange ?? 0,
          currency: data.currency ?? "CAD",
        });
      }
    } catch (error) {
      console.error("Failed to load net worth:", error);
      // Set empty data on error so the pill shows something
      setNetWorthData({
        netWorth: 0,
        monthlyChange: 0,
        currency: "CAD",
      });
    }
  }, [buildHeaders]);

  useEffect(() => {
    if (token) {
      loadNetWorth(token);
    }
  }, [token, loadNetWorth]);

  if (!token) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-purple-600 border-t-transparent" />
      </div>
    );
  }

  return (
    <>
      <MvpTopNav netWorthData={netWorthData} />
      <main>{children}</main>
    </>
  );
}
