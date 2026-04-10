"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { getFirebaseClient } from "@/lib/firebase";
import type { LinkedPartner, PendingPartnerInvite } from "@/lib/access/types";

export default function SharingPage() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [canView, setCanView] = useState<LinkedPartner | null>(null);
  const [sharedWith, setSharedWith] = useState<LinkedPartner | null>(null);
  const [pendingSent, setPendingSent] = useState<(PendingPartnerInvite & { inviteUrl: string }) | null>(null);
  const [pendingReceived, setPendingReceived] = useState<(PendingPartnerInvite & { inviteUrl: string }) | null>(null);
  const [loading, setLoading] = useState(true);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [mutualConsent, setMutualConsent] = useState(false);
  const [unlinking, setUnlinking] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const load = useCallback(async (tok: string) => {
    setLoading(true);
    try {
      const res = await fetch("/api/access/grants", { headers: { Authorization: `Bearer ${tok}` } });
      const json = await res.json();
      setCanView(json.canView ?? null);
      setSharedWith(json.sharedWith ?? null);
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

  function copyLink(url: string) {
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function shareLink(url: string, email: string) {
    if (navigator.share) {
      navigator.share({ title: "View my finances on networth.online", url }).catch(() => {});
    } else {
      copyLink(url);
    }
  }

  async function unlink() {
    if (!token) return;
    setUnlinking(true);
    try {
      await fetch("/api/access/grants/unlink", { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
      setPartner(null);
    } finally { setUnlinking(false); }
  }

  const hasAnyLink = canView || sharedWith;

  return (
    <div className="mx-auto max-w-xl px-4 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Account Sharing</h1>
        <p className="mt-1 text-sm text-gray-500">
          Share your finances with a partner or spouse. Sharing is one-directional — each person
          explicitly chooses what they share. Pro plan required to share your data.
        </p>
      </div>

      {loading ? (
        <div className="h-24 rounded-2xl border border-gray-100 bg-white animate-pulse" />
      ) : (
        <div className="space-y-4">

          {/* ── You are viewing ───────────────────────────────────────────────── */}
          <div className="rounded-2xl border border-gray-200 bg-white shadow-sm p-5">
            <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-3">You can view</p>
            {canView ? (
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-purple-100 text-sm font-bold text-purple-700">
                  {canView.partnerName[0]?.toUpperCase() ?? "?"}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900">{canView.partnerName}</p>
                  <p className="text-xs text-gray-400">{canView.partnerEmail}</p>
                </div>
                <span className="shrink-0 rounded-full bg-green-100 px-2.5 py-0.5 text-[11px] font-semibold text-green-700">Active</span>
              </div>
            ) : (
              <p className="text-sm text-gray-400 italic">
                No one has shared their finances with you yet.
              </p>
            )}
          </div>

          {/* ── You are sharing ───────────────────────────────────────────────── */}
          <div className="rounded-2xl border border-gray-200 bg-white shadow-sm p-5">
            <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-3">You are sharing your data with</p>
            {sharedWith ? (
              /* ── Active share ───────────────────────────────────────────────── */
              <>
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-purple-100 text-sm font-bold text-purple-700">
                    {sharedWith.partnerName[0]?.toUpperCase() ?? "?"}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-900">{sharedWith.partnerName}</p>
                    <p className="text-xs text-gray-400">{sharedWith.partnerEmail}</p>
                  </div>
                  <span className="shrink-0 rounded-full bg-green-100 px-2.5 py-0.5 text-[11px] font-semibold text-green-700">Active</span>
                </div>
                <div className="mt-4 border-t border-gray-100 pt-3">
                  <button onClick={unlink} disabled={unlinking}
                    className="text-xs font-medium text-red-500 hover:text-red-700 transition disabled:opacity-50">
                    {unlinking ? "Unlinking…" : "Stop sharing & unlink"}
                  </button>
                </div>
              </>
            ) : pendingSent || inviteUrl ? (
              /* ── Pending — link is the hero ─────────────────────────────────── */
              (() => {
                const url   = inviteUrl ?? pendingSent!.inviteUrl;
                const email = pendingSent?.inviteeEmail ?? "";
                return (
                  <div className="space-y-4">
                    <div className="flex items-center gap-2">
                      <div className="flex h-2 w-2 shrink-0 rounded-full bg-amber-400 animate-pulse" />
                      <p className="text-sm text-gray-600">
                        Waiting for{email ? <> <strong>{email}</strong> to</> : " them to"} accept
                      </p>
                    </div>

                    {/* Big link card */}
                    <div className="rounded-xl border-2 border-purple-200 bg-purple-50 p-4 space-y-3">
                      <p className="text-xs font-semibold text-purple-800">
                        📎 Send this link directly to {email || "them"} — via text, WhatsApp, or however you prefer.
                        The link only works for the right person.
                      </p>
                      <div className="flex items-center gap-2 rounded-lg border border-purple-100 bg-white px-3 py-2.5">
                        <code className="flex-1 truncate text-xs text-gray-600 select-all">{url}</code>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => copyLink(url)}
                          className="flex-1 flex items-center justify-center gap-1.5 rounded-lg bg-purple-600 px-3 py-2 text-xs font-semibold text-white hover:bg-purple-700 transition"
                        >
                          {copied ? (
                            <>
                              <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
                              Copied!
                            </>
                          ) : (
                            <>
                              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                              Copy link
                            </>
                          )}
                        </button>
                        <button
                          onClick={() => shareLink(url, email)}
                          className="flex items-center justify-center gap-1.5 rounded-lg border border-purple-200 px-3 py-2 text-xs font-semibold text-purple-700 hover:bg-purple-100 transition"
                        >
                          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" /></svg>
                          Share
                        </button>
                      </div>
                    </div>

                    <button
                      onClick={() => { setInviteUrl(null); load(token!); }}
                      className="text-xs text-gray-400 hover:text-gray-600 transition"
                    >
                      Cancel invite
                    </button>
                  </div>
                );
              })()
            ) : (
              /* ── Invite form ────────────────────────────────────────────────── */
              <div className="space-y-4">
                <p className="text-sm text-gray-500">
                  Generate a link and send it directly to the person you want to share with.
                </p>

                <div className="rounded-xl bg-gray-50 border border-gray-100 p-3 space-y-1.5">
                  <p className="text-xs font-semibold text-gray-700">When they accept:</p>
                  {[
                    "They will see your full financial data",
                    "You will NOT automatically see theirs — they choose separately",
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

                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Their email address</label>
                  <input
                    type="email"
                    placeholder="their@email.com"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && mutualConsent && sendInvite()}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-purple-400 focus:ring-1 focus:ring-purple-300"
                  />
                  <p className="mt-1 text-[11px] text-gray-400">Used to identify them when they log in — the link is what you share.</p>
                </div>

                <label className="flex items-start gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={mutualConsent}
                    onChange={(e) => setMutualConsent(e.target.checked)}
                    className="mt-0.5 h-4 w-4 shrink-0 rounded border-gray-300 accent-purple-600"
                  />
                  <span className="text-xs text-gray-600 leading-relaxed">
                    I understand they will see <strong>my</strong> full financial data.
                  </span>
                </label>

                <button
                  onClick={sendInvite}
                  disabled={sending || !inviteEmail.trim() || !mutualConsent}
                  className="w-full rounded-lg bg-purple-600 px-4 py-2 text-sm font-semibold text-white hover:bg-purple-700 transition disabled:opacity-50"
                >
                  {sending ? "Generating…" : "Generate invite link"}
                </button>

                {error && <p className="text-xs text-red-500">{error}</p>}
              </div>
            )}
          </div>

          {/* ── Pending received ──────────────────────────────────────────────── */}
          {pendingReceived && !canView && (
            <div className="rounded-2xl border border-purple-200 bg-purple-50 p-5 space-y-3">
              <p className="text-sm font-semibold text-purple-900">
                {pendingReceived.initiatorName} wants to share their finances with you
              </p>
              <p className="text-xs text-purple-600">
                You&apos;ll be able to view {pendingReceived.initiatorName}&apos;s data. They will NOT see yours unless you also invite them.
              </p>
              <a
                href={pendingReceived.inviteUrl}
                className="inline-block rounded-lg bg-purple-600 px-4 py-2 text-sm font-semibold text-white hover:bg-purple-700 transition"
              >
                Review &amp; Accept →
              </a>
            </div>
          )}

          {/* Unlink all button when any link exists but no sharedWith (can only unlink canView) */}
          {canView && !sharedWith && (
            <div className="text-right">
              <button
                onClick={unlink}
                disabled={unlinking}
                className="text-xs font-medium text-red-400 hover:text-red-600 transition disabled:opacity-50"
              >
                {unlinking ? "Unlinking…" : "Stop viewing & unlink"}
              </button>
            </div>
          )}

        </div>
      )}
    </div>
  );
}
