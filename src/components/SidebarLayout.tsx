"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import { usePlan } from "@/contexts/PlanContext";

function ChatBubble() {
  const { can } = usePlan();
  const pathname = usePathname();
  // Hide on the chat page itself
  if (pathname === "/account/chat") return null;
  // Only show for Pro users
  if (!can("aiChat")) return null;

  return (
    <Link
      href="/account/chat"
      title="AI Financial Chat"
      className="fixed bottom-5 right-5 z-50 flex h-12 w-12 items-center justify-center rounded-full bg-purple-600 shadow-lg ring-2 ring-white hover:bg-purple-700 transition-transform hover:scale-105 active:scale-95"
    >
      <svg className="h-5 w-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
      </svg>
    </Link>
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
    <div className="min-h-screen bg-gray-50">
      <Sidebar collapsed={collapsed} onToggle={toggle} />
      <div className={`transition-all duration-200 ${collapsed ? "lg:pl-14" : "lg:pl-56"}`}>
        {children}
      </div>
      <ChatBubble />
    </div>
  );
}
