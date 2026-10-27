"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useActiveProfile } from "@/contexts/ActiveProfileContext";
import { fmt, fmtCompact } from "@/lib/currencyUtils";
import type { MerchantSummary } from "@/app/api/user/spending/merchants/route";

interface MerchantsTabProps {
  token: string;
}

// Simple sparkline component
function Sparkline({ data }: { data: { ym: string; total: number }[] }) {
  if (!data || data.length === 0) return null;
  
  const max = Math.max(...data.map(d => d.total));
  const min = Math.min(...data.map(d => d.total));
  const range = max - min || 1;
  
  const points = data.map((d, i) => {
    const x = (i / (data.length - 1 || 1)) * 60;
    const y = 22 - ((d.total - min) / range) * 18;
    return `${x},${y}`;
  }).join(' ');
  
  return (
    <svg width="80" height="22" viewBox="0 0 60 22" preserveAspectRatio="none" className="flex-shrink-0">
      <polyline
        points={points}
        fill="none"
        stroke="#7c3aed"
        strokeWidth="1.8"
        vectorEffect="non-scaling-stroke"
        strokeLinecap="round"
      />
    </svg>
  );
}

// Merchant row component
function MerchantRow({ 
  merchant, 
  onClick 
}: { 
  merchant: MerchantSummary; 
  onClick: () => void;
}) {
  const color = merchant.slug.charCodeAt(0) % 360;
  const initial = (merchant.displayName || merchant.name).charAt(0).toUpperCase();
  
  return (
    <button
      onClick={onClick}
      className="grid grid-cols-[48px_2fr_1.3fr_1fr_90px_130px] items-center gap-4 rounded-xl px-4 py-3 text-left transition-colors hover:bg-gray-50"
    >
      <div 
        className="flex h-9 w-9 items-center justify-center rounded-lg text-sm font-bold text-white"
        style={{ backgroundColor: `hsl(${color}, 70%, 50%)` }}
      >
        {initial}
      </div>
      
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="truncate font-semibold text-gray-900">
            {merchant.displayName || merchant.name}
          </span>
          {merchant.count > 10 && (
            <span className="rounded-full bg-purple-50 px-2 py-0.5 text-[11px] font-semibold text-purple-700">
              ↻ recurring
            </span>
          )}
        </div>
      </div>
      
      <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-700">
        {merchant.category}
      </span>
      
      <span className="text-sm text-gray-500">
        {merchant.categories[0] === "Fixed costs" ? "Fixed" : 
         merchant.categories[0] === "Essentials" ? "Essentials" :
         merchant.categories[0] === "Flexible" ? "Flexible" : "Other"}
      </span>
      
      <Sparkline data={merchant.monthly.slice(-12)} />
      
      <div className="text-right">
        <div className="text-sm font-semibold text-gray-900">
          {fmt(merchant.total, merchant.currency)}
        </div>
        <div className="text-xs text-gray-500">
          {merchant.count} {merchant.count === 1 ? 'txn' : 'txns'}
        </div>
      </div>
    </button>
  );
}

