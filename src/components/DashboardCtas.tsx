"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { onAuthStateChanged } from "firebase/auth";
import { getFirebaseClient } from "@/lib/firebase";

export default function DashboardCtas() {
  const [isLoggedIn, setIsLoggedIn] = useState<boolean | null>(null);

  useEffect(() => {
    const { auth } = getFirebaseClient();
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setIsLoggedIn(!!user);
    });
    return () => unsubscribe();
  }, []);

  if (isLoggedIn === null) {
    return (
      <div className="mt-10 flex flex-wrap gap-4">
        <div className="h-12 w-24 animate-pulse rounded-lg bg-gray-200" />
        <div className="h-12 w-40 animate-pulse rounded-lg bg-gray-200" />
      </div>
    );
  }

  if (isLoggedIn) {
    return (
      <div className="mt-10 flex flex-wrap gap-4">
        <Link
          href="/upload"
          className="rounded-lg border-2 border-purple-600 px-6 py-3 font-semibold text-purple-600 transition hover:bg-purple-50"
        >
          Upload Another Month
        </Link>
        <Link
          href="/account/dashboard"
          className="rounded-lg bg-gradient-to-r from-purple-600 to-purple-700 px-6 py-3 font-semibold text-white transition hover:from-purple-700 hover:to-purple-800"
        >
          View my statements
        </Link>
      </div>
    );
  }

  return (
    <div className="mt-10 rounded-lg border-2 border-purple-200 bg-purple-50/50 p-6">
      <p className="font-semibold text-gray-900">
        Want to upload another statement or save your financial profile?
      </p>
      <p className="mt-1 text-sm text-gray-600">
        Create a free account to upload more statements and keep your data in one place.
      </p>
      <div className="mt-4 flex flex-wrap gap-3">
        <Link
          href="/signup"
          className="rounded-lg bg-gradient-to-r from-purple-600 to-purple-700 px-6 py-3 font-semibold text-white transition hover:from-purple-700 hover:to-purple-800"
        >
          Create free account
        </Link>
        <Link
          href="/login"
          className="rounded-lg border-2 border-purple-600 px-6 py-3 font-semibold text-purple-600 transition hover:bg-purple-50"
        >
          Log in
        </Link>
      </div>
    </div>
  );
}
