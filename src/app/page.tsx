"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { getFirebaseClient } from "@/lib/firebase";
import Link from "next/link";
import Hero from "@/components/Hero";
import ValueProps from "@/components/ValueProps";
import ComparisonTable from "@/components/ComparisonTable";
import LandingHeader from "@/components/LandingHeader";

export default function Home() {
  const router = useRouter();

  useEffect(() => {
    const { auth } = getFirebaseClient();
    return onAuthStateChanged(auth, (user) => {
      if (user) router.replace("/account/dashboard");
    });
  }, [router]);

  return (
    <div className="min-h-screen bg-white">
      <LandingHeader />
      <Hero />
      <ValueProps />

      {/* How it works */}
      <section className="bg-white py-16 md:py-24">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <h2 className="text-center font-semibold text-xl text-gray-900 md:text-2xl">
            How it works
          </h2>
          <div className="mt-12 grid gap-8 md:grid-cols-3">
            <div className="text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-purple-100 font-bold text-purple-600">
                1
              </div>
              <h3 className="mt-4 font-semibold text-gray-900">Upload your bank statement</h3>
              <p className="mt-2 text-base text-gray-600">PDF or image</p>
            </div>
            <div className="text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-purple-100 font-bold text-purple-600">
                2
              </div>
              <h3 className="mt-4 font-semibold text-gray-900">AI analyzes your transactions</h3>
              <p className="mt-2 text-base text-gray-600">In seconds</p>
            </div>
            <div className="text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-purple-100 font-bold text-purple-600">
                3
              </div>
              <h3 className="mt-4 font-semibold text-gray-900">Get your complete financial snapshot</h3>
              <p className="mt-2 text-base text-gray-600">Plus insights</p>
            </div>
          </div>
        </div>
      </section>

      <ComparisonTable />

      {/* Bottom CTA */}
      <section className="bg-white py-16 md:py-24">
        <div className="mx-auto max-w-7xl px-4 text-center sm:px-6 lg:px-8">
          <Link
            href="/upload"
            className="inline-block rounded-lg bg-gradient-to-r from-purple-600 to-purple-700 px-8 py-4 font-semibold text-white shadow-md transition hover:from-purple-700 hover:to-purple-800 hover:shadow-lg"
          >
            Try It Free – Upload Your Statement
          </Link>
        </div>
      </section>
    </div>
  );
}
