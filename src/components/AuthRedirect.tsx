"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { getFirebaseClient } from "@/lib/firebase";

/**
 * Invisible component — if the user is already signed in, redirect them
 * straight to the dashboard. Runs client-side so the landing page itself
 * stays server-rendered and fully indexable by search engines.
 */
export default function AuthRedirect() {
  const router = useRouter();
  useEffect(() => {
    const { auth } = getFirebaseClient();
    return onAuthStateChanged(auth, (user) => {
      if (user) router.replace("/account/dashboard");
    });
  }, [router]);
  return null;
}
