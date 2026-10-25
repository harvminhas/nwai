"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { getFirebaseClient } from "@/lib/firebase";
import { fmt } from "@/lib/currencyUtils";

interface NetWorthData {
  netWorth: number;
  monthlyChange: number;
  currency: string;
}

export function TopNav({ netWorthData }: { netWorthData?: NetWorthData }) {
  const pathname = usePathname();
  const router = useRouter();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [user, setUser] = useState<any>(null);

  useEffect(() => {
    const { auth } = getFirebaseClient();
    return onAuthStateChanged(auth, setUser);
  }, []);

  const handleSignOut = async () => {
    const { auth } = getFirebaseClient();
    await signOut(auth);
    router.push("/login");
  };

  const isActive = (path: string) => pathname === path;

  const { netWorth = 0, monthlyChange = 0, currency = "USD" } = netWorthData || {};

  return (
    <>
      {/* Top Navigation */}
      <nav className="sticky top-0 z-20 border-b border-gray-200 bg-white/90 backdrop-blur-sm">
        <div className="mx-auto max-w-7xl px-4">
          <div className="flex h-16 items-center justify-between gap-6">
            {/* Logo */}
            <Link href="/account/dashboard" className="flex items-center gap-2 font-bold">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-purple-500 to-purple-700 text-xs font-bold text-white">
                N
              </div>
              <span className="hidden text-base sm:inline">
                networth<span className="text-purple-600">.online</span>
              </span>
            </Link>

            {/* Desktop Navigation */}
            <div className="hidden items-center gap-1 lg:flex">
              <Link
                href="/account/dashboard"
                className={`rounded-lg px-3 py-2 text-sm font-medium ${
                  isActive("/account/dashboard")
                    ? "bg-purple-50 text-purple-700"
                    : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                }`}
              >
                Home
              </Link>
              <Link
                href="/account/today"
                className={`rounded-lg px-3 py-2 text-sm font-medium ${
                  isActive("/account/today")
                    ? "bg-purple-50 text-purple-700"
                    : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                }`}
              >
                Today
              </Link>
              <Link
                href="/account/overview"
                className={`rounded-lg px-3 py-2 text-sm font-medium ${
                  isActive("/account/overview")
                    ? "bg-purple-50 text-purple-700"
                    : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                }`}
              >
                Financial Health
              </Link>

              {/* Money Dropdown */}
              <div className="group relative">
                <button className="flex items-center gap-1 rounded-lg px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-900">
                  Money
                  <svg className="h-3 w-3 transition-transform group-hover:rotate-180" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                  </svg>
                </button>
                <div className="invisible absolute left-0 top-full mt-1 w-48 rounded-xl border border-gray-200 bg-white p-1.5 opacity-0 shadow-lg transition-all group-hover:visible group-hover:opacity-100">
                  <Link href="/account/income" className="block rounded-lg px-3 py-2 text-sm text-gray-700 hover:bg-purple-50 hover:text-purple-700">
                    Income
                  </Link>
                  <Link href="/account/spending" className="block rounded-lg px-3 py-2 text-sm text-gray-700 hover:bg-purple-50 hover:text-purple-700">
                    Spending
                  </Link>
                  <Link href="/account/assets" className="block rounded-lg px-3 py-2 text-sm text-gray-700 hover:bg-purple-50 hover:text-purple-700">
                    Assets
                  </Link>
                  <Link href="/account/liabilities" className="block rounded-lg px-3 py-2 text-sm text-gray-700 hover:bg-purple-50 hover:text-purple-700">
                    Debts
                  </Link>
                </div>
              </div>

              {/* Look Ahead Dropdown */}
              <div className="group relative">
                <button className="flex items-center gap-1 rounded-lg px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-900">
                  Look ahead
                  <svg className="h-3 w-3 transition-transform group-hover:rotate-180" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                  </svg>
                </button>
                <div className="invisible absolute left-0 top-full mt-1 w-48 rounded-xl border border-gray-200 bg-white p-1.5 opacity-0 shadow-lg transition-all group-hover:visible group-hover:opacity-100">
                  <Link href="/account/forecast" className="block rounded-lg px-3 py-2 text-sm text-gray-700 hover:bg-purple-50 hover:text-purple-700">
                    Forecast
                  </Link>
                  <Link href="/account/trackers" className="block rounded-lg px-3 py-2 text-sm text-gray-700 hover:bg-purple-50 hover:text-purple-700">
                    Trackers
                  </Link>
                  <Link href="/account/payoff" className="block rounded-lg px-3 py-2 text-sm text-gray-700 hover:bg-purple-50 hover:text-purple-700">
                    Payoff planner
                  </Link>
                  <Link href="/account/goals" className="block rounded-lg px-3 py-2 text-sm text-gray-700 hover:bg-purple-50 hover:text-purple-700">
                    Goals
                  </Link>
                  <Link href="/account/whatif" className="block rounded-lg px-3 py-2 text-sm text-gray-700 hover:bg-purple-50 hover:text-purple-700">
                    Scenarios
                  </Link>
                </div>
              </div>
            </div>

            {/* Right Side */}
            <div className="flex items-center gap-3">
              {/* Net Worth Pill */}
              {netWorth !== 0 && (
                <div className="hidden items-center gap-2 whitespace-nowrap rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs sm:flex">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500">Net worth</span>
                  <span className="font-bold text-gray-900">{fmt(netWorth, currency)}</span>
                  {monthlyChange !== 0 && (
                    <span className={`font-semibold ${monthlyChange > 0 ? "text-green-600" : "text-red-600"}`}>
                      {monthlyChange > 0 ? "▲" : "▼"}
                      {fmt(Math.abs(monthlyChange), currency)}
                    </span>
                  )}
                </div>
              )}

              {/* Upload Button */}
              <Link
                href="/upload"
                className="rounded-xl bg-purple-600 px-4 py-2 text-sm font-semibold text-white hover:bg-purple-700"
              >
                <span className="hidden sm:inline">⬆ Upload</span>
                <span className="sm:hidden">⬆</span>
              </Link>

              {/* Desktop Avatar Dropdown */}
              <div className="group relative hidden lg:block">
                <button className="flex items-center gap-1.5 rounded-full border border-gray-200 py-1 pl-1 pr-3 hover:border-gray-300">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-amber-200 text-xs font-bold text-amber-900">
                    {user?.displayName?.charAt(0) || "U"}
                  </div>
                  <svg className="h-3 w-3 text-gray-500" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                  </svg>
                </button>
                <div className="invisible absolute right-0 top-full mt-1 w-56 rounded-xl border border-gray-200 bg-white p-1.5 opacity-0 shadow-lg transition-all group-hover:visible group-hover:opacity-100">
                  <div className="border-b border-gray-100 px-3 py-2">
                    <p className="text-sm font-semibold text-gray-900">{user?.displayName || "User"}</p>
                    <p className="text-xs text-gray-500">Signed in</p>
                  </div>
                  <Link href="/account/activity" className="block rounded-lg px-3 py-2 text-sm text-gray-700 hover:bg-purple-50 hover:text-purple-700">
                    Activity
                  </Link>
                  <Link href="/account/statements" className="block rounded-lg px-3 py-2 text-sm text-gray-700 hover:bg-purple-50 hover:text-purple-700">
                    Statements
                  </Link>
                  <Link href="/account/sharing" className="block rounded-lg px-3 py-2 text-sm text-gray-700 hover:bg-purple-50 hover:text-purple-700">
                    Sharing
                  </Link>
                  <Link href="/account/billing" className="block rounded-lg px-3 py-2 text-sm text-gray-700 hover:bg-purple-50 hover:text-purple-700">
                    Billing
                  </Link>
                  <div className="my-1.5 border-t border-gray-100" />
                  <Link href="/privacy" className="block rounded-lg px-3 py-2 text-xs text-gray-500 hover:bg-gray-50">
                    Privacy
                  </Link>
                  <Link href="/terms" className="block rounded-lg px-3 py-2 text-xs text-gray-500 hover:bg-gray-50">
                    Terms
                  </Link>
                  <div className="my-1.5 border-t border-gray-100" />
                  <button
                    onClick={handleSignOut}
                    className="block w-full rounded-lg px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50"
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
            className="fixed inset-0 z-30 bg-gray-900/40"
            onClick={() => setDrawerOpen(false)}
          />
          <aside className="fixed right-0 top-0 bottom-0 z-40 w-80 max-w-[86vw] overflow-y-auto bg-white p-4 shadow-2xl">
            <div className="mb-3 flex items-center justify-between">
              <Link href="/account/dashboard" className="flex items-center gap-2 font-bold" onClick={() => setDrawerOpen(false)}>
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-purple-500 to-purple-700 text-xs font-bold text-white">
                  N
                </div>
                <span className="text-base">
                  networth<span className="text-purple-600">.online</span>
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
              <div className="mb-2 rounded-xl bg-gray-100 p-3 text-sm text-gray-600">
                Net worth <span className="font-bold text-gray-900">{fmt(netWorth, currency)}</span>
                {monthlyChange !== 0 && (
                  <span className={`ml-2 font-semibold ${monthlyChange > 0 ? "text-green-600" : "text-red-600"}`}>
                    {monthlyChange > 0 ? "▲" : "▼"}
                    {fmt(Math.abs(monthlyChange), currency)}
                  </span>
                )}
              </div>
            )}

            <Link
              href="/account/dashboard"
              onClick={() => setDrawerOpen(false)}
              className={`block rounded-lg px-3 py-2 text-base ${
                isActive("/account/dashboard")
                  ? "bg-purple-50 font-semibold text-purple-700"
                  : "text-gray-700"
              }`}
            >
              Home
            </Link>

            <h6 className="mb-1 mt-4 px-3 text-[11px] font-bold uppercase tracking-wider text-gray-400">Overview</h6>
            <Link href="/account/today" onClick={() => setDrawerOpen(false)} className="block rounded-lg px-3 py-2 text-base text-gray-700">
              Today
            </Link>
            <Link href="/account/overview" onClick={() => setDrawerOpen(false)} className="block rounded-lg px-3 py-2 text-base text-gray-700">
              Financial Health
            </Link>

            <h6 className="mb-1 mt-4 px-3 text-[11px] font-bold uppercase tracking-wider text-gray-400">Money</h6>
            <Link href="/account/income" onClick={() => setDrawerOpen(false)} className="block rounded-lg px-3 py-2 text-base text-gray-700">
              Income
            </Link>
            <Link href="/account/spending" onClick={() => setDrawerOpen(false)} className="block rounded-lg px-3 py-2 text-base text-gray-700">
              Spending
            </Link>
            <Link href="/account/assets" onClick={() => setDrawerOpen(false)} className="block rounded-lg px-3 py-2 text-base text-gray-700">
              Assets
            </Link>
            <Link href="/account/liabilities" onClick={() => setDrawerOpen(false)} className="block rounded-lg px-3 py-2 text-base text-gray-700">
              Debts
            </Link>

            <h6 className="mb-1 mt-4 px-3 text-[11px] font-bold uppercase tracking-wider text-gray-400">Look ahead</h6>
            <Link href="/account/forecast" onClick={() => setDrawerOpen(false)} className="block rounded-lg px-3 py-2 text-base text-gray-700">
              Forecast
            </Link>
            <Link href="/account/trackers" onClick={() => setDrawerOpen(false)} className="block rounded-lg px-3 py-2 text-base text-gray-700">
              Trackers
            </Link>
            <Link href="/account/payoff" onClick={() => setDrawerOpen(false)} className="block rounded-lg px-3 py-2 text-base text-gray-700">
              Payoff planner
            </Link>
            <Link href="/account/goals" onClick={() => setDrawerOpen(false)} className="block rounded-lg px-3 py-2 text-base text-gray-700">
              Goals
            </Link>
            <Link href="/account/whatif" onClick={() => setDrawerOpen(false)} className="block rounded-lg px-3 py-2 text-base text-gray-700">
              Scenarios
            </Link>

            <h6 className="mb-1 mt-4 px-3 text-[11px] font-bold uppercase tracking-wider text-gray-400">Account</h6>
            <Link href="/account/activity" onClick={() => setDrawerOpen(false)} className="block rounded-lg px-3 py-2 text-base text-gray-700">
              Activity
            </Link>
            <Link href="/account/statements" onClick={() => setDrawerOpen(false)} className="block rounded-lg px-3 py-2 text-base text-gray-700">
              Statements
            </Link>
            <Link href="/account/sharing" onClick={() => setDrawerOpen(false)} className="block rounded-lg px-3 py-2 text-base text-gray-700">
              Sharing
            </Link>
            <Link href="/account/billing" onClick={() => setDrawerOpen(false)} className="block rounded-lg px-3 py-2 text-base text-gray-700">
              Billing
            </Link>

            <div className="mt-4 border-t border-gray-200 pt-4 text-sm text-gray-400">
              <Link href="/privacy" className="inline">Privacy</Link>
              {" · "}
              <Link href="/terms" className="inline">Terms</Link>
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
