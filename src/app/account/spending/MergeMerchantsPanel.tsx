"use client";

import { useState, useEffect } from "react";
import { pairKey, normaliseName } from "@/lib/sourceMappings";

interface MerchantMember {
  name: string;
  slug: string;
  total: number;
  txCount: number;
  category: string;
}

interface MergeCluster {
  members: MerchantMember[];
  suggestedName: string;
}

interface MergeMerchantsPanelProps {
  token: string;
  onClose: () => void;
  onMergeComplete: () => void;
  currency: string;
}

export function MergeMerchantsPanel({ token, onClose, onMergeComplete, currency }: MergeMerchantsPanelProps) {
  const [clusters, setClusters] = useState<MergeCluster[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [merging, setMerging] = useState(false);
  const [confirmation, setConfirmation] = useState<string | null>(null);

  // Per-cluster state
  const [selectedMembers, setSelectedMembers] = useState<Map<number, Set<number>>>(new Map());
  const [mergeNames, setMergeNames] = useState<Map<number, string>>(new Map());

  // Manual merge state
  const [manualSearch, setManualSearch] = useState("");
  const [manualTarget, setManualTarget] = useState<MerchantMember | null>(null);
  const [manualSelected, setManualSelected] = useState<Set<string>>(new Set());
  const [manualMergeName, setManualMergeName] = useState("");

  useEffect(() => {
    loadSuggestions();
  }, [token]);

  const loadSuggestions = async () => {
    try {
      const res = await fetch("/api/user/spending/merge-suggestions", {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) throw new Error("Failed to load suggestions");

      const data = await res.json();
      setClusters(data.clusters || []);

      // Initialize state
      const initSelected = new Map<number, Set<number>>();
      const initNames = new Map<number, string>();
      data.clusters.forEach((cluster: MergeCluster, idx: number) => {
        initSelected.set(idx, new Set(cluster.members.slice(1).map((_, i) => i + 1)));
        initNames.set(idx, cluster.suggestedName);
      });
      setSelectedMembers(initSelected);
      setMergeNames(initNames);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  };

  const handleMergeCluster = async (clusterIdx: number) => {
    const cluster = clusters[clusterIdx];
    const selected = selectedMembers.get(clusterIdx) || new Set();
    const canonicalName = mergeNames.get(clusterIdx) || cluster.suggestedName;

    if (selected.size === 0) return;

    setMerging(true);
    try {
      const canonical = cluster.members[0];
      const aliases = Array.from(selected).map(i => cluster.members[i]);

      const mappings = aliases.map(alias => ({
        pairKey: pairKey(canonicalName, alias.name),
        type: "expense",
        canonical: canonicalName,
        alias: alias.name,
        confidence: "high",
        status: "confirmed",
        createdAt: new Date().toISOString(),
        affectsCache: alias.category !== canonical.category,
      }));

      const res = await fetch("/api/user/source-mappings", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ mappings }),
      });

      if (!res.ok) throw new Error("Failed to save mappings");

      setConfirmation(`Merged ${aliases.length + 1} variants into "${canonicalName}". Category totals unchanged.`);
      setTimeout(() => {
        setConfirmation(null);
        onMergeComplete();
      }, 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to merge");
    } finally {
      setMerging(false);
    }
  };

  const handleManualMerge = async () => {
    if (!manualTarget || manualSelected.size === 0) return;

    setMerging(true);
    try {
      const canonicalName = manualMergeName || normaliseName(manualTarget.name);
      const allMerchants = clusters.flatMap(c => c.members);
      const aliases = Array.from(manualSelected)
        .map(slug => allMerchants.find(m => m.slug === slug))
        .filter((m): m is MerchantMember => m !== null);

      const mappings = aliases.map(alias => ({
        pairKey: pairKey(canonicalName, alias.name),
        type: "expense",
        canonical: canonicalName,
        alias: alias.name,
        confidence: "high",
        status: "confirmed",
        createdAt: new Date().toISOString(),
        affectsCache: alias.category !== manualTarget.category,
      }));

      const res = await fetch("/api/user/source-mappings", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ mappings }),
      });

      if (!res.ok) throw new Error("Failed to save mappings");

      setConfirmation(`Merged ${aliases.length + 1} merchants into "${canonicalName}". Category totals unchanged.`);
      setManualTarget(null);
      setManualSelected(new Set());
      setManualSearch("");
      setManualMergeName("");
      setTimeout(() => {
        setConfirmation(null);
        onMergeComplete();
      }, 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to merge");
    } finally {
      setMerging(false);
    }
  };

  const allMerchants = clusters.flatMap(c => c.members);
  const filteredManual = manualSearch.length >= 2
    ? allMerchants.filter(m => m.name.toLowerCase().includes(manualSearch.toLowerCase()))
    : [];

  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency.toUpperCase(),
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg p-6 max-w-2xl w-full mx-4">
          <div className="text-center py-8">Loading suggestions...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 overflow-y-auto p-4">
      <div className="bg-white rounded-lg max-w-3xl w-full my-8">
        <div className="p-6 border-b border-neutral-200 flex items-center justify-between sticky top-0 bg-white rounded-t-lg">
          <h2 className="text-xl font-semibold text-neutral-900">Merge merchants</h2>
          <button
            onClick={onClose}
            className="text-neutral-500 hover:text-neutral-700"
          >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-6 max-h-[70vh] overflow-y-auto">
          {confirmation && (
            <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-900">
              {confirmation}
            </div>
          )}

          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-900">
              {error}
            </div>
          )}

          {/* Suggested clusters */}
          {clusters.length > 0 ? (
            <div className="space-y-4 mb-6">
              <h3 className="text-sm font-semibold text-neutral-700 uppercase tracking-wide">
                Suggested merges
              </h3>
              {clusters.map((cluster, clusterIdx) => (
                <div key={clusterIdx} className="border border-neutral-200 rounded-lg p-4">
                  <div className="mb-3">
                    <label className="text-xs text-neutral-500 block mb-1">Merge as:</label>
                    <input
                      type="text"
                      value={mergeNames.get(clusterIdx) || ""}
                      onChange={(e) => {
                        const newNames = new Map(mergeNames);
                        newNames.set(clusterIdx, e.target.value);
                        setMergeNames(newNames);
                      }}
                      className="w-full px-3 py-2 border border-neutral-300 rounded-lg text-sm"
                    />
                  </div>

                  <div className="space-y-2 mb-3">
                    {cluster.members.map((member, memberIdx) => {
                      const isCanonical = memberIdx === 0;
                      const selected = selectedMembers.get(clusterIdx)?.has(memberIdx) || false;

                      return (
                        <div
                          key={memberIdx}
                          className="flex items-center gap-3 p-2 bg-neutral-50 rounded"
                        >
                          <input
                            type="checkbox"
                            checked={isCanonical ? true : selected}
                            disabled={isCanonical}
                            onChange={(e) => {
                              const newSelected = new Map(selectedMembers);
                              const set = new Set(newSelected.get(clusterIdx) || []);
                              if (e.target.checked) {
                                set.add(memberIdx);
                              } else {
                                set.delete(memberIdx);
                              }
                              newSelected.set(clusterIdx, set);
                              setSelectedMembers(newSelected);
                            }}
                            className="w-4 h-4"
                          />
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium text-neutral-900 truncate">
                              {member.name} {isCanonical && <span className="text-xs text-neutral-500">(target)</span>}
                            </div>
                            <div className="text-xs text-neutral-500">
                              {member.category} · {member.txCount} txn{member.txCount !== 1 ? 's' : ''}
                            </div>
                          </div>
                          <div className="text-sm font-semibold text-neutral-900 tabular-nums">
                            {formatCurrency(member.total)}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <button
                    onClick={() => handleMergeCluster(clusterIdx)}
                    disabled={merging || (selectedMembers.get(clusterIdx)?.size || 0) === 0}
                    className="w-full px-4 py-2 bg-purple-600 text-white rounded-lg text-sm font-medium hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {merging ? "Merging..." : "Confirm merge"}
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-neutral-500 text-sm mb-6">
              No similar merchants found. Use manual merge below.
            </div>
          )}

          {/* Manual merge */}
          <div className="border-t border-neutral-200 pt-6">
            <h3 className="text-sm font-semibold text-neutral-700 uppercase tracking-wide mb-3">
              Not paired up? Manual merge
            </h3>

            {!manualTarget ? (
              <div>
                <input
                  type="text"
                  placeholder="Search for target merchant..."
                  value={manualSearch}
                  onChange={(e) => setManualSearch(e.target.value)}
                  className="w-full px-3 py-2 border border-neutral-300 rounded-lg text-sm mb-2"
                />
                {filteredManual.length > 0 && (
                  <div className="border border-neutral-200 rounded-lg divide-y max-h-48 overflow-y-auto">
                    {filteredManual.slice(0, 10).map((m) => (
                      <button
                        key={m.slug}
                        onClick={() => {
                          setManualTarget(m);
                          setManualMergeName(normaliseName(m.name));
                          setManualSearch("");
                        }}
                        className="w-full p-3 hover:bg-neutral-50 text-left"
                      >
                        <div className="text-sm font-medium text-neutral-900">{m.name}</div>
                        <div className="text-xs text-neutral-500">
                          {m.category} · {formatCurrency(m.total)}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                <div className="p-3 bg-purple-50 border border-purple-200 rounded-lg">
                  <div className="text-xs text-purple-600 mb-1">Target merchant:</div>
                  <div className="text-sm font-medium text-purple-900">{manualTarget.name}</div>
                </div>

                <div>
                  <label className="text-xs text-neutral-500 block mb-1">Merge as:</label>
                  <input
                    type="text"
                    value={manualMergeName}
                    onChange={(e) => setManualMergeName(e.target.value)}
                    className="w-full px-3 py-2 border border-neutral-300 rounded-lg text-sm"
                  />
                </div>

                <div>
                  <input
                    type="text"
                    placeholder="Search for merchants to fold in..."
                    value={manualSearch}
                    onChange={(e) => setManualSearch(e.target.value)}
                    className="w-full px-3 py-2 border border-neutral-300 rounded-lg text-sm mb-2"
                  />
                  {filteredManual.length > 0 && (
                    <div className="border border-neutral-200 rounded-lg divide-y max-h-32 overflow-y-auto">
                      {filteredManual
                        .filter(m => m.slug !== manualTarget.slug)
                        .slice(0, 10)
                        .map((m) => (
                          <label
                            key={m.slug}
                            className="flex items-center gap-3 p-2 hover:bg-neutral-50 cursor-pointer"
                          >
                            <input
                              type="checkbox"
                              checked={manualSelected.has(m.slug)}
                              onChange={(e) => {
                                const newSet = new Set(manualSelected);
                                if (e.target.checked) {
                                  newSet.add(m.slug);
                                } else {
                                  newSet.delete(m.slug);
                                }
                                setManualSelected(newSet);
                              }}
                              className="w-4 h-4"
                            />
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-medium text-neutral-900 truncate">{m.name}</div>
                              <div className="text-xs text-neutral-500">{m.category}</div>
                            </div>
                          </label>
                        ))}
                    </div>
                  )}
                </div>

                {manualSelected.size > 0 && (
                  <div className="text-xs text-neutral-600">
                    {manualSelected.size} merchant{manualSelected.size !== 1 ? 's' : ''} selected
                  </div>
                )}

                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      setManualTarget(null);
                      setManualSelected(new Set());
                      setManualSearch("");
                    }}
                    className="flex-1 px-4 py-2 border border-neutral-300 text-neutral-700 rounded-lg text-sm font-medium hover:bg-neutral-50"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleManualMerge}
                    disabled={merging || manualSelected.size === 0}
                    className="flex-1 px-4 py-2 bg-purple-600 text-white rounded-lg text-sm font-medium hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {merging ? "Merging..." : "Confirm merge"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
