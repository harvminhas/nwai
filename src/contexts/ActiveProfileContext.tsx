"use client";

/**
 * ActiveProfileContext
 *
 * Tracks which account is currently being viewed: own or linked partner.
 * Provides a switcher and builds the x-active-profile-uid header for API calls.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { onAuthStateChanged } from "firebase/auth";
import { getFirebaseClient } from "@/lib/firebase";
import type { LinkedPartner, PendingPartnerInvite } from "@/lib/access/types";

const STORAGE_KEY = "nwai_active_profile";

interface ActiveProfileContextValue {
  /** UID whose data is currently being viewed. */
  targetUid: string | null;
  /** True when viewing own account. */
  isOwn: boolean;
  /** Own user's uid. */
  selfUid: string | null;
  /** Own user's display name. */
  selfDisplayName: string;
  /** Linked partner, if any. */
  partner: LinkedPartner | null;
  /** Pending invite received (not yet accepted). */
  pendingInvite: PendingPartnerInvite & { inviteUrl: string } | null;
  /** Switch to viewing partner's account. */
  switchToPartner: () => void;
  /** Switch back to own account. */
  switchToSelf: () => void;
  /** Accept the pending invite — calls API and updates state. */
  acceptPendingInvite: () => Promise<{ ok: boolean; error?: string }>;
  /** Dismiss the pending invite modal without accepting. */
  dismissPendingInvite: () => void;
  /** Build headers for fetch calls — adds x-active-profile-uid when needed. */
  buildHeaders: (token: string) => Record<string, string>;
  /** True while loading partner info. */
  loadingPartner: boolean;
}

const ActiveProfileContext = createContext<ActiveProfileContextValue>({
  targetUid: null,
  isOwn: true,
  selfUid: null,
  selfDisplayName: "",
  partner: null,
  pendingInvite: null,
  switchToPartner: () => {},
  switchToSelf: () => {},
  acceptPendingInvite: async () => ({ ok: false }),
  dismissPendingInvite: () => {},
  buildHeaders: (token) => ({ Authorization: `Bearer ${token}` }),
  loadingPartner: false,
});

export function useActiveProfile(): ActiveProfileContextValue {
  return useContext(ActiveProfileContext);
}

export function ActiveProfileProvider({ children }: { children: ReactNode }) {
  const [selfUid, setSelfUid] = useState<string | null>(null);
  const [selfDisplayName, setSelfDisplayName] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [viewingPartner, setViewingPartner] = useState(false);
  const [partner, setPartner] = useState<LinkedPartner | null>(null);
  const [pendingInvite, setPendingInvite] = useState<(PendingPartnerInvite & { inviteUrl: string }) | null>(null);
  const [inviteDismissed, setInviteDismissed] = useState(false);
  const [loadingPartner, setLoadingPartner] = useState(false);

  useEffect(() => {
    const { auth } = getFirebaseClient();
    return onAuthStateChanged(auth, async (user) => {
      if (!user) {
        setSelfUid(null);
        setSelfDisplayName("");
        setToken(null);
        setViewingPartner(false);
        setPartner(null);
        setPendingInvite(null);
        return;
      }
      const tok = await user.getIdToken();
      setSelfUid(user.uid);
      setSelfDisplayName(user.displayName ?? user.email ?? "My Account");
      setToken(tok);

      // Restore viewing state
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved === "partner") setViewingPartner(true);
    });
  }, []);

  // Load partner info whenever token changes
  useEffect(() => {
    if (!token) return;
    setLoadingPartner(true);
    fetch("/api/access/grants", { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((json) => {
            setPartner(json.partner ?? null);
        setPendingInvite(json.pendingReceived ?? null);

        if (!json.partner) {
          // Partner revoked — snap back to self
          setViewingPartner(false);
          localStorage.removeItem(STORAGE_KEY);
          localStorage.removeItem(STORAGE_KEY + "_chosen");
        } else if (!localStorage.getItem(STORAGE_KEY + "_chosen")) {
          // First time this linked user opens the app — auto-show partner's data
          // since their own account is empty. Once they explicitly switch, we remember.
          setViewingPartner(true);
          localStorage.setItem(STORAGE_KEY, "partner");
          localStorage.setItem(STORAGE_KEY + "_chosen", "1");
        }
      })
      .catch(() => {})
      .finally(() => setLoadingPartner(false));
  }, [token]);

  const acceptPendingInvite = useCallback(async (): Promise<{ ok: boolean; error?: string }> => {
    if (!token || !pendingInvite) return { ok: false, error: "No invite" };
    try {
      const res = await fetch("/api/access/accept", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ token: pendingInvite.token }),
      });
      const json = await res.json();
      if (!res.ok) return { ok: false, error: json.error ?? "Failed to accept" };

      // Refresh partner info then auto-switch to their view
      const grantsRes = await fetch("/api/access/grants", { headers: { Authorization: `Bearer ${token}` } });
      const grantsJson = await grantsRes.json();
      setPartner(grantsJson.partner ?? null);
      setPendingInvite(null);
      setInviteDismissed(false);
      setViewingPartner(true);
      localStorage.setItem(STORAGE_KEY, "partner");
      localStorage.setItem(STORAGE_KEY + "_chosen", "1");
      return { ok: true };
    } catch {
      return { ok: false, error: "Something went wrong" };
    }
  }, [token, pendingInvite]);

  const dismissPendingInvite = useCallback(() => {
    setInviteDismissed(true);
  }, []);

  const switchToPartner = useCallback(() => {
    setViewingPartner(true);
    localStorage.setItem(STORAGE_KEY, "partner");
    localStorage.setItem(STORAGE_KEY + "_chosen", "1");
  }, []);

  const switchToSelf = useCallback(() => {
    setViewingPartner(false);
    localStorage.removeItem(STORAGE_KEY);
    localStorage.setItem(STORAGE_KEY + "_chosen", "1");
  }, []);

  const isOwn = !viewingPartner || !partner;

  // Keep a cookie in sync so all server-side API routes automatically see
  // the active profile UID without needing custom headers on every page.
  useEffect(() => {
    if (!isOwn && partner) {
      document.cookie = `nwai_viewing_uid=${partner.partnerUid}; path=/; SameSite=Lax`;
    } else {
      document.cookie = "nwai_viewing_uid=; path=/; SameSite=Lax; max-age=0";
    }
  }, [isOwn, partner]);

  const buildHeaders = useCallback(
    (tok: string): Record<string, string> => {
      const headers: Record<string, string> = { Authorization: `Bearer ${tok}` };
      if (!isOwn && partner) {
        headers["x-active-profile-uid"] = partner.partnerUid;
      }
      return headers;
    },
    [isOwn, partner],
  );

  const targetUid = isOwn ? selfUid : (partner?.partnerUid ?? selfUid);

  const value = useMemo<ActiveProfileContextValue>(() => ({
    targetUid,
    isOwn,
    selfUid,
    selfDisplayName,
    partner,
    pendingInvite: inviteDismissed ? null : pendingInvite,
    switchToPartner,
    switchToSelf,
    acceptPendingInvite,
    dismissPendingInvite,
    buildHeaders,
    loadingPartner,
  }), [targetUid, isOwn, selfUid, selfDisplayName, partner, pendingInvite, inviteDismissed, switchToPartner, switchToSelf, acceptPendingInvite, dismissPendingInvite, buildHeaders, loadingPartner]);

  return (
    <ActiveProfileContext.Provider value={value}>
      {children}
    </ActiveProfileContext.Provider>
  );
}
