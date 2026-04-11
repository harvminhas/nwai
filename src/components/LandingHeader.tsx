"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { onAuthStateChanged } from "firebase/auth";
import { getFirebaseClient } from "@/lib/firebase";

export default function LandingHeader() {
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null);

  useEffect(() => {
    const { auth } = getFirebaseClient();
    return onAuthStateChanged(auth, (user) => setLoggedIn(!!user));
  }, []);

  return (
    <header className="border-b border-gray-100 bg-white sticky top-0 z-30">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3.5 sm:px-6 lg:px-8">
        <Link href="/" className="font-bold text-purple-600 text-lg tracking-tight">
          networth<span className="text-gray-400">.online</span>
        </Link>

        <div className="flex items-center gap-4">
          {loggedIn === null ? (
            <div className="h-8 w-44 animate-pulse rounded-lg bg-gray-100" />
          ) : loggedIn ? (
            <Link
              href="/account/dashboard"
              className="rounded-lg bg-purple-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-purple-700"
            >
              Go to Dashboard
            </Link>
          ) : (
            <>
              <Link
                href="/login"
                className="text-sm font-medium text-gray-600 hover:text-gray-900 transition"
              >
                Log in
              </Link>
              <Link
                href="/upload"
                className="rounded-lg bg-purple-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-purple-700"
              >
                Upload a statement
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
