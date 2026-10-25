"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { getFirebaseClient } from "@/lib/firebase";
import { fmt } from "@/lib/currencyUtils";
import { getFeatureFlags } from "@/lib/features";

interface NetWorthData {
  netWorth: number;
  monthlyChange: number;
  currency: string;
}

export function MvpTopNav({ netWorthData }: { netWorthData?: NetWorthData }) {
  const pathname = usePathname();
  const router = useRouter();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [user, setUser] = useState<any>(null);
  const features = getFeatureFlags();

  useEffect(() => {
    const { auth } = getFirebaseClient();
    return onAuthStateChanged(auth, setUser);
  }, []);

  const handleSignOut = async () => {
    const { auth } = getFirebaseClient();
    await signOut(auth);
    router.push("/login");
  };

  const isActive = (path: string) => pathname === path || pathname?.startsWith(path + "/");

  const { netWorth = 0, monthlyChange = 0, currency = "USD" } = netWorthData || {};

  return (
    <>
      {/* Top Navigation */}
      <nav className="sticky top-0 z-20 border-b border-gray-200/60 bg-white/72 backdrop-blur-xl backdrop-saturate-180">
        <div className="mx-auto max-w-7xl px-5">
          <div className="flex h-16 items-center justify-between gap-6">
            {/* Logo */}
            <Link href="/account/dashboard" className="flex items-center gap-2 font-bold">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-violet-600 to-violet-700 text-xs font-bold text-white">
                N
              </div>
              <span className="hidden text-base sm:inline">
                networth<span className="text-violet-600">.online</span>
              </span>
              <span className="ml-1 rounded border border-violet-200 bg-violet-50 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-violet-700">
                NWAI
              </span>
            </Link>

            {/* Desktop Navigation */}
            <div className="hidden items-center gap-2 lg:flex">
              <Link
                href="/account/dashboard"
                className={`rounded-full px-3.5 py-2 text-sm font-medium transition-colors ${
                  isActive("/account/dashboard")
                    ? "bg-violet-50 text-violet-700"
                    : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                }`}
              >
                Dashboard
              </Link>

              {/* Cash flow Dropdown */}
              <div className="group relative">
                <button
                  className={`flex items-center gap-1 rounded-full px-3.5 py-2 text-sm font-medium transition-colors ${
                    isActive("/account/income") || isActive("/account/spending")
                      ? "bg-violet-50 text-violet-700"
                      : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                  }`}
                >
                  Cash flow
                  <svg className="h-3 w-3 transition-transform group-hover:rotate-180" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                  </svg>
                </button>
                <div className="invisible absolute left-0 top-full mt-1.5 w-40 rounded-2xl border border-gray-200 bg-white p-2 opacity-0 shadow-xl shadow-gray-900/10 transition-all group-hover:visible group-hover:opacity-100">
                  <Link
                    href="/account/income"
                    className="block rounded-xl px-3 py-2 text-sm text-gray-700 hover:bg-violet-50 hover:text-violet-700"
                  >
                    Income
                  </Link>
                  <Link
                    href="/account/spending"
                    className="block rounded-xl px-3 py-2 text-sm text-gray-700 hover:bg-violet-50 hover:text-violet-700"
                  >
                    Spending
                  </Link>
                </div>
              </div>

              {/* Net worth Dropdown */}
              <div className="group relative">
                <button
                  className={`flex items-center gap-1 rounded-full px-3.5 py-2 text-sm font-medium transition-colors ${
                    isActive("/account/assets") || isActive("/account/liabilities")
                      ? "bg-violet-50 text-violet-700"
                      : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                  }`}
                >
                  Net worth
                  <svg className="h-3 w-3 transition-transform group-hover:rotate-180" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                  </svg>
                </button>
                <div className="invisible absolute left-0 top-full mt-1.5 w-40 rounded-2xl border border-gray-200 bg-white p-2 opacity-0 shadow-xl shadow-gray-900/10 transition-all group-hover:visible group-hover:opacity-100">
                  <Link
                    href="/account/assets"
                    className="block rounded-xl px-3 py-2 text-sm text-gray-700 hover:bg-violet-50 hover:text-violet-700"
                  >
                    Assets
                  </Link>
                  <Link
                    href="/account/liabilities"
                    className="block rounded-xl px-3 py-2 text-sm text-gray-700 hover:bg-violet-50 hover:text-violet-700"
                  >
                    Debts
                  </Link>
                </div>
              </div>

              <Link
                href="/account/statements"
                className={`rounded-full px-3.5 py-2 text-sm font-medium transition-colors ${
                  isActive("/account/statements")
                    ? "bg-violet-50 text-violet-700"
                    : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                }`}
              >
                Statements
              </Link>
            </div>

            {/* Right Side */}
            <div className="flex items-center gap-3">
              {/* Net Worth Pill */}
              {netWorth !== 0 && (
                <Link
                  href="/account/assets"
                  className="hidden items-center gap-2.5 whitespace-nowrap rounded-full border border-gray-200 bg-white px-3.5 py-1.5 text-[13px] transition-colors hover:border-gray-300 sm:flex"
                >
                  <span className="text-[11px] font-bold uppercase tracking-wider text-gray-500">Net worth</span>
                  <span className="font-bold tabular-nums text-gray-900">{fmt(netWorth, currency)}</span>
                  {monthlyChange !== 0 && (
                    <span
                      className={`font-semibold tabular-nums ${monthlyChange > 0 ? "text-green-600" : "text-red-600"}`}
                    >
                      {monthlyChange > 0 ? "▲" : "▼"}
                      {fmt(Math.abs(monthlyChange), currency)}
                    </span>
                  )}
                </Link>
              )}

              {/* Desktop Avatar Dropdown */}
              <div className="group relative hidden lg:block">
                <button className="flex items-center gap-1.5 rounded-full border border-gray-200 py-1 pl-1 pr-3 transition-colors hover:border-gray-300">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-amber-200 text-xs font-bold text-amber-900">
                    {user?.displayName?.charAt(0) || "U"}
                  </div>
                  <svg className="h-3 w-3 text-gray-500 transition-transform group-hover:rotate-180" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                  </svg>
                </button>
                <div className="invisible absolute right-0 top-full mt-1.5 w-56 rounded-2xl border border-gray-200 bg-white p-2 opacity-0 shadow-xl shadow-gray-900/10 transition-all group-hover:visible group-hover:opacity-100">
                  <div className="border-b border-gray-100 px-3 py-2.5">
                    <p className="text-sm font-semibold text-gray-900">{user?.displayName || "User"}</p>
                    <p className="text-xs text-gray-500">Signed in</p>
                  </div>
                  <Link
                    href="/account/billing"
                    className="mt-1 block rounded-xl px-3 py-2 text-sm text-gray-700 hover:bg-violet-50 hover:text-violet-700"
                  >
                    Billing
                  </Link>
                  <Link
                    href="/privacy"
                    className="block rounded-xl px-3 py-2 text-sm text-gray-700 hover:bg-gray-100"
                  >
                    Privacy & Terms
                  </Link>
                  <div className="my-1.5 border-t border-gray-100" />
                  <button
                    onClick={handleSignOut}
                    className="block w-full rounded-xl px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50"
                  >
                    Sign out
                  </button>
                </div>
              </div>

              {/* Mobile Menu Button */}
              <button
                onClick={() => setDrawerOpen(true)}
                className="flex h-9 w-9 items-center justify-center rounded-lg border border-gray-200 text-gray-600 lg:hidden"
                aria-label="Menu"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </nav>

      {/* Mobile Drawer */}
      {drawerOpen && (
        <>
          <div
            className="fixed inset-0 z-30 bg-gray-900/28 backdrop-blur-sm"
            onClick={() => setDrawerOpen(false)}
          />
          <aside className="fixed bottom-0 right-0 top-0 z-40 w-80 max-w-[86vw] overflow-y-auto border-l border-gray-200 bg-white p-6 shadow-2xl">
            <div className="mb-3 flex items-center justify-between">
              <Link
                href="/account/dashboard"
                className="flex items-center gap-2 font-bold"
                onClick={() => setDrawerOpen(false)}
              >
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-violet-600 to-violet-700 text-xs font-bold text-white">
                  N
                </div>
                <span className="text-base">
                  networth<span className="text-violet-600">.online</span>
                </span>
              </Link>
              <button
                onClick={() => setDrawerOpen(false)}
                className="flex h-9 w-9 items-center justify-center rounded-lg bg-gray-100 text-gray-600"
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            {netWorth !== 0 && (
              <div className="mb-4 rounded-xl bg-gray-100 p-3 text-sm text-gray-600">
                Net worth <span className="font-bold text-gray-900">{fmt(netWorth, currency)}</span>
                {monthlyChange !== 0 && (
                  <span
                    className={`ml-2 font-semibold ${monthlyChange > 0 ? "text-green-600" : "text-red-600"}`}
                  >
                    {monthlyChange > 0 ? "▲" : "▼"}
                    {fmt(Math.abs(monthlyChange), currency)}
                  </span>
                )}
              </div>
            )}

            <Link
              href="/account/dashboard"
              onClick={() => setDrawerOpen(false)}
              className={`block rounded-xl px-3 py-2 text-[15px] ${
                isActive("/account/dashboard")
                  ? "bg-violet-50 font-semibold text-violet-700"
                  : "text-gray-700"
              }`}
            >
              Dashboard
            </Link>

            <h6 className="mb-1 mt-4 px-3 text-[11px] font-bold uppercase tracking-wider text-gray-400">
              Cash flow
            </h6>
            <Link
              href="/account/income"
              onClick={() => setDrawerOpen(false)}
              className="block rounded-xl px-3 py-2 text-[15px] text-gray-700"
            >
              Income
            </Link>
            <Link
              href="/account/spending"
              onClick={() => setDrawerOpen(false)}
              className="block rounded-xl px-3 py-2 text-[15px] text-gray-700"
            >
              Spending
            </Link>

            <h6 className="mb-1 mt-4 px-3 text-[11px] font-bold uppercase tracking-wider text-gray-400">
              Net worth
            </h6>
            <Link
              href="/account/assets"
              onClick={() => setDrawerOpen(false)}
              className="block rounded-xl px-3 py-2 text-[15px] text-gray-700"
            >
              Assets
            </Link>
            <Link
              href="/account/liabilities"
              onClick={() => setDrawerOpen(false)}
              className="block rounded-xl px-3 py-2 text-[15px] text-gray-700"
            >
              Debts
            </Link>

            <h6 className="mb-1 mt-4 px-3 text-[11px] font-bold uppercase tracking-wider text-gray-400">
              Account
            </h6>
            <Link
              href="/account/statements"
              onClick={() => setDrawerOpen(false)}
              className="block rounded-xl px-3 py-2 text-[15px] text-gray-700"
            >
              Statements
            </Link>
            <Link
              href="/account/billing"
              onClick={() => setDrawerOpen(false)}
              className="block rounded-xl px-3 py-2 text-[15px] text-gray-700"
            >
              Billing
            </Link>

            <div className="mt-6 border-t border-gray-200 pt-4 text-sm text-gray-400">
              <Link href="/privacy" className="inline">
                Privacy & Terms
              </Link>
              {" · "}
              <button onClick={handleSignOut} className="inline text-red-600">
                Sign out
              </button>
            </div>
          </aside>
        </>
      )}
    </>
  );
}
