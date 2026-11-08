/**
 * @vitest-environment jsdom
 */

import { describe, it, expect } from "vitest";
import {
  PREVIEW_MUTATION_BLOCKED,
  installPreviewMutationGuard,
  isBlockedPreviewMutation,
} from "../previewIsolation";

describe("preview mutation guard", () => {
  it("blocks writes to /api/user/* and allows reads", () => {
    expect(isBlockedPreviewMutation("/api/user/assets", { method: "POST" })).toBe(true);
    expect(isBlockedPreviewMutation("/api/user/reviews", { method: "PUT" })).toBe(true);
    expect(isBlockedPreviewMutation("/api/user/reviews?id=1", { method: "DELETE" })).toBe(true);
    expect(isBlockedPreviewMutation("/api/user/assets-summary", { method: "GET" })).toBe(false);
    expect(isBlockedPreviewMutation("/_next/static/chunk.js", { method: "GET" })).toBe(false);
  });

  it("rejects live fetch writes while installed and restores afterward", async () => {
    const orig = window.fetch;
    const restore = installPreviewMutationGuard();
    await expect(fetch("/api/user/assets", { method: "POST" })).rejects.toThrow(PREVIEW_MUTATION_BLOCKED);
    restore();
    expect(window.fetch).toBe(orig);
  });
});
