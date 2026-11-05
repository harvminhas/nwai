"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { getFirebaseClient } from "@/lib/firebase";
import AccountSwitcher from "@/components/AccountSwitcher";
import type { GeneralHub, ManualAsset } from "@/lib/types";

export default function HubsPage() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [hubs, setHubs] = useState<GeneralHub[]>([]);
  const [assets, setAssets] = useState<ManualAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newHubName, setNewHubName] = useState("");
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);

  const load = async (tok: string) => {
    try {
      const [hubsRes, assetsRes] = await Promise.all([
        fetch("/api/user/hubs", { headers: { Authorization: `Bearer ${tok}` } }),
        fetch("/api/user/assets", { headers: { Authorization: `Bearer ${tok}` } }),
      ]);

      if (hubsRes.ok) {
        const data = await hubsRes.json();
        setHubs(data.hubs ?? []);
      }

      if (assetsRes.ok) {
        const data = await assetsRes.json();
        setAssets(data.assets ?? []);
      }
    } catch (err) {
      console.error("Failed to load hubs:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const { auth } = getFirebaseClient();
    return onAuthStateChanged(auth, async (user) => {
      if (!user) {
        router.push("/login");
        return;
      }
      const tok = await user.getIdToken();
      setToken(tok);
      await load(tok);
    });
  }, [router]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  const createHub = async () => {
    if (!token || !newHubName.trim()) {
      setToast({ msg: "Enter a name", ok: false });
      return;
    }

    try {
      const res = await fetch("/api/user/hubs", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: newHubName.trim() }),
      });

      if (!res.ok) throw new Error("Failed to create hub");

      setToast({ msg: "Hub created", ok: true });
      setNewHubName("");
      setCreating(false);
      await load(token);
    } catch {
      setToast({ msg: "Could not create hub", ok: false });
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-purple-600 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-4 pt-4 pb-8 sm:py-8 sm:px-6">
      {toast && (
        <div
          className={`fixed bottom-6 left-1/2 z-50 -translate-x-1/2 flex items-center gap-3 rounded-xl px-5 py-3 shadow-lg text-sm font-medium ${
            toast.ok ? "bg-green-600 text-white" : "bg-red-600 text-white"
          }`}
        >
          <span>{toast.ok ? "✓" : "!"}</span>
          <span>{toast.msg}</span>
        </div>
      )}

      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Hubs & Tags</h1>
        <AccountSwitcher />
      </div>

      <p className="mb-6 text-sm text-gray-600">
        Group transactions and accounts by topic. Manual assets automatically create hubs.
      </p>

      {/* Manual asset hubs */}
      <div className="mb-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-400">
            Asset hubs
          </h2>
          <Link
            href="/account/assets"
            className="text-xs text-purple-600 hover:text-purple-700 font-medium"
          >
            Manage assets →
          </Link>
        </div>
        {assets.length > 0 ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {assets.map((asset) => (
              <Link
                key={asset.id}
                href={`/account/assets/${asset.id}`}
                className="block rounded-xl border border-gray-200 bg-white p-4 hover:border-purple-300 hover:shadow-md transition"
              >
                <p className="font-semibold text-gray-900">{asset.label}</p>
                <p className="mt-1 text-xs text-gray-500 capitalize">{asset.category}</p>
              </Link>
            ))}
          </div>
        ) : (
          <div className="rounded-xl border-2 border-dashed border-gray-200 bg-gray-50/60 p-5">
            <p className="text-sm text-gray-600">
              No manual assets yet.{" "}
              <Link href="/account/assets" className="text-purple-600 hover:underline">
                Create one
              </Link>{" "}
              to start.
            </p>
          </div>
        )}
      </div>

      {/* General hubs */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-400">
            General hubs
          </h2>
          <button
            onClick={() => setCreating(true)}
            className="rounded-lg bg-purple-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-purple-700 transition"
          >
            Create hub
          </button>
        </div>

        {creating && (
          <div className="mb-4 rounded-xl border border-purple-200 bg-purple-50 p-4">
            <div className="flex gap-2">
              <input
                value={newHubName}
                onChange={(e) => setNewHubName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && createHub()}
                placeholder="Hub name (e.g. Taxes, Vacation_Mexico)"
                className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-purple-400 focus:outline-none"
                autoFocus
              />
              <button
                onClick={createHub}
                className="rounded-lg bg-purple-600 px-4 py-2 text-sm font-semibold text-white hover:bg-purple-700 transition"
              >
                Create
              </button>
              <button
                onClick={() => {
                  setCreating(false);
                  setNewHubName("");
                }}
                className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-600 hover:text-gray-900"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {hubs.length > 0 ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {hubs.map((hub) => (
              <Link
                key={hub.id}
                href={`/account/hubs/${hub.id}`}
                className={`block rounded-xl border border-gray-200 bg-white p-4 hover:border-purple-300 hover:shadow-md transition`}
              >
                <p className="font-semibold text-gray-900">{hub.name}</p>
                <span
                  className={`mt-2 inline-block rounded-full px-2 py-0.5 text-xs font-medium bg-${hub.color}-100 text-${hub.color}-700`}
                >
                  General hub
                </span>
              </Link>
            ))}
          </div>
        ) : (
          <div className="rounded-xl border-2 border-dashed border-gray-200 bg-gray-50/60 p-5">
            <p className="text-sm text-gray-600">
              No general hubs yet. Create one to group transactions by topic.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
