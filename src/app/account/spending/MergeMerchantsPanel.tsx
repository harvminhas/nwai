"use client";

import { useState, useEffect, useMemo } from "react";
import { pairKey, normaliseName } from "@/lib/sourceMappings";

export interface MerchantOption {
  name: string;
  slug: string;
  total: number;
  txCount: number;
  category: string;
  categories?: string[];
}

interface MergeCluster {
  members: MerchantOption[];
  suggestedName: string;
}

interface MergeMerchantsPanelProps {
  token: string;
  onClose: () => void;
  onMergeComplete: () => void;
  currency: string;
  /** A merchant to open straight into, e.g. the row the user clicked. */
  initialMerchant?: MerchantOption | null;
}

function formatAmount(amount: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

export function MergeMerchantsPanel({
  token,
  onClose,
  onMergeComplete,
  currency,
  initialMerchant = null,
}: MergeMerchantsPanelProps) {
  const [clusters, setClusters] = useState<MergeCluster[]>([]);
  const [allMerchants, setAllMerchants] = useState<MerchantOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [undoIds, setUndoIds] = useState<string[]>([]);
  const [undoing, setUndoing] = useState(false);

  // The group being worked on, and the name everything folds into
  const [target, setTarget] = useState<MerchantOption | null>(initialMerchant);
  const [suggestedName, setSuggestedName] = useState("");
  const [chosen, setChosen] = useState<Set<string>>(new Set());

  // Picker state
  const [search, setSearch] = useState("");

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const headers = { Authorization: `Bearer ${token}` };
        const res = await fetch("/api/user/spending/merge-suggestions?all=1", { headers });
        if (!res.ok) throw new Error("Could not load suggestions");
        const suggestions = await res.json();
        const merchantList: MerchantOption[] = (suggestions.merchants || []).map((m: any) => ({
          name: m.name,
          slug: m.slug,
          total: m.total,
          txCount: m.txCount,
          category: m.category,
          categories: m.categories,
        }));
        if (cancelled) return;

        setClusters(suggestions.clusters || []);
        setAllMerchants(merchantList);

        // Opening from a row: pick that merchant and tick everything that
        // looks like it, so one click finishes the job.
        if (initialMerchant) {
          const match =
            merchantList.find((m) => m.slug === initialMerchant.slug) ?? initialMerchant;
          setTarget(match);
          const cluster: MergeCluster | undefined = (suggestions.clusters || []).find((c: MergeCluster) =>
            c.members.some((m) => m.slug === match.slug)
          );
          if (cluster) {
            setSuggestedName(cluster.suggestedName);
            setChosen(
              new Set(cluster.members.filter((m) => m.slug !== match.slug).map((m) => m.slug))
            );
          } else {
            setSuggestedName(match.name);
            setChosen(new Set());
          }
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [token, initialMerchant]);

  const groupsForTarget = useMemo(() => {
    if (!target) return [];
    const known = new Map<string, MerchantOption>();
    for (const m of allMerchants) known.set(m.slug, m);
    for (const c of clusters) for (const m of c.members) if (!known.has(m.slug)) known.set(m.slug, m);

    const same = clusters.find((c) => c.members.some((m) => m.slug === target.slug));
    const members = same ? same.members.filter((m) => m.slug !== target.slug) : [];
    return members.filter((m) => known.has(m.slug));
  }, [target, clusters, allMerchants]);

  const searchResults = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (query.length < 2) return [];
    return allMerchants
      .filter((m) => m.slug !== target?.slug)
      .filter((m) => m.name.toLowerCase().includes(query) || m.slug.includes(query))
      .slice(0, 30);
  }, [search, allMerchants, target]);

  const chooseTarget = (merchant: MerchantOption) => {
    setTarget(merchant);
    const cluster = clusters.find((c) => c.members.some((m) => m.slug === merchant.slug));
    setSuggestedName(cluster ? cluster.suggestedName : merchant.name);
    setChosen(
      new Set(
        cluster ? cluster.members.filter((m) => m.slug !== merchant.slug).map((m) => m.slug) : []
      )
    );
    setSearch("");
    setDone(null);
  };

  const toggle = (slug: string) => {
    const next = new Set(chosen);
    if (next.has(slug)) next.delete(slug);
    else next.add(slug);
    setChosen(next);
  };

  // Re-read the suggestions and the merchant list from the server, so the panel
  // shows the world as it now is rather than its own filtered copy.
  const refreshSuggestions = async () => {
    try {
      const res = await fetch("/api/user/spending/merge-suggestions?all=1", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const json = await res.json();
      setClusters(json.clusters || []);
      setAllMerchants(
        (json.merchants || []).map((m: any) => ({
          name: m.name,
          slug: m.slug,
          total: m.total,
          txCount: m.txCount,
          category: m.category,
          categories: m.categories,
        }))
      );
    } catch {
      // Leave the current list in place if the refresh fails
    }
  };

  const undo = async () => {
    if (undoIds.length === 0 || undoing) return;
    setUndoing(true);
    setError(null);
    try {
      const res = await fetch("/api/user/source-mappings", {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ ids: undoIds }),
      });
      if (!res.ok) throw new Error("Could not undo the merge");
      setDone("Undone. Those names are separate again.");
      setUndoIds([]);
      await refreshSuggestions();
      onMergeComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not undo the merge");
    } finally {
      setUndoing(false);
    }
  };

  const save = async () => {
    if (!target || chosen.size === 0) return;
    setSaving(true);
    setError(null);
    try {
      const aliases = [...chosen]
        .map((slug) => allMerchants.find((m) => m.slug === slug) ?? groupsForTarget.find((m) => m.slug === slug))
        .filter((m): m is MerchantOption => Boolean(m));

      // The merchant being merged into needs a mapping as well whenever the
      // merge name differs from its own name. Without that it keeps the old
      // name and stays a separate row, so the merge looks like it did nothing.
      const entries: MerchantOption[] = [...aliases];
      if (normaliseName(suggestedName) !== normaliseName(target.name)) {
        entries.unshift(target);
      }

      const mappings = entries.map((entry) => ({
        pairKey: pairKey(suggestedName, entry.name),
        type: "expense" as const,
        canonical: suggestedName,
        alias: entry.name,
        status: "confirmed" as const,
        confidence: "high" as const,
        createdAt: new Date().toISOString(),
        // Name-only merge: nothing moves between categories
        affectsCache: false,
      }));

      const res = await fetch("/api/user/source-mappings", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ mappings }),
      });
      if (!res.ok) throw new Error("Could not save the merge");

      setDone(
        `Merged ${entries.length} name${entries.length === 1 ? "" : "s"} into "${suggestedName}". Category totals are unchanged.`
      );
      setChosen(new Set());
      // Back to the suggestion list, so the panel does not sit on the merchant
      // that has just been merged
      setTarget(null);
      setSearch("");

      // The API keys each mapping by its pairKey, so the same ids undo this merge
      setUndoIds(mappings.map((m) => m.pairKey.replace(/[|\/]/g, "_")));

      // Drop the group that was just merged so it is not offered again
      const mergedSlugs = new Set(aliases.map((m) => m.slug));
      mergedSlugs.add(target.slug);
      setClusters((prev) =>
        prev
          .map((c) => ({ ...c, members: c.members.filter((m) => !mergedSlugs.has(m.slug)) }))
          .filter((c) => c.members.length > 1)
      );
      refreshSuggestions();
      onMergeComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to merge");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-40 bg-neutral-900/40 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed inset-x-0 top-1/2 z-50 mx-auto flex max-h-[85vh] w-full max-w-2xl -translate-y-1/2 flex-col rounded-2xl border border-neutral-200 bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-neutral-100 px-6 py-4">
          <div>
            <h2 className="text-lg font-bold text-neutral-900">Merge merchants</h2>
            <p className="mt-0.5 text-sm text-neutral-600">
              Combine names that are the same place. Totals and categories stay as they are.
            </p>
          </div>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-neutral-500 hover:bg-neutral-100"
            aria-label="Close"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {error && (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}

          {done && (
            <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
              <span>{done}</span>
              {undoIds.length > 0 && (
                <button
                  onClick={undo}
                  disabled={undoing}
                  className="whitespace-nowrap text-xs font-semibold text-emerald-900 underline hover:no-underline disabled:opacity-50"
                >
                  {undoing ? "Undoing…" : "Undo"}
                </button>
              )}
            </div>
          )}

          {loading ? (
            <div className="flex justify-center py-10">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-purple-200 border-t-purple-600" />
            </div>
          ) : target ? (
            <>
              <div className="mb-1 flex items-center gap-2">
                <button
                  onClick={() => {
                    setTarget(null);
                    setChosen(new Set());
                    setSuggestedName("");
                    setDone(null);
                  }}
                  className="text-sm text-neutral-500 hover:text-neutral-800"
                >
                  ← All suggestions
                </button>
              </div>

              <label className="mt-3 mb-1 block text-xs font-semibold uppercase tracking-wide text-neutral-500">
                Merge into
              </label>
              <input
                value={suggestedName}
                onChange={(e) => setSuggestedName(e.target.value)}
                className="mb-1 w-full rounded-lg border border-purple-200 bg-purple-50/40 px-3 py-2 text-sm font-medium text-neutral-900 outline-none focus:border-purple-400"
              />
              <p className="mb-4 text-xs text-neutral-500">
                Keeping {target.name}, {formatAmount(target.total, currency)} across {target.txCount}{" "}
                transaction{target.txCount === 1 ? "" : "s"}.
              </p>

              <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-neutral-500">
                Fold in
              </label>
              {groupsForTarget.length === 0 ? (
                <p className="mb-4 rounded-lg bg-neutral-50 px-3 py-3 text-sm text-neutral-600">
                  Nothing else looks like this one. Search below to find a name to fold in.
                </p>
              ) : (
                <div className="mb-4 space-y-1">
                  {groupsForTarget.map((m) => (
                    <label
                      key={m.slug}
                      className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 hover:bg-neutral-50"
                    >
                      <input
                        type="checkbox"
                        checked={chosen.has(m.slug)}
                        onChange={() => toggle(m.slug)}
                        className="h-4 w-4 rounded border-neutral-300 text-purple-600"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-neutral-900">{m.name}</div>
                        <div className="text-xs text-neutral-500">
                          {m.category} · {m.txCount} transaction{m.txCount === 1 ? "" : "s"}
                        </div>
                      </div>
                      <div className="text-sm font-semibold text-neutral-900 tabular-nums">
                        {formatAmount(m.total, currency)}
                      </div>
                    </label>
                  ))}
                </div>
              )}

              <div className="rounded-lg border border-neutral-200 p-3">
                <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-neutral-500">
                  Or find another merchant
                </label>
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search all merchants…"
                  className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-purple-400"
                />
                {search.trim().length >= 2 && (
                  <div className="mt-2 max-h-52 space-y-0.5 overflow-y-auto">
                    {searchResults.length === 0 ? (
                      <p className="px-2 py-2 text-sm text-neutral-500">No merchant matches that.</p>
                    ) : (
                      searchResults.map((m) => (
                        <label
                          key={m.slug}
                          className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-neutral-50"
                        >
                          <input
                            type="checkbox"
                            checked={chosen.has(m.slug)}
                            onChange={() => toggle(m.slug)}
                            className="h-4 w-4 rounded border-neutral-300 text-purple-600"
                          />
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm text-neutral-900">{m.name}</div>
                            <div className="text-xs text-neutral-500">
                              {m.category} · {m.txCount} transaction{m.txCount === 1 ? "" : "s"}
                            </div>
                          </div>
                          <div className="text-sm text-neutral-700 tabular-nums">
                            {formatAmount(m.total, currency)}
                          </div>
                        </label>
                      ))
                    )}
                  </div>
                )}
              </div>
            </>
          ) : clusters.length === 0 ? (
            <div className="py-10 text-center">
              <p className="text-sm text-neutral-600">Nothing looks duplicated right now.</p>
              <button
                onClick={() => {
                  setTarget(null);
                  setSearch("");
                }}
                className="mt-3 text-sm font-medium text-purple-700 hover:underline"
              >
                Pick merchants to merge yourself
              </button>
              <div className="mt-4 text-left">
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search merchants…"
                  className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-purple-400"
                />
                {search.trim().length >= 2 && (
                  <div className="mt-2 max-h-64 space-y-0.5 overflow-y-auto">
                    {searchResults.map((m) => (
                      <button
                        key={m.slug}
                        onClick={() => chooseTarget(m)}
                        className="flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left hover:bg-neutral-50"
                      >
                        <span className="flex-1 truncate text-sm text-neutral-900">{m.name}</span>
                        <span className="text-xs text-neutral-500">{m.category}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <>
              <p className="mb-3 text-sm text-neutral-600">
                {clusters.length} merchant{clusters.length === 1 ? "" : "s"} look like duplicates. Pick one to review.
              </p>
              <div className="space-y-2">
                {clusters.map((cluster) => {
                  const total = cluster.members.reduce((sum, m) => sum + m.total, 0);
                  return (
                    <button
                      key={cluster.members[0].slug}
                      onClick={() => chooseTarget(cluster.members[0])}
                      className="w-full rounded-xl border border-neutral-200 p-3 text-left transition-colors hover:border-purple-300 hover:bg-purple-50/30"
                    >
                      <div className="flex items-baseline justify-between gap-3">
                        <div className="text-sm font-semibold text-neutral-900">
                          {cluster.suggestedName}
                        </div>
                        <div className="text-sm font-semibold text-neutral-900 tabular-nums">
                          {formatAmount(total, currency)}
                        </div>
                      </div>
                      <div className="mt-1 text-xs text-neutral-500">
                        {cluster.members.map((m) => m.name).join(" · ")}
                      </div>
                    </button>
                  );
                })}
              </div>

              <div className="mt-5 border-t border-neutral-100 pt-4">
                <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-neutral-500">
                  Merge something else
                </label>
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search all merchants…"
                  className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-purple-400"
                />
                {search.trim().length >= 2 && (
                  <div className="mt-2 max-h-52 space-y-0.5 overflow-y-auto">
                    {searchResults.length === 0 ? (
                      <p className="px-2 py-2 text-sm text-neutral-500">No merchant matches that.</p>
                    ) : (
                      searchResults.map((m) => (
                        <button
                          key={m.slug}
                          onClick={() => chooseTarget(m)}
                          className="flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left hover:bg-neutral-50"
                        >
                          <span className="flex-1 truncate text-sm text-neutral-900">{m.name}</span>
                          <span className="text-xs text-neutral-500">{m.category}</span>
                          <span className="text-sm text-neutral-700 tabular-nums">
                            {formatAmount(m.total, currency)}
                          </span>
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {target && (
          <div className="flex items-center justify-between border-t border-neutral-100 px-6 py-3">
            <span className="text-xs text-neutral-500">
              {chosen.size === 0
                ? "Tick the names to fold in"
                : `${chosen.size + 1} names become one`}
            </span>
            <div className="flex gap-2">
              <button
                onClick={onClose}
                className="rounded-lg border border-neutral-200 px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
              >
                Close
              </button>
              <button
                onClick={save}
                disabled={chosen.size === 0 || saving || !suggestedName.trim()}
                className="rounded-lg bg-purple-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-purple-700 disabled:cursor-not-allowed disabled:bg-neutral-300"
              >
                {saving ? "Merging…" : "Merge"}
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}