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
    <header className="border-b border-gray-100 bg-white">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
        <span className="font-bold text-purple-600 text-lg tracking-tight">
          networth<span className="text-gray-400">.online</span>
        </span>
        <div className="flex items-center gap-3">
          {loggedIn === null ? (
            <div className="h-9 w-48 animate-pulse rounded-lg bg-gray-100" />
          ) : loggedIn ? (
            <Link
              href="/account/dashboard"
              className="rounded-lg bg-gradient-to-r from-purple-600 to-purple-700 px-4 py-2 font-semibold text-white transition hover:from-purple-700 hover:to-purple-800"
            >
              Go to Dashboard
            </Link>
          ) : (
            <>
              <Link
                href="/login"
                className="rounded-lg border-2 border-purple-600 px-4 py-2 font-semibold text-purple-600 transition hover:bg-purple-50"
              >
                Log in
              </Link>
              <Link
                href="/signup"
                className="rounded-lg bg-gradient-to-r from-purple-600 to-purple-700 px-4 py-2 font-semibold text-white transition hover:from-purple-700 hover:to-purple-800"
              >
                Sign up
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
