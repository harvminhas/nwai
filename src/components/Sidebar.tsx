"use client";

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { getFirebaseClient } from "@/lib/firebase";
import { usePlan } from "@/contexts/PlanContext";
import { useActiveProfile } from "@/contexts/ActiveProfileContext";
import { PLANS, PLAN_ORDER, type PlanId, type PlanFeatures } from "@/lib/plans";

// ── nav structure ─────────────────────────────────────────────────────────────

interface NavItemDef {
  href: string;
  label: string;
  icon: React.ReactNode;
  proFeature?: keyof PlanFeatures;
  disabled?: boolean;
}

const NAV_GROUPS: { section: string; items: NavItemDef[] }[] = [
  {
    section: "OVERVIEW",
    items: [
      {
        href: "/account/dashboard",
        label: "Today",
        icon: (
          <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
          </svg>
        ),
      },
      {
        href: "/account/overview",
        label: "Financial Health",
        icon: (
          <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
          </svg>
        ),
      },
    ],
  },
  {
    section: "MONEY",
    items: [
      {
        href: "/account/income",
        label: "Income",
        icon: (
          <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        ),
      },
      {
        href: "/account/spending",
        label: "Spending",
        icon: (
          <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
          </svg>
        ),
      },
      {
        href: "/account/assets",
        label: "Assets",
        icon: (
          <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
          </svg>
        ),
      },
      {
        href: "/account/liabilities",
        label: "Debts",
        icon: (
          <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2z" />
          </svg>
        ),
      },
    ],
  },
  {
    section: "Look ahead",
    items: [
      {
        href: "/account/events",
        label: "Plans",
        icon: (
          <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
        ),
      },
      {
        href: "/account/goals",
        label: "Goals",
        proFeature: "goals" as keyof PlanFeatures,
        icon: (
          <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" />
          </svg>
        ),
      },
      {
        href: "/account/whatif",
        label: "Scenarios",
        proFeature: "whatIf" as keyof PlanFeatures,
        icon: (
          <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        ),
      },
      {
        href: "/account/forecast",
        label: "Forecast",
        proFeature: "forecast" as keyof PlanFeatures,
        icon: (
          <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z" />
          </svg>
        ),
      },
      {
        href: "/account/payoff",
        label: "Payoff planner",
        disabled: true,
        icon: (
          <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
          </svg>
        ),
      },
    ],
  },
];

// ── helpers ───────────────────────────────────────────────────────────────────

function fmtUploadDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// ── component ─────────────────────────────────────────────────────────────────

interface SidebarProps {
  collapsed?: boolean;
  onToggle?: () => void;
}

