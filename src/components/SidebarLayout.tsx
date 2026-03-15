"use client";

import { useState, useEffect } from "react";
import Sidebar from "@/components/Sidebar";

export default function SidebarLayout({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);

  // Persist preference
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
      {/* Desktop: offset content. Mobile: offset by top bar height. */}
      <div className={`transition-all duration-200 ${collapsed ? "lg:pl-14" : "lg:pl-56"}`}>
        <div className="lg:hidden h-14" />
        {children}
      </div>
    </div>
  );
}
