/**
 * Profile refetch helper test
 */

import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { triggerProfileRefetch, PROFILE_REFRESHED_EVENT } from "../profileRefetch";

describe("triggerProfileRefetch", () => {
  let mockWindow: { dispatchEvent: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    mockWindow = { dispatchEvent: vi.fn() };
    // @ts-expect-error - mock window for testing
    global.window = mockWindow;
  });

  afterEach(() => {
    // @ts-expect-error - cleanup
    delete global.window;
  });

  test("should dispatch PROFILE_REFRESHED_EVENT when window is defined", () => {
    triggerProfileRefetch();
    
    expect(mockWindow.dispatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: PROFILE_REFRESHED_EVENT,
      })
    );
  });

  test("should not throw when window is undefined (SSR)", () => {
    // @ts-expect-error - simulate SSR
    delete global.window;
    
    expect(() => triggerProfileRefetch()).not.toThrow();
  });
});
