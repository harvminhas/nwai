"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { getFirebaseClient } from "@/lib/firebase";

const navLinks = [
  { href: "/account/dashboard", label: "Dashboard" },
  { href: "/account/accounts", label: "Accounts" },
  { href: "/account/assets", label: "Assets" },
  { href: "/upload", label: "Upload" },
];

export default function AppNav() {
  const pathname = usePathname();
  const router = useRouter();
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const { auth } = getFirebaseClient();
    return onAuthStateChanged(auth, (user) => {
      setUserEmail(user?.email ?? null);
    });
  }, []);

  async function handleSignOut() {
    const { auth } = getFirebaseClient();
    await signOut(auth);
    router.push("/");
  }

  return (
    <nav className="border-b border-gray-200 bg-white">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-14 items-center justify-between">
          {/* Logo */}
          <Link href="/account/dashboard" className="font-bold text-purple-600 text-lg tracking-tight">
            networth<span className="text-gray-400">.online</span>
          </Link>

          {/* Desktop links */}
          <div className="hidden sm:flex items-center gap-1">
            {navLinks.map(({ href, label }) => {
              const active = pathname === href || (href !== "/upload" && href !== "/account/assets" && href !== "/account/accounts" && pathname.startsWith(href))
                || (href === "/account/assets" && pathname.startsWith("/account/assets"))
                || (href === "/account/accounts" && pathname.startsWith("/account/accounts"));
              return (
                <Link
                  key={href}
                  href={href}
                  className={`rounded-md px-3 py-2 text-sm font-medium transition ${
                    active
                      ? "bg-purple-50 text-purple-700"
                      : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                  }`}
                >
                  {label}
                </Link>
              );
            })}
          </div>

          {/* Right: user + sign out */}
          <div className="hidden sm:flex items-center gap-3">
            {userEmail && (
              <span className="text-xs text-gray-400 max-w-[160px] truncate">{userEmail}</span>
            )}
            <button
              onClick={handleSignOut}
              className="rounded-md px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-900 transition"
            >
              Sign out
            </button>
          </div>

          {/* Mobile hamburger */}
          <button
            className="sm:hidden rounded-md p-2 text-gray-600 hover:bg-gray-100"
            onClick={() => setMenuOpen((o) => !o)}
            aria-label="Toggle menu"
          >
            {menuOpen ? (
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            ) : (
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {/* Mobile menu */}
      {menuOpen && (
        <div className="sm:hidden border-t border-gray-100 bg-white px-4 pb-4 pt-2 space-y-1">
          {navLinks.map(({ href, label }) => {
            const active = pathname === href || (href !== "/upload" && href !== "/account/assets" && href !== "/account/accounts" && pathname.startsWith(href))
                || (href === "/account/assets" && pathname.startsWith("/account/assets"))
                || (href === "/account/accounts" && pathname.startsWith("/account/accounts"));
            return (
              <Link
                key={href}
                href={href}
                onClick={() => setMenuOpen(false)}
                className={`block rounded-md px-3 py-2 text-sm font-medium transition ${
                  active
                    ? "bg-purple-50 text-purple-700"
                    : "text-gray-600 hover:bg-gray-100"
                }`}
              >
                {label}
              </Link>
            );
          })}
          {userEmail && (
            <p className="px-3 pt-2 text-xs text-gray-400 truncate">{userEmail}</p>
          )}
          <button
            onClick={handleSignOut}
            className="block w-full rounded-md px-3 py-2 text-left text-sm font-medium text-gray-600 hover:bg-gray-100 transition"
          >
            Sign out
          </button>
        </div>
      )}
    </nav>
  );
}
