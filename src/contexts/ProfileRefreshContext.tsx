"use client";

/**
 * After a change that invalidates the financial profile (e.g. expense category rule),
 * shows RefreshToast on every /account page until the user runs a full refresh or dismisses.
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
import RefreshToast from "@/components/RefreshToast";

/** Fired on window after RefreshToast completes POST /api/user/insights/generate */
export const PROFILE_REFRESHED_EVENT = "nw:profile-refreshed";

type ProfileRefreshContextValue = {
  /** Call when a category rule (or similar) invalidates users/{uid}/financialProfile cache. */
  requestProfileRefresh: () => void;
};

const ProfileRefreshContext = createContext<ProfileRefreshContextValue>({
  requestProfileRefresh: () => {},
});

export function useProfileRefresh(): ProfileRefreshContextValue {
  return useContext(ProfileRefreshContext);
}

export function ProfileRefreshProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    const { auth } = getFirebaseClient();
    return onAuthStateChanged(auth, async (user) => {
      setToken(user ? await user.getIdToken() : null);
    });
  }, []);

  const requestProfileRefresh = useCallback(() => {
    setPending(true);
  }, []);

  const onRefreshed = useCallback(() => {
    setPending(false);
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event(PROFILE_REFRESHED_EVENT));
    }
  }, []);

  const value = useMemo(
    () => ({ requestProfileRefresh }),
    [requestProfileRefresh],
  );

  return (
    <ProfileRefreshContext.Provider value={value}>
      {children}
      {token && pending && <RefreshToast token={token} onRefreshed={onRefreshed} />}
    </ProfileRefreshContext.Provider>
  );
}
