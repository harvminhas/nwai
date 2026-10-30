"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { getFirebaseClient } from "@/lib/firebase";

/**
 * Invisible component — if the user is already signed in, redirect them
 * straight to the dashboard. Runs client-side so the landing page itself
 * stays server-rendered and fully indexable by search engines.
 * 
 * Exception: if ?v=2 is in the URL, don't redirect (allow preview of new landing).
 */
export default function AuthRedirect() {
  const router = useRouter();
  const searchParams = useSearchParams();
  
  useEffect(() => {
    // Don't redirect if viewing v=2 preview
    const isPreview = searchParams.get("v") === "2";
    if (isPreview) return;
    
    const { auth } = getFirebaseClient();
    return onAuthStateChanged(auth, (user) => {
      if (user) router.replace("/account/dashboard");
    });
  }, [router, searchParams]);
  
  return null;
}
