"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import { ProfileRefreshProvider } from "@/contexts/ProfileRefreshContext";
import { ActiveProfileProvider, useActiveProfile } from "@/contexts/ActiveProfileContext";
import { usePlan } from "@/contexts/PlanContext";

function ChatBubble() {
  const { can } = usePlan();
  const pathname = usePathname();
  // Hide on the chat page itself
  if (pathname === "/account/chat") return null;

  const isPro = can("aiChat");

  return (
    <Link
      href="/account/chat"
      title={isPro ? "AI Financial Chat" : "Upgrade to access AI Financial Chat"}
      className={`fixed bottom-5 right-5 z-50 flex h-12 w-12 items-center justify-center rounded-full shadow-lg ring-2 ring-white transition-transform hover:scale-105 active:scale-95 ${
        isPro
          ? "bg-purple-600 hover:bg-purple-700"
          : "bg-gray-400 hover:bg-gray-500"
      }`}
    >
      <svg className="h-5 w-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
      </svg>
      {!isPro && (
        <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-amber-400 text-[9px] font-bold text-white">
          ★
        </span>
      )}
    </Link>
  );
}


function PendingInviteModal() {
  const { pendingInvite, acceptPendingInvite, dismissPendingInvite } = useActiveProfile();
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState("");

  if (!pendingInvite) return null;

  async function handleAccept() {
    setAccepting(true);
    setError("");
    const result = await acceptPendingInvite();
    if (!result.ok) {
      setError(result.error ?? "Something went wrong");
      setAccepting(false);
    }
    // On success the modal disappears because pendingInvite becomes null
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-sm rounded-2xl bg-white shadow-xl p-6 space-y-4">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-purple-100 text-base font-bold text-purple-700">
            {pendingInvite.initiatorName[0]?.toUpperCase() ?? "?"}
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-900">
              {pendingInvite.initiatorName} invited you to link accounts
            </p>
            <p className="text-xs text-gray-400 mt-0.5">{pendingInvite.initiatorEmail}</p>
          </div>
        </div>
        <p className="text-sm text-gray-600">
          You&apos;ll be able to view each other&apos;s finances and switch between accounts from the sidebar.
        </p>
        {error && <p className="text-xs text-red-500">{error}</p>}
        <div className="flex gap-2 pt-1">
          <button
            onClick={handleAccept}
            disabled={accepting}
            className="flex-1 rounded-xl bg-purple-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-purple-700 transition disabled:opacity-50"
          >
            {accepting ? "Accepting…" : "Accept invite"}
          </button>
          <button
            onClick={dismissPendingInvite}
            disabled={accepting}
            className="rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-500 hover:bg-gray-50 transition disabled:opacity-50"
          >
            Later
          </button>
        </div>
      </div>
    </div>
  );
}

export default function SidebarLayout({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem("sidebar-collapsed");
    if (saved === "true") setCollapsed(true);
  }, []);

  function toggle() {
    setCollapsed((v) => {
      localStorage.setItem("sidebar-collapsed", String(!v));
      return !v;
    });
  }

  return (
    <ActiveProfileProvider>
      <ProfileRefreshProvider>
        <div className="min-h-screen bg-gray-50">
          <Sidebar collapsed={collapsed} onToggle={toggle} />
            <PendingInviteModal />
          <div className={`transition-all duration-200 ${collapsed ? "lg:pl-14" : "lg:pl-56"}`}>
            {children}
          </div>
          <ChatBubble />
        </div>
      </ProfileRefreshProvider>
    </ActiveProfileProvider>
  );
}
