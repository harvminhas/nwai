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
  const [mutualConsent, setMutualConsent] = useState(false);
  const [error, setError] = useState("");

  if (!pendingInvite) return null;

  async function handleAccept() {
    if (!mutualConsent) return;
    setAccepting(true);
    setError("");
    const result = await acceptPendingInvite();
    if (!result.ok) {
      setError(result.error ?? "Something went wrong");
      setAccepting(false);
    }
    // On success pendingInvite becomes null and modal disappears
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
              {pendingInvite.initiatorName} wants to share finances with you
            </p>
            <p className="text-xs text-gray-400 mt-0.5">{pendingInvite.initiatorEmail}</p>
          </div>
        </div>

        {/* What this means */}
        <div className="rounded-xl bg-gray-50 border border-gray-100 p-3 space-y-1.5">
          <p className="text-xs font-semibold text-gray-700">By accepting:</p>
          {[
            `You will see ${pendingInvite.initiatorName}'s full financial data`,
            `${pendingInvite.initiatorName} will NOT see your data unless you also invite them`,
            "Either of you can unlink at any time",
          ].map((line) => (
            <div key={line} className="flex items-start gap-2 text-xs text-gray-600">
              <svg className="mt-0.5 h-3.5 w-3.5 shrink-0 text-purple-500" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
              </svg>
              <span>{line}</span>
            </div>
          ))}
        </div>

        {/* Consent checkbox */}
        <label className="flex items-start gap-2.5 cursor-pointer">
          <input
            type="checkbox"
            checked={mutualConsent}
            onChange={(e) => setMutualConsent(e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 rounded border-gray-300 accent-purple-600"
          />
          <span className="text-xs text-gray-600 leading-relaxed">
            I understand I will see <strong>{pendingInvite.initiatorName}</strong>&apos;s finances. They will not see mine.
          </span>
        </label>

        {error && <p className="text-xs text-red-500">{error}</p>}
        <div className="flex gap-2">
          <button
            onClick={handleAccept}
            disabled={accepting || !mutualConsent}
            className="flex-1 rounded-xl bg-purple-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-purple-700 transition disabled:opacity-40"
          >
            {accepting ? "Accepting…" : "Accept & Share"}
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
