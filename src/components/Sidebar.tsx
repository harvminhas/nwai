"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { getFirebaseClient } from "@/lib/firebase";

const NAV_ITEMS = [
  {
    href: "/account/dashboard",
    label: "Dashboard",
    icon: (
      <svg className="h-5 w-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
      </svg>
    ),
  },
  {
    href: "/account/spending",
    label: "Spending",
    icon: (
      <svg className="h-5 w-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
      </svg>
    ),
  },
  {
    href: "/account/assets",
    label: "Assets",
    icon: (
      <svg className="h-5 w-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
      </svg>
    ),
  },
  {
    href: "/account/liabilities",
    label: "Liabilities",
    icon: (
      <svg className="h-5 w-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2z" />
      </svg>
    ),
  },
  {
    href: "/upload",
    label: "Upload",
    icon: (
      <svg className="h-5 w-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
      </svg>
    ),
  },
];

interface SidebarProps {
  collapsed?: boolean;
  onToggle?: () => void;
}

export default function Sidebar({ collapsed = false, onToggle }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    const { auth } = getFirebaseClient();
    return onAuthStateChanged(auth, (user) => setUserEmail(user?.email ?? null));
  }, []);

  useEffect(() => { setDrawerOpen(false); }, [pathname]);

  async function handleSignOut() {
    const { auth } = getFirebaseClient();
    await signOut(auth);
    router.push("/");
  }

  // Shared nav link renderer
  function NavItem({ href, label, icon, onClick }: { href: string; label: string; icon: React.ReactNode; onClick?: () => void }) {
    const active = pathname === href || (href !== "/upload" && pathname.startsWith(href + "/"));
    return (
      <Link
        href={href}
        onClick={onClick}
        title={collapsed ? label : undefined}
        className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
          active ? "bg-purple-50 text-purple-700" : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
        } ${collapsed ? "justify-center px-2" : ""}`}
      >
        <span className={active ? "text-purple-600" : "text-gray-400"}>{icon}</span>
        {!collapsed && <span className="truncate">{label}</span>}
      </Link>
    );
  }

  return (
    <>
      {/* ── Desktop sidebar ─────────────────────────────────────────────────── */}
      <aside
        className={`hidden lg:fixed lg:inset-y-0 lg:left-0 lg:flex lg:flex-col lg:border-r lg:border-gray-200 lg:bg-white lg:transition-all lg:duration-200 ${
          collapsed ? "lg:w-14" : "lg:w-56"
        }`}
      >
        {/* Logo / icon */}
        <div className={`flex h-14 shrink-0 items-center border-b border-gray-100 ${collapsed ? "justify-center px-2" : "px-5"}`}>
          {collapsed ? (
            <Link href="/account/dashboard" title="networth.online">
              <span className="font-bold text-purple-600 text-lg">N</span>
            </Link>
          ) : (
            <Link href="/account/dashboard" className="font-bold text-purple-600 text-lg tracking-tight">
              networth<span className="text-gray-400">.online</span>
            </Link>
          )}
        </div>

        {/* Nav items */}
        <div className="flex flex-1 flex-col overflow-y-auto py-4">
          <nav className={`flex-1 space-y-0.5 ${collapsed ? "px-1" : "px-3"}`}>
            {NAV_ITEMS.map(({ href, label, icon }) => (
              <NavItem key={href} href={href} label={label} icon={icon} />
            ))}
          </nav>
        </div>

        {/* User + sign out + collapse toggle */}
        <div className={`shrink-0 border-t border-gray-100 ${collapsed ? "p-2 space-y-1" : "p-4"}`}>
          {!collapsed && userEmail && (
            <p className="mb-2 truncate text-xs text-gray-400">{userEmail}</p>
          )}

          {/* Sign out */}
          <button
            onClick={handleSignOut}
            title={collapsed ? "Sign out" : undefined}
            className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition ${collapsed ? "justify-center px-2" : ""}`}
          >
            <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            {!collapsed && <span>Sign out</span>}
          </button>

          {/* Collapse toggle */}
          {onToggle && (
          <button
            onClick={onToggle}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition ${collapsed ? "justify-center px-2" : ""}`}
          >
            <svg
              className={`h-4 w-4 shrink-0 transition-transform duration-200 ${collapsed ? "rotate-180" : ""}`}
              fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
            </svg>
            {!collapsed && <span>Collapse</span>}
          </button>
          )}
        </div>
      </aside>

      {/* ── Mobile top bar ───────────────────────────────────────────────────── */}
      <div className="flex h-14 items-center justify-between border-b border-gray-200 bg-white px-4 lg:hidden">
        <Link href="/account/dashboard" className="font-bold text-purple-600 text-lg tracking-tight">
          networth<span className="text-gray-400">.online</span>
        </Link>
        <button
          onClick={() => setDrawerOpen(true)}
          className="rounded-md p-2 text-gray-600 hover:bg-gray-100"
          aria-label="Open menu"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
      </div>

      {/* ── Mobile drawer ────────────────────────────────────────────────────── */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setDrawerOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-64 flex-col bg-white shadow-xl">
            <div className="flex h-14 shrink-0 items-center justify-between border-b border-gray-100 px-5">
              <Link href="/account/dashboard" className="font-bold text-purple-600 text-lg tracking-tight">
                networth<span className="text-gray-400">.online</span>
              </Link>
              <button onClick={() => setDrawerOpen(false)} className="text-gray-400 hover:text-gray-600">
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="flex flex-1 flex-col overflow-y-auto py-4">
              <nav className="flex-1 space-y-0.5 px-3">
                {NAV_ITEMS.map(({ href, label, icon }) => (
                  <NavItem key={href} href={href} label={label} icon={icon} onClick={() => setDrawerOpen(false)} />
                ))}
              </nav>
            </div>
            <div className="shrink-0 border-t border-gray-100 p-4">
              {userEmail && <p className="mb-2 truncate text-xs text-gray-400">{userEmail}</p>}
              <button
                onClick={handleSignOut}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-gray-500 hover:bg-gray-100 transition"
              >
                <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
                Sign out
              </button>
            </div>
          </aside>
        </div>
      )}
    </>
  );
}
