"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { getFirebaseClient } from "@/lib/firebase";
import { formatCurrency } from "@/lib/currencyUtils";
import { formatAccountLast4 } from "@/lib/rangeUtils";

interface Item {
  key: string;
  label: string;
  sub: string;
  amount: number | null;
  href: string;
  group: string;
  icon: "asset" | "debt";
  cur: string;
}

/**
 * Jump-to-account menu for the Accounts area. Replaces a search box with a
 * plain list of every account and manual asset, grouped like the pages.
 */
export default function AccountSwitcher() {
  const pathname = usePathname() ?? "";
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [fallbackCurrency, setFallbackCurrency] = useState("USD");
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const { auth } = getFirebaseClient();
    return onAuthStateChanged(auth, async (user) => {
      if (!user) return;
      const token = await user.getIdToken();
      const headers = { Authorization: `Bearer ${token}` };
      const [assetsRes, debtsRes] = await Promise.all([
        fetch("/api/user/assets-summary", { headers }),
        fetch("/api/user/debts-summary", { headers }),
      ]);
      const next: Item[] = [];
      if (assetsRes.ok) {
        const a = await assetsRes.json();
        setFallbackCurrency(a.currency ?? "USD");
        for (const g of a.groups ?? []) {
          for (const acc of g.accounts ?? []) {
            next.push({
              key: `acc-${acc.slug}`,
              label: acc.bankName + (acc.accountName ? ` · ${acc.accountName}` : ""),
              sub: `${g.label} · ${formatAccountLast4(acc.slug)}`,
              amount: acc.balance,
              href: `/account/accounts/${acc.slug}`,
              group: g.label,
              icon: "asset",
              cur: a.currency ?? "USD",
            });
          }
          for (const asset of g.manualAssets ?? []) {
            next.push({
              key: `man-${asset.id}`,
              label: asset.label,
              sub: `${g.label} · manual`,
              amount: asset.value,
              href: `/account/assets/${asset.id}`,
              group: g.label,
              icon: "asset",
              cur: a.currency ?? "USD",
            });
          }
        }
      }
      if (debtsRes.ok) {
        const d = await debtsRes.json();
        for (const g of d.groups ?? []) {
          for (const acc of g.accounts ?? []) {
            next.push({
              key: `debt-${acc.slug}`,
              label: acc.bankName + (acc.accountName ? ` · ${acc.accountName}` : ""),
              sub: `${g.label} · ${formatAccountLast4(acc.slug)}`,
              amount: Math.abs(acc.balance ?? 0),
              href: `/account/accounts/${acc.slug}`,
              group: g.label,
              icon: "debt",
              cur: d.currency ?? "USD",
            });
          }
        }
      }
      const seen = new Set<string>();
      setItems(next.filter((i) => (seen.has(i.href) ? false : (seen.add(i.href), true))));
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => { setOpen(false); }, [pathname]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    
    // Context-aware filtering based on current page
    let contextFiltered = items;
    if (pathname.includes("/liabilities") || pathname.includes("/debts")) {
      // On liabilities/debts pages: only show debt accounts
      contextFiltered = items.filter((i) => i.icon === "debt");
    } else if (pathname.includes("/assets")) {
      // On assets pages: only show asset accounts
      contextFiltered = items.filter((i) => i.icon === "asset");
    }
    // Elsewhere (generic accounts list, spending, etc.): show all
    
    const list = q
      ? contextFiltered.filter((i) => i.label.toLowerCase().includes(q) || i.sub.toLowerCase().includes(q))
      : contextFiltered;
    const byGroup = new Map<string, Item[]>();
    for (const i of list) {
      const arr = byGroup.get(i.group) ?? [];
      arr.push(i);
      byGroup.set(i.group, arr);
    }
    return Array.from(byGroup.entries());
  }, [items, query, pathname]);

  return (
    <div ref={boxRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:border-purple-300 hover:text-purple-700 transition"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <svg className="h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 7h18M3 12h18M3 17h18" />
        </svg>
        Accounts
        <svg className={`h-3.5 w-3.5 text-gray-400 transition-transform ${open ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 z-40 mt-2 w-80 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-xl">
          <div className="border-b border-gray-100 p-2">
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Find an account"
              className="w-full rounded-lg bg-gray-50 px-3 py-2 text-sm placeholder:text-gray-400 focus:bg-white focus:outline-none focus:ring-1 focus:ring-purple-300"
            />
          </div>
          <div className="max-h-80 overflow-y-auto py-1">
            {visible.length === 0 && (
              <p className="px-4 py-6 text-center text-sm text-gray-400">No accounts match that.</p>
            )}
            {visible.map(([group, groupItems]) => (
              <div key={group}>
                <p className="px-4 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-gray-400">{group}</p>
                {groupItems.map((item) => (
                  <Link
                    key={item.key}
                    href={item.href}
                    className="flex items-center gap-3 px-4 py-2 hover:bg-gray-50"
                  >
                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${item.icon === "debt" ? "bg-red-400" : "bg-purple-400"}`} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-gray-800">{item.label}</span>
                      <span className="block truncate text-[11px] text-gray-400">{item.sub}</span>
                    </span>
                    {item.amount !== null && (
                      <span className="shrink-0 text-xs font-medium tabular-nums text-gray-600">
                        {formatCurrency(Math.abs(item.amount), item.cur ?? fallbackCurrency)}
                      </span>
                    )}
                  </Link>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}