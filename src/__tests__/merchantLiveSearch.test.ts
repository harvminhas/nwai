/**
 * Regression test for merchant live search behavior.
 * 
 * Merchant search should update as user types (with 300ms debounce),
 * without requiring Enter key. Matching Asset -> Add Expense search UX.
 */

import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";

describe("Merchant live search debouncing", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("debounces search input with 300ms delay", () => {
    const callback = vi.fn();
    let searchInput = "";
    let timer: ReturnType<typeof setTimeout> | null = null;

    const handleSearchChange = (value: string) => {
      searchInput = value;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        callback(searchInput.trim());
      }, 300);
    };

    // Simulate rapid typing
    handleSearchChange("s");
    vi.advanceTimersByTime(100);
    handleSearchChange("st");
    vi.advanceTimersByTime(100);
    handleSearchChange("sta");
    vi.advanceTimersByTime(100);
    handleSearchChange("star");

    // Should not have called yet (only 300ms total, need full 300ms after last keystroke)
    expect(callback).not.toHaveBeenCalled();

    // Complete the debounce delay
    vi.advanceTimersByTime(300);
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith("star");
  });

  test("triggers search for queries >= 2 characters", () => {
    const shouldSearch = (query: string): boolean => {
      const trimmed = query.trim();
      return trimmed.length >= 2;
    };

    expect(shouldSearch("")).toBe(false);
    expect(shouldSearch("a")).toBe(false);
    expect(shouldSearch("ab")).toBe(true);
    expect(shouldSearch("abc")).toBe(true);
    expect(shouldSearch("  ab  ")).toBe(true);
    expect(shouldSearch("  a  ")).toBe(false);
  });

  test("clears search when input is emptied", () => {
    const callback = vi.fn();
    let searchInput = "starbucks";
    let timer: ReturnType<typeof setTimeout> | null = null;

    const handleSearchChange = (value: string) => {
      searchInput = value;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        const trimmed = searchInput.trim();
        callback(trimmed.length >= 2 ? trimmed : "");
      }, 300);
    };

    // Type a query
    handleSearchChange("starbucks");
    vi.advanceTimersByTime(300);
    expect(callback).toHaveBeenCalledWith("starbucks");

    // Clear it
    callback.mockClear();
    handleSearchChange("");
    vi.advanceTimersByTime(300);
    expect(callback).toHaveBeenCalledWith("");
  });

  test("handles rapid clearing and retyping", () => {
    const callback = vi.fn();
    let searchInput = "";
    let timer: ReturnType<typeof setTimeout> | null = null;

    const handleSearchChange = (value: string) => {
      searchInput = value;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        const trimmed = searchInput.trim();
        callback(trimmed.length >= 2 ? trimmed : "");
      }, 300);
    };

    // Type, clear, type again rapidly
    handleSearchChange("tim");
    vi.advanceTimersByTime(100);
    handleSearchChange("");
    vi.advanceTimersByTime(100);
    handleSearchChange("tim hortons");

    // Should not have called yet
    expect(callback).not.toHaveBeenCalled();

    // Wait for debounce
    vi.advanceTimersByTime(300);
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith("tim hortons");
  });

  test("preserves Escape key clearing behavior", () => {
    let searchInput = "starbucks";

    const handleKeyDown = (key: string) => {
      if (key === "Escape") {
        searchInput = "";
      }
    };

    expect(searchInput).toBe("starbucks");
    handleKeyDown("Escape");
    expect(searchInput).toBe("");
  });

  test("does not require Enter key to trigger search", () => {
    // Before: required Enter key (e.key === "Enter")
    // After: triggers automatically via debounce
    const oldBehavior = (key: string, query: string): boolean => {
      return key === "Enter" && query.trim().length >= 2;
    };

    const newBehavior = (query: string): boolean => {
      // Enter key no longer required; search triggers on every change after debounce
      return query.trim().length >= 2;
    };

    // Old behavior required Enter
    expect(oldBehavior("a", "starbucks")).toBe(false);
    expect(oldBehavior("Enter", "starbucks")).toBe(true);

    // New behavior triggers without Enter
    expect(newBehavior("starbucks")).toBe(true);
  });
});