// Merchant detail drawer
function MerchantDrawer({ 
  merchant, 
  onClose,
  onMerge,
  token
}: { 
  merchant: MerchantSummary | null; 
  onClose: () => void;
  onMerge: (slug: string) => void;
  token: string;
}) {
  const [cadence, setCadence] = useState<string>("monthly");
  const [cadenceLoading, setCadenceLoading] = useState(true);
  const [savingCadence, setSavingCadence] = useState(false);
  
  useEffect(() => {
    if (!merchant || !token) return;
    
    setCadenceLoading(true);
    fetch(`/api/user/spending/merchant-cadence?slug=${encodeURIComponent(merchant.slug)}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(res => res.json())
      .then(data => {
        if (data.cadence?.frequency) {
          setCadence(data.cadence.frequency);
        }
      })
      .catch(console.error)
      .finally(() => setCadenceLoading(false));
  }, [merchant, token]);
  
  const handleCadenceChange = async (newCadence: string) => {
    if (!merchant || !token) return;
    setCadence(newCadence);
    setSavingCadence(true);
    
    try {
      await fetch('/api/user/spending/merchant-cadence', {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          slug: merchant.slug,
          frequency: newCadence,
          merchantName: merchant.displayName || merchant.name,
          amount: merchant.avgAmount,
          lastSeenDate: merchant.lastDate,
        }),
      });
    } catch (error) {
      console.error('Failed to save cadence:', error);
    } finally {
      setSavingCadence(false);
    }
  };
  
  if (!merchant) return null;
  
  const color = merchant.slug.charCodeAt(0) % 360;
  const initial = (merchant.displayName || merchant.name).charAt(0).toUpperCase();
  
  return (
    <>
      <div 
        className="fixed inset-0 z-40 bg-gray-900/40 backdrop-blur-sm"
        onClick={onClose}
      />
      <aside className="fixed right-0 top-0 bottom-0 z-50 w-full max-w-md overflow-y-auto border-l border-gray-200 bg-white shadow-2xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-200 bg-white px-6 py-4">
          <div className="flex items-center gap-3">
            <div 
              className="flex h-12 w-12 items-center justify-center rounded-xl text-lg font-bold text-white"
              style={{ backgroundColor: `hsl(${color}, 70%, 50%)` }}
            >
              {initial}
            </div>
            <div>
              <h2 className="text-lg font-bold text-gray-900">
                {merchant.displayName || merchant.name}
              </h2>
              <span className="inline-block rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                {merchant.category}
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200"
          >
            ✕
          </button>
        </div>
        
        <div className="p-6">
          <div className="grid grid-cols-3 gap-4 rounded-xl bg-gray-50 p-4">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                Avg / Month
              </div>
              <div className="mt-1 text-lg font-bold text-gray-900">
                {fmt(merchant.avgAmount, merchant.currency)}
              </div>
            </div>
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                This Year
              </div>
              <div className="mt-1 text-lg font-bold text-gray-900">
                {fmt(merchant.total, merchant.currency)}
              </div>
            </div>
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                First Seen
              </div>
              <div className="mt-1 text-sm font-semibold text-gray-900">
                {merchant.firstDate ? new Date(merchant.firstDate).toLocaleDateString('en-US', { year: 'numeric', month: 'short' }) : 'N/A'}
              </div>
            </div>
          </div>
          
          <div className="mt-6">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
              Recent Transactions
            </h3>
            <div className="mt-3 space-y-2">
              {merchant.transactions.slice(0, 10).map((txn, i) => (
                <div key={i} className="flex items-center justify-between border-b border-gray-100 pb-2">
                  <div>
                    <div className="text-sm font-medium text-gray-900">{txn.merchant}</div>
                    <div className="flex items-center gap-2 text-xs text-gray-500">
                      <span>{txn.date ? new Date(txn.date).toLocaleDateString() : txn.ym}</span>
                      {txn.accountLabel && (
                        <>
                          <span>·</span>
                          <span className="truncate max-w-[150px]" title={txn.accountLabel}>
                            {txn.accountLabel}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-semibold text-gray-900">
                      {fmt(Math.abs(txn.amount), merchant.currency)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
          
          <div className="mt-6 space-y-2">
            <div>
              <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                Billing frequency
              </label>
              <select
                value={cadence}
                onChange={(e) => handleCadenceChange(e.target.value)}
                disabled={savingCadence || cadenceLoading}
                className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm disabled:opacity-50"
              >
                <option value="weekly">Weekly</option>
                <option value="biweekly">Every 2 weeks</option>
                <option value="monthly">Monthly</option>
                <option value="quarterly">Quarterly</option>
                <option value="yearly">Yearly</option>
                <option value="oneoff">One-time</option>
              </select>
            </div>
          </div>
          
          <div className="mt-4 flex gap-2">
            <button 
              onClick={() => onMerge(merchant.slug)}
              className="flex-1 rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Merge with...
            </button>
            <button className="flex-1 rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
              Change category
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}

// Merge modal
function MergeModal({ 
  merchant, 
  similarMerchants,
  onClose,
  onConfirm
}: { 
  merchant: MerchantSummary | null;
  similarMerchants: MerchantSummary[];
  onClose: () => void;
  onConfirm: (fromSlug: string, toName: string) => void;
}) {
  const [selectedSimilar, setSelectedSimilar] = useState<MerchantSummary | null>(null);
  const [cleanName, setCleanName] = useState("");
  
  useEffect(() => {
    if (similarMerchants.length > 0 && !selectedSimilar) {
      setSelectedSimilar(similarMerchants[0]);
      setCleanName(merchant?.name || similarMerchants[0].name);
    }
  }, [similarMerchants, selectedSimilar, merchant]);
  
  if (!merchant || similarMerchants.length === 0) return null;
  
  const handleConfirm = () => {
    if (selectedSimilar && cleanName) {
      onConfirm(selectedSimilar.slug, cleanName);
    }
  };
  
  return (
    <>
      <div 
        className="fixed inset-0 z-50 bg-gray-900/40 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="fixed left-1/2 top-1/2 z-50 w-full max-w-xl -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-gray-200 bg-white p-6 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-gray-900">Merge merchants?</h2>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200"
          >
            ✕
          </button>
        </div>
        
        <p className="mb-4 text-sm text-gray-600">
          These look like the same merchant. Merging combines their history; you can undo it later.
        </p>
        
        <div className="mb-4 flex items-center gap-3">
          {similarMerchants.map((sim) => (
            <button
              key={sim.slug}
              onClick={() => {
                setSelectedSimilar(sim);
                setCleanName(sim.name);
              }}
              className={`flex-1 rounded-xl border p-4 text-left transition-colors ${
                selectedSimilar?.slug === sim.slug
                  ? 'border-purple-300 bg-purple-50'
                  : 'border-gray-200 bg-white hover:border-gray-300'
              }`}
            >
              <div className="font-semibold text-gray-900">{sim.name}</div>
              <div className="text-xs text-gray-500">
                {sim.count} transactions · since {sim.firstDate ? new Date(sim.firstDate).toLocaleDateString('en-US', { year: 'numeric', month: 'short' }) : 'N/A'}
              </div>
            </button>
          ))}
        </div>
        
        <div className="mb-4">
          <label className="mb-2 block text-sm font-semibold text-gray-700">
            Clean name
          </label>
          <input
            type="text"
            value={cleanName}
            onChange={(e) => setCleanName(e.target.value)}
            className="w-full rounded-xl border border-purple-200 bg-purple-50/30 px-4 py-2 text-sm outline-none focus:border-purple-400"
          />
        </div>
        
        <div className="mb-4 rounded-xl bg-gray-50 p-3 text-sm text-gray-700">
          Result: <span className="font-semibold">{cleanName}</span> · {merchant.count + (selectedSimilar?.count || 0)} transactions
        </div>
        
        <div className="flex justify-between">
          <span className="text-xs text-gray-500">
            {similarMerchants.length} suggestion{similarMerchants.length !== 1 ? 's' : ''}
          </span>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Skip
            </button>
            <button
              onClick={handleConfirm}
              className="rounded-xl bg-purple-600 px-4 py-2 text-sm font-semibold text-white hover:bg-purple-700"
            >
              Merge {similarMerchants.length} merchants
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

export default function MerchantsTab({ token }: MerchantsTabProps) {
  const router = useRouter();
  const { buildHeaders } = useActiveProfile();
  const [merchants, setMerchants] = useState<MerchantSummary[]>([]);
  const [filteredMerchants, setFilteredMerchants] = useState<MerchantSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selectedMerchant, setSelectedMerchant] = useState<MerchantSummary | null>(null);
  const [mergingMerchant, setMergingMerchant] = useState<MerchantSummary | null>(null);
  const [similarMerchants, setSimilarMerchants] = useState<MerchantSummary[]>([]);
  
  useEffect(() => {
    loadMerchants();
  }, [token]);
  
  useEffect(() => {
    if (search) {
      const query = search.toLowerCase();
      setFilteredMerchants(
        merchants.filter(m => 
          (m.displayName || m.name).toLowerCase().includes(query) ||
          m.category.toLowerCase().includes(query)
        )
      );
    } else {
      setFilteredMerchants(merchants);
    }
  }, [search, merchants]);
  
  const loadMerchants = async () => {
    try {
      const res = await fetch("/api/user/spending/merchants", {
        headers: buildHeaders(token),
      });
      if (res.ok) {
        const data = await res.json();
        setMerchants(data.merchants || []);
        setFilteredMerchants(data.merchants || []);
      }
    } catch (error) {
      console.error("Failed to load merchants:", error);
    } finally {
      setLoading(false);
    }
  };
  
  const handleMerchantClick = (merchant: MerchantSummary) => {
    setSelectedMerchant(merchant);
  };
  
  const handleMergeClick = async (merchantSlug: string) => {
    try {
      const res = await fetch(`/api/user/spending/merchants?slug=${merchantSlug}`, {
        headers: buildHeaders(token),
      });
      if (res.ok) {
        const data = await res.json();
        setMergingMerchant(data.merchant);
        setSimilarMerchants(data.similarMerchants || []);
        setSelectedMerchant(null);
      }
    } catch (error) {
      console.error("Failed to load similar merchants:", error);
    }
  };
  
  const handleConfirmMerge = async (fromSlug: string, toName: string) => {
    try {
      const mappings = [{
        type: "expense",
        canonical: toName,
        alias: merchants.find(m => m.slug === fromSlug)?.name || "",
        status: "confirmed",
        pairKey: `${toName}|${fromSlug}`,
        affectsCache: true,
        createdAt: new Date().toISOString(),
      }];
      
      const res = await fetch("/api/user/source-mappings", {
        method: "POST",
        headers: {
          ...buildHeaders(token),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ mappings }),
      });
      
      if (res.ok) {
        setMergingMerchant(null);
        setSimilarMerchants([]);
        await loadMerchants();
      }
    } catch (error) {
      console.error("Failed to merge merchants:", error);
    }
  };
  
  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-purple-200 border-t-purple-600" />
      </div>
    );
  }
  
  return (
    <div>
      <div className="mb-6 flex items-center gap-3">
        <div className="flex flex-1 items-center gap-2 rounded-full border border-gray-200 bg-white px-4 py-2.5 shadow-sm">
          <svg className="h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search merchants"
            className="flex-1 border-0 bg-transparent text-sm outline-none placeholder:text-gray-400"
          />
        </div>
      </div>
      
      <div className="rounded-2xl border border-gray-200 bg-white p-2 shadow-sm">
        <div className="grid grid-cols-[48px_2fr_1.3fr_1fr_90px_130px] gap-4 border-b border-gray-100 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-gray-500">
          <span></span>
          <span>Merchant</span>
          <span>Category</span>
          <span>Bucket</span>
          <span className="text-right">Trend</span>
          <span className="text-right">Last 12 Months</span>
        </div>
        
        <div className="divide-y divide-gray-50">
          {filteredMerchants.map((merchant) => (
            <MerchantRow
              key={merchant.slug}
              merchant={merchant}
              onClick={() => handleMerchantClick(merchant)}
            />
          ))}
        </div>
        
        {filteredMerchants.length === 0 && (
          <div className="py-12 text-center text-sm text-gray-500">
            No merchants found
          </div>
        )}
      </div>
      
      {selectedMerchant && (
        <MerchantDrawer
          merchant={selectedMerchant}
          onClose={() => setSelectedMerchant(null)}
          onMerge={handleMergeClick}
          token={token}
        />
      )}
      
      {mergingMerchant && similarMerchants.length > 0 && (
        <MergeModal
          merchant={mergingMerchant}
          similarMerchants={similarMerchants}
          onClose={() => {
            setMergingMerchant(null);
            setSimilarMerchants([]);
          }}
          onConfirm={handleConfirmMerge}
        />
      )}
    </div>
  );
}
