"use client";

import { createContext, useContext, useEffect, type ReactNode } from "react";

const PreviewIsolationContext = createContext(false);

export function usePreviewIsolation(): boolean {
  return useContext(PreviewIsolationContext);
}

export const PREVIEW_MUTATION_BLOCKED = "Preview isolation: financial mutations are disabled";

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function requestMethod(input: RequestInfo | URL, init?: RequestInit): string {
  const fromInit = init?.method;
  const fromRequest = typeof Request !== "undefined" && input instanceof Request ? input.method : undefined;
  return (fromInit || fromRequest || "GET").toUpperCase();
}

export function isBlockedPreviewMutation(input: RequestInfo | URL, init?: RequestInit): boolean {
  const url = requestUrl(input);
  const method = requestMethod(input, init);
  if (!url.includes("/api/user/")) return false;
  return method !== "GET" && method !== "HEAD" && method !== "OPTIONS";
}

/**
 * Last-line guard for the synthetic harness: reject writes to /api/user/*
 * even if a production control is mounted by mistake. Restored on unmount
 * so navigating to the real app restores live fetch.
 */
export function installPreviewMutationGuard(): () => void {
  const orig = window.fetch;
  window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    if (isBlockedPreviewMutation(input, init)) {
      return Promise.reject(new Error(PREVIEW_MUTATION_BLOCKED));
    }
    return orig.call(window, input as RequestInfo, init);
  }) as typeof fetch;
  return () => {
    window.fetch = orig;
  };
}

export function PreviewIsolationProvider({ children }: { children: ReactNode }) {
  useEffect(() => installPreviewMutationGuard(), []);
  return (
    <PreviewIsolationContext.Provider value={true}>
      {children}
    </PreviewIsolationContext.Provider>
  );
}