export default function Sidebar({ collapsed = false, onToggle }: SidebarProps) {
  const pathname = usePathname();
  const router   = useRouter();
  const { planId, setTestPlan } = usePlan();
  const { partner, isOwn, selfDisplayName, switchToPartner, switchToSelf } = useActiveProfile();
  const [userEmail, setUserEmail]         = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen]       = useState(false);
  const [lastUpload, setLastUpload]       = useState<string | null>(null);
  const [accountCount, setAccountCount]   = useState<number | null>(null);
  const [switcherOpen, setSwitcherOpen]   = useState(false);
  const [userMenuOpen, setUserMenuOpen]   = useState(false);
  const desktopSwitcherRef                = useRef<HTMLDivElement>(null);
  const mobileSwitcherRef                 = useRef<HTMLDivElement>(null);
  const userMenuRef                       = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const { auth } = getFirebaseClient();
    return onAuthStateChanged(auth, async (user) => {
      setUserEmail(user?.email ?? null);
      if (!user) return;
      try {
        const token = await user.getIdToken();
        const res = await fetch("/api/user/statements/consolidated", {
          headers: { Authorization: `Bearer ${token}` },
        });
        const json = await res.json().catch(() => ({}));
        if (res.ok) {
          setLastUpload(json.lastUploadedAt ?? null);
          setAccountCount(json.accountCount ?? null);
        }
      } catch { /* silent */ }
    });
  }, []);

  useEffect(() => { setDrawerOpen(false); setSwitcherOpen(false); setUserMenuOpen(false); }, [pathname]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      const t = e.target as Node;
      const insideDesktop = desktopSwitcherRef.current?.contains(t);
      const insideMobile  = mobileSwitcherRef.current?.contains(t);
      if (!insideDesktop && !insideMobile) setSwitcherOpen(false);
      if (!userMenuRef.current?.contains(t)) setUserMenuOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  async function handleSignOut() {
    const { auth } = getFirebaseClient();
    await signOut(auth);
    router.push("/");
  }

  // ── nav renderer ──────────────────────────────────────────────────────────

  function NavItem({
    href, label, icon, disabled, proFeature, onClick,
  }: {
    href: string; label: string; icon: React.ReactNode;
    disabled?: boolean; proFeature?: keyof PlanFeatures; onClick?: () => void;
  }) {
    const active  = !disabled && (pathname === href || (href !== "/upload" && pathname.startsWith(href + "/")));
    const locked  = proFeature ? !PLANS[planId].features[proFeature] : false;

    if (disabled) {
      return (
        <div
          title={collapsed ? label : undefined}
          className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-gray-300 cursor-not-allowed select-none ${collapsed ? "justify-center px-2" : ""}`}
        >
          <span className="text-gray-300">{icon}</span>
          {!collapsed && (
            <span className="flex flex-1 items-center justify-between truncate">
              {label}
              <span className="ml-2 rounded-full bg-gray-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-gray-400">soon</span>
            </span>
          )}
        </div>
      );
    }

    return (
      <Link
        href={href}
        onClick={onClick}
        title={collapsed ? label : undefined}
        className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
          active ? "bg-purple-50 text-purple-700" : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
        } ${collapsed ? "justify-center px-2" : ""}`}
      >
        <span className={active ? "text-purple-600" : locked ? "text-gray-300" : "text-gray-400"}>{icon}</span>
        {!collapsed && (
          <span className="flex flex-1 items-center justify-between truncate">
            <span className={locked ? "text-gray-400" : ""}>{label}</span>
            {locked && (
              <span className="ml-2 shrink-0 rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-600">
                Pro
              </span>
            )}
          </span>
        )}
      </Link>
    );
  }

  function NavGroups({ onItemClick }: { onItemClick?: () => void }) {
    return (
      <div className={`space-y-4 ${collapsed ? "px-1" : "px-3"}`}>
        {NAV_GROUPS.map(({ section, items }) => (
          <div key={section}>
            {/* Section label — hidden when collapsed */}
            {!collapsed && (
              <p className="mb-1 px-3 text-[10px] font-semibold uppercase tracking-widest text-gray-300">
                {section}
              </p>
            )}
            <div className="space-y-0.5">
              {items.map(({ href, label, icon, disabled, proFeature }) => (
                <NavItem
                  key={href} href={href} label={label} icon={icon}
                  disabled={disabled}
                  proFeature={proFeature as keyof PlanFeatures | undefined}
                  onClick={onItemClick}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }

  // ── desktop sidebar ───────────────────────────────────────────────────────

  return (
    <>
      <aside
        className={`hidden lg:fixed lg:inset-y-0 lg:left-0 lg:flex lg:flex-col lg:border-r lg:border-gray-100 lg:bg-white lg:transition-all lg:duration-200 ${
          collapsed ? "lg:w-14" : "lg:w-56"
        }`}
      >
        {/* Logo + collapse toggle + account switcher */}
        <div className={`shrink-0 border-b border-gray-100 ${collapsed ? "px-2 py-3" : "px-4 pt-3 pb-2"}`}>
          <div className={`flex h-8 items-center ${collapsed ? "justify-center" : "justify-between"}`}>
            {collapsed ? (
              <button onClick={onToggle} title="Expand sidebar" className="flex items-center justify-center rounded-lg p-1 text-purple-600 hover:bg-purple-50 transition">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 5l7 7-7 7M5 5l7 7-7 7" />
                </svg>
              </button>
            ) : (
              <>
                <Link href="/account/dashboard" className="font-bold text-purple-600 text-lg tracking-tight">
                  networth<span className="text-gray-400">.online</span>
                </Link>
                {onToggle && (
                  <button onClick={onToggle} title="Collapse sidebar"
                    className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition">
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
                    </svg>
                  </button>
                )}
              </>
            )}
          </div>

          {/* Account switcher dropdown — only when a partner is linked */}
          {partner && !collapsed && (
            <div className="relative mt-2" ref={desktopSwitcherRef}>
              <button
                onClick={() => setSwitcherOpen((o) => !o)}
                className="flex w-full items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-100 transition"
              >
                <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-purple-100 text-[10px] font-bold text-purple-700">
                  {(isOwn ? selfDisplayName : partner.partnerName)[0]?.toUpperCase() ?? "?"}
                </div>
                <span className="flex-1 truncate text-left">
                  {isOwn ? selfDisplayName : partner.partnerName}
                </span>
                <svg className={`h-3.5 w-3.5 shrink-0 text-gray-400 transition-transform ${switcherOpen ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {switcherOpen && (
                <div className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg">
                  <button
                    onClick={() => { switchToSelf(); setSwitcherOpen(false); }}
                    className={`flex w-full items-center gap-2 px-3 py-2 text-xs transition hover:bg-gray-50 ${isOwn ? "bg-purple-50" : ""}`}
                  >
                    <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-purple-100 text-[10px] font-bold text-purple-700">
                      {selfDisplayName[0]?.toUpperCase() ?? "M"}
                    </div>
                    <span className={`flex-1 truncate text-left ${isOwn ? "font-semibold text-purple-700" : "text-gray-600"}`}>
                      {selfDisplayName}
                    </span>
                    {isOwn && (
                      <svg className="h-3.5 w-3.5 text-purple-500" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                    )}
                  </button>
                  <button
                    onClick={() => { switchToPartner(); setSwitcherOpen(false); }}
                    className={`flex w-full items-center gap-2 border-t border-gray-100 px-3 py-2 text-xs transition hover:bg-gray-50 ${!isOwn ? "bg-purple-50" : ""}`}
                  >
                    <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-purple-100 text-[10px] font-bold text-purple-700">
                      {partner.partnerName[0]?.toUpperCase() ?? "?"}
                    </div>
                    <span className={`flex-1 truncate text-left ${!isOwn ? "font-semibold text-purple-700" : "text-gray-600"}`}>
                      {partner.partnerName}
                    </span>
                    {!isOwn && (
                      <svg className="h-3.5 w-3.5 text-purple-500" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                    )}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Upload button */}
        <div className={`shrink-0 border-b border-gray-100 ${collapsed ? "p-2" : "px-4 py-3"}`}>
          <Link
            href="/upload"
            title={collapsed ? "Upload statement" : undefined}
            className={`flex items-center gap-2 rounded-lg bg-purple-600 px-3 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-purple-700 ${collapsed ? "justify-center px-2" : ""}`}
          >
            <svg className="h-3.5 w-3.5 shrink-0 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
            {!collapsed && "Upload statement"}
          </Link>
        </div>

        {/* Nav groups */}
        <div className="flex flex-1 flex-col overflow-y-auto py-4">
          <nav className="flex-1">
            <NavGroups />
          </nav>
        </div>

        {/* Footer — slim user row */}
        <div className={`shrink-0 border-t border-gray-100 ${collapsed ? "p-2" : "px-3 py-2"}`}>
          <div className="relative" ref={userMenuRef}>

            {/* User row button */}
            <button
              onClick={() => setUserMenuOpen((o) => !o)}
              title={collapsed ? (selfDisplayName || userEmail || "Account") : undefined}
              className={`flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left transition hover:bg-gray-50 ${collapsed ? "justify-center" : ""}`}
            >
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-purple-100 text-xs font-bold text-purple-700">
                {(selfDisplayName || userEmail || "?")[0]?.toUpperCase()}
              </div>
              {!collapsed && (
                <>
                  <div className="flex-1 min-w-0">
                    <p className="truncate text-xs font-semibold text-gray-700 leading-tight">
                      {selfDisplayName || userEmail || "Account"}
                    </p>
                    {planId === "pro" && (
                      <p className="text-[10px] text-purple-500 font-medium leading-tight">Pro</p>
                    )}
                  </div>
                  <svg className={`h-3.5 w-3.5 shrink-0 text-gray-400 transition-transform ${userMenuOpen ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </>
              )}
            </button>

            {/* Popover — opens upward */}
            {userMenuOpen && (
              <div className="absolute bottom-full left-0 right-0 z-50 mb-1 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg">
                {/* Last upload info */}
                {lastUpload && (
                  <div className="border-b border-gray-100 px-3 py-2">
                    <p className="text-[10px] text-gray-400">
                      Last upload: {fmtUploadDate(lastUpload)}
                      {accountCount != null && ` · ${accountCount} account${accountCount !== 1 ? "s" : ""}`}
                    </p>
                  </div>
                )}

                {/* Activity & Coverage */}
                <Link href="/account/activity" className={`flex items-center gap-2 px-3 py-2 text-xs font-medium transition hover:bg-gray-50 ${pathname === "/account/activity" ? "text-purple-700 bg-purple-50" : "text-gray-600"}`}>
                  <svg className="h-3.5 w-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Activity &amp; Coverage
                </Link>

                {/* Manage uploads */}
                <Link href="/account/statements" className={`flex items-center gap-2 px-3 py-2 text-xs font-medium transition hover:bg-gray-50 ${pathname === "/account/statements" ? "text-purple-700 bg-purple-50" : "text-gray-600"}`}>
                  <svg className="h-3.5 w-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
                  </svg>
                  Manage uploads
                </Link>

                {/* Sharing */}
                <Link href="/account/sharing" className={`flex items-center gap-2 px-3 py-2 text-xs font-medium transition hover:bg-gray-50 ${pathname === "/account/sharing" ? "text-purple-700 bg-purple-50" : "text-gray-600"}`}>
                  <svg className="h-3.5 w-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  Sharing
                </Link>

                {/* Billing */}
                {planId === "free" ? (
                  <Link href="/account/billing" className="flex items-center gap-2 px-3 py-2 text-xs font-semibold text-purple-600 hover:bg-purple-50 transition">
                    <svg className="h-3.5 w-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
                    </svg>
                    Upgrade to Pro
                  </Link>
                ) : (
                  <Link href="/account/billing" className="flex items-center gap-2 px-3 py-2 text-xs font-medium text-purple-600 hover:bg-purple-50 transition">
                    <svg className="h-3.5 w-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" />
                    </svg>
                    Pro · Manage
                  </Link>
                )}

                {/* Dev test plan switcher */}
                {process.env.NODE_ENV === "development" && (
                  <div className="border-t border-gray-100 px-3 py-2">
                    <p className="text-[9px] font-bold uppercase tracking-widest text-amber-500 mb-1.5">🧪 Test plan</p>
                    <div className="flex gap-1">
                      {PLAN_ORDER.map((id) => (
                        <button key={id} onClick={() => setTestPlan(id as PlanId)}
                          className={`flex-1 rounded-md px-1.5 py-1 text-[10px] font-semibold transition ${planId === id ? "bg-amber-500 text-white" : "bg-white text-amber-600 border border-amber-200 hover:bg-amber-100"}`}
                        >
                          {PLANS[id as PlanId].name}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Sign out */}
                <div className="border-t border-gray-100">
                  <button onClick={handleSignOut} className="flex w-full items-center gap-2 px-3 py-2 text-xs font-medium text-gray-500 hover:bg-gray-50 hover:text-gray-700 transition">
                    <svg className="h-3.5 w-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                    </svg>
                    Sign out
                  </button>
                  <div className="flex gap-3 px-3 pb-2">
                    <Link href="/privacy" className="text-[10px] text-gray-400 hover:text-gray-600 transition">Privacy</Link>
                    <Link href="/terms" className="text-[10px] text-gray-400 hover:text-gray-600 transition">Terms</Link>
                  </div>
                </div>
              </div>
            )}
          </div>

        </div>
      </aside>

      {/* ── Mobile top bar ───────────────────────────────────────────────────── */}
      <div className="flex h-14 items-center justify-between border-b border-gray-200 bg-white px-4 lg:hidden">
        <div className="flex items-center gap-3 min-w-0">
          <Link href="/account/dashboard" className="font-bold text-purple-600 text-lg tracking-tight shrink-0">
            networth<span className="text-gray-400">.online</span>
          </Link>
          {partner && (
            <div className="relative" ref={mobileSwitcherRef}>
              <button
                onClick={() => setSwitcherOpen((o) => !o)}
                className="flex items-center gap-1.5 rounded-full border border-gray-200 bg-gray-50 pl-1.5 pr-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100 transition"
              >
                <div className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-purple-100 text-[9px] font-bold text-purple-700">
                  {(isOwn ? selfDisplayName : partner.partnerName)[0]?.toUpperCase() ?? "?"}
                </div>
                <span className="max-w-[80px] truncate">{isOwn ? selfDisplayName : partner.partnerName}</span>
                <svg className={`h-3 w-3 text-gray-400 transition-transform ${switcherOpen ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {switcherOpen && (
                <div className="absolute left-0 top-full z-50 mt-1 w-44 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg">
                  <button
                    onClick={() => { switchToSelf(); setSwitcherOpen(false); }}
                    className={`flex w-full items-center gap-2 px-3 py-2 text-xs transition hover:bg-gray-50 ${isOwn ? "bg-purple-50" : ""}`}
                  >
                    <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-purple-100 text-[10px] font-bold text-purple-700">
                      {selfDisplayName[0]?.toUpperCase() ?? "M"}
                    </div>
                    <span className={`flex-1 truncate text-left ${isOwn ? "font-semibold text-purple-700" : "text-gray-600"}`}>{selfDisplayName}</span>
                    {isOwn && <svg className="h-3.5 w-3.5 text-purple-500" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>}
                  </button>
                  <button
                    onClick={() => { switchToPartner(); setSwitcherOpen(false); }}
                    className={`flex w-full items-center gap-2 border-t border-gray-100 px-3 py-2 text-xs transition hover:bg-gray-50 ${!isOwn ? "bg-purple-50" : ""}`}
                  >
                    <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-purple-100 text-[10px] font-bold text-purple-700">
                      {partner.partnerName[0]?.toUpperCase() ?? "?"}
                    </div>
                    <span className={`flex-1 truncate text-left ${!isOwn ? "font-semibold text-purple-700" : "text-gray-600"}`}>{partner.partnerName}</span>
                    {!isOwn && <svg className="h-3.5 w-3.5 text-purple-500" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
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
            {/* Upload button */}
            <div className="shrink-0 border-b border-gray-100 px-4 py-3">
              <Link
                href="/upload"
                onClick={() => setDrawerOpen(false)}
                className="flex items-center gap-2 rounded-lg bg-purple-600 px-3 py-2 text-xs font-semibold text-white hover:bg-purple-700 transition"
              >
                <svg className="h-3.5 w-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                </svg>
                Upload statement
              </Link>
            </div>
            <div className="flex flex-1 flex-col overflow-y-auto py-4">
              <nav className="flex-1">
                <NavGroups onItemClick={() => setDrawerOpen(false)} />
              </nav>
            </div>
            <div className="shrink-0 border-t border-gray-100 p-3 space-y-1">
              {/* User info */}
              <div className="flex items-center gap-2.5 px-2 py-1.5">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-purple-100 text-xs font-bold text-purple-700">
                  {(selfDisplayName || userEmail || "?")[0]?.toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="truncate text-xs font-semibold text-gray-700">{selfDisplayName || userEmail}</p>
                  {planId === "pro" && <p className="text-[10px] text-purple-500 font-medium">Pro</p>}
                </div>
              </div>

              <Link href="/account/activity" onClick={() => setDrawerOpen(false)}
                className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition ${pathname === "/account/activity" ? "bg-purple-50 text-purple-700" : "text-gray-500 hover:bg-gray-100"}`}>
                <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Activity &amp; Coverage
              </Link>

              <Link href="/account/statements" onClick={() => setDrawerOpen(false)}
                className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition ${pathname === "/account/statements" ? "bg-purple-50 text-purple-700" : "text-gray-500 hover:bg-gray-100"}`}>
                <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
                </svg>
                Manage uploads
              </Link>

              <Link href="/account/sharing" onClick={() => setDrawerOpen(false)}
                className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition ${pathname === "/account/sharing" ? "bg-purple-50 text-purple-700" : "text-gray-500 hover:bg-gray-100"}`}>
                <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                Sharing
              </Link>

              {planId === "free" ? (
                <Link href="/account/billing" onClick={() => setDrawerOpen(false)}
                  className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-purple-600 hover:bg-purple-50 transition">
                  <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
                  </svg>
                  Upgrade to Pro
                </Link>
              ) : (
                <Link href="/account/billing" onClick={() => setDrawerOpen(false)}
                  className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-purple-600 hover:bg-purple-50 transition">
                  <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" />
                  </svg>
                  Pro · Manage
                </Link>
              )}

              {process.env.NODE_ENV === "development" && (
                <div className="rounded-lg bg-amber-50 border border-amber-100 px-3 py-2">
                  <p className="text-[9px] font-bold uppercase tracking-widest text-amber-500 mb-1.5">🧪 Test plan</p>
                  <div className="flex gap-1">
                    {PLAN_ORDER.map((id) => (
                      <button key={id} onClick={() => setTestPlan(id as PlanId)}
                        className={`flex-1 rounded-md px-1.5 py-1 text-[10px] font-semibold transition ${planId === id ? "bg-amber-500 text-white" : "bg-white text-amber-600 border border-amber-200 hover:bg-amber-100"}`}>
                        {PLANS[id as PlanId].name}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <button onClick={handleSignOut}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-gray-500 hover:bg-gray-100 transition">
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
