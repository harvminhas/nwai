"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { getFirebaseClient } from "@/lib/firebase";
import type { LinkedPartner, PendingPartnerInvite } from "@/lib/access/types";

export default function SharingPage() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [partner, setPartner] = useState<LinkedPartner | null>(null);
  const [pendingSent, setPendingSent] = useState<(PendingPartnerInvite & { inviteUrl: string }) | null>(null);
  const [pendingReceived, setPendingReceived] = useState<(PendingPartnerInvite & { inviteUrl: string }) | null>(null);
  const [loading, setLoading] = useState(true);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [unlinking, setUnlinking] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async (tok: string) => {
    setLoading(true);
    try {
      const res = await fetch("/api/access/grants", { headers: { Authorization: `Bearer ${tok}` } });
      const json = await res.json();
      setPartner(json.partner ?? null);
      setPendingSent(json.pendingSent ?? null);
      setPendingReceived(json.pendingReceived ?? null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const { auth } = getFirebaseClient();
    return onAuthStateChanged(auth, async (user) => {
      if (!user) { router.push("/login"); return; }
      const tok = await user.getIdToken();
      setToken(tok);
      load(tok);
    });
  }, [router, load]);

  async function sendInvite() {
    if (!token || !inviteEmail.trim()) return;
    setSending(true);
    setError("");
    setInviteUrl(null);
    try {
      const res = await fetch("/api/access/grants", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ inviteeEmail: inviteEmail.trim() }),
      });
      const json = await res.json();
      if (!res.ok) { setError(json.error ?? "Failed to create invite"); return; }
      setInviteUrl(json.inviteUrl);
      setInviteEmail("");
      load(token);
    } catch { setError("Something went wrong"); }
    finally { setSending(false); }
  }

  async function unlink() {
    if (!token) return;
    setUnlinking(true);
    try {
      await fetch("/api/access/grants/unlink", { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
      setPartner(null);
    } finally { setUnlinking(false); }
  }

  return (
    <div className="mx-auto max-w-xl px-4 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Linked Account</h1>
        <p className="mt-1 text-sm text-gray-500">
          Link your account with a partner or spouse. You&apos;ll each be able to view each other&apos;s finances using the switcher in the sidebar.
        </p>
      </div>

      {loading ? (
        <div className="h-24 rounded-2xl border border-gray-100 bg-white animate-pulse" />
      ) : partner ? (
        /* ── Linked ─────────────────────────────────────────────────────────── */
        <div className="rounded-2xl border border-gray-200 bg-white shadow-sm p-5">
          <div className="flex items-center gap-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-purple-100 text-base font-bold text-purple-700">
              {partner.partnerName[0]?.toUpperCase() ?? "?"}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-gray-900">{partner.partnerName}</p>
              <p className="text-xs text-gray-400">{partner.partnerEmail}</p>
            </div>
            <span className="shrink-0 rounded-full bg-green-100 px-2.5 py-0.5 text-[11px] font-semibold text-green-700">
              Linked
            </span>
          </div>
          <div className="mt-4 border-t border-gray-100 pt-4">
            <button
              onClick={unlink}
              disabled={unlinking}
              className="text-xs font-medium text-red-500 hover:text-red-700 transition disabled:opacity-50"
            >
              {unlinking ? "Unlinking…" : "Unlink account"}
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* ── Pending received ──────────────────────────────────────────────── */}
          {pendingReceived && (
            <div className="rounded-2xl border border-purple-200 bg-purple-50 p-5 space-y-3">
              <p className="text-sm font-semibold text-purple-900">
                {pendingReceived.initiatorName} invited you to link accounts
              </p>
              <p className="text-xs text-purple-600">{pendingReceived.initiatorEmail}</p>
              <a
                href={pendingReceived.inviteUrl}
                className="inline-block rounded-lg bg-purple-600 px-4 py-2 text-sm font-semibold text-white hover:bg-purple-700 transition"
              >
                Accept invite →
              </a>
            </div>
          )}

          {/* ── Pending sent ─────────────────────────────────────────────────── */}
          {pendingSent && (
            <div className="rounded-2xl border border-gray-200 bg-white shadow-sm p-5 space-y-3">
              <p className="text-xs font-bold uppercase tracking-widest text-gray-400">Invite sent</p>
              <p className="text-sm text-gray-700">
                Waiting for <span className="font-semibold">{pendingSent.inviteeEmail}</span> to accept.
              </p>
              <div className="flex items-center gap-2 rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
                <code className="flex-1 truncate text-xs text-gray-500">{pendingSent.inviteUrl}</code>
                <button
                  onClick={() => navigator.clipboard.writeText(pendingSent.inviteUrl)}
                  className="shrink-0 text-xs font-semibold text-purple-600 hover:text-purple-800"
                >
                  Copy
                </button>
              </div>
            </div>
          )}

          {/* ── Invite form ───────────────────────────────────────────────────── */}
          {!pendingSent && (
            <div className="rounded-2xl border border-gray-200 bg-white shadow-sm p-5 space-y-4">
              <p className="text-xs font-bold uppercase tracking-widest text-gray-400">Invite your partner</p>
              <div className="flex gap-2">
                <input
                  type="email"
                  placeholder="their@email.com"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && sendInvite()}
                  className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-purple-400 focus:ring-1 focus:ring-purple-300"
                />
                <button
                  onClick={sendInvite}
                  disabled={sending || !inviteEmail.trim()}
                  className="shrink-0 rounded-lg bg-purple-600 px-4 py-2 text-sm font-semibold text-white hover:bg-purple-700 transition disabled:opacity-50"
                >
                  {sending ? "Sending…" : "Send invite"}
                </button>
              </div>
              {error && <p className="text-xs text-red-500">{error}</p>}
              {inviteUrl && (
                <div className="rounded-xl border border-purple-100 bg-purple-50 p-4 space-y-2">
                  <p className="text-xs font-semibold text-purple-800">Share this link with them:</p>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 truncate rounded bg-white border border-purple-100 px-3 py-1.5 text-xs text-gray-700">
                      {inviteUrl}
                    </code>
                    <button
                      onClick={() => navigator.clipboard.writeText(inviteUrl)}
                      className="shrink-0 rounded-lg border border-purple-200 px-3 py-1.5 text-xs font-semibold text-purple-700 hover:bg-purple-100 transition"
                    >
                      Copy
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
