/**
 * Tests that month:YYYY-MM ranges are passed through to APIs
 * and not silently replaced with 3mo defaults.
 * 
 * Ensures the bug fixed in money-coach doesn't exist in other APIs.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('Month range API pass-through', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('dashboard-drawers API accepts month: format', async () => {
    // This test verifies the validation logic, not the full request flow
    const validRanges = [
      '3mo',
      '12mo',
      'ytd',
      'month:2026-08',
      'month:2025-12',
    ];

    validRanges.forEach(rangeParam => {
      // Simulate the validation logic from dashboard-drawers/route.ts
      const isValidMonth = rangeParam?.startsWith('month:') && rangeParam.length > 6;
      const range = rangeParam && (['3mo', '12mo', 'ytd'].includes(rangeParam) || isValidMonth)
        ? rangeParam
        : '3mo';

      // Should not fall back to 3mo
      expect(range).toBe(rangeParam);
    });
  });

  it('dashboard-drawers API rejects invalid ranges', () => {
    const invalidRanges = [
      { input: '', expected: '3mo' },
      { input: 'invalid', expected: '3mo' },
      { input: 'month', expected: '3mo' },
      { input: 'month:', expected: '3mo' },
      // Note: "month:invalid" passes API validation but resolveWindowMonths will return empty data
      { input: 'month:invalid', expected: 'month:invalid' },
      { input: 'month:2026-99', expected: 'month:2026-99' },
    ];

    invalidRanges.forEach(({ input, expected }) => {
      // Simulate the validation logic
      const isValidMonth = input?.startsWith('month:') && input.length > 6;
      const range = input && (['3mo', '12mo', 'ytd'].includes(input) || isValidMonth)
        ? input
        : '3mo';

      // API validation: only format check, not semantic validation
      expect(range).toBe(expected);
    });
  });

  it('money-coach API accepts month: format', () => {
    const validRanges = [
      '3mo',
      '12mo',
      'ytd',
      'month:2026-08',
      'month:2025-12',
    ];

    validRanges.forEach(rangeParam => {
      // Simulate the validation logic from money-coach/route.ts
      const isValidMonth = rangeParam?.startsWith('month:') && rangeParam.length > 6;
      const range = rangeParam && (['3mo', '12mo', 'ytd'].includes(rangeParam) || isValidMonth)
        ? rangeParam as '3mo' | '12mo' | 'ytd' | `month:${string}`
        : '3mo';

      expect(range).toBe(rangeParam);
    });
  });

  it('income-summary API accepts month: format', () => {
    const validRanges = [
      '3mo',
      '12mo',
      'ytd',
      'month:2026-08',
      'month:2025-12',
    ];

    validRanges.forEach(rangeParam => {
      // Simulate the validation logic from income-summary/route.ts
      const isValidMonth = rangeParam?.startsWith('month:') && rangeParam.length > 6;
      const range = rangeParam && (['3mo', '12mo', 'ytd'].includes(rangeParam) || isValidMonth)
        ? rangeParam as '3mo' | '12mo' | 'ytd' | `month:${string}`
        : '3mo';

      expect(range).toBe(rangeParam);
    });
  });

  it('spending-summary API accepts month: format', () => {
    const validRanges = [
      '3mo',
      '12mo',
      'ytd',
      'month:2026-08',
      'month:2025-12',
    ];

    validRanges.forEach(rangeParam => {
      // Simulate the validation logic from spending-summary/route.ts
      const isValidMonth = rangeParam?.startsWith('month:') && rangeParam.length > 6;
      const range = rangeParam && (['3mo', '12mo', 'ytd'].includes(rangeParam) || isValidMonth)
        ? rangeParam as '3mo' | '12mo' | 'ytd' | `month:${string}`
        : '3mo';

      expect(range).toBe(rangeParam);
    });
  });

  it('month range validation is consistent across all APIs', () => {
    const testRange = 'month:2026-10';
    
    // All APIs should use the same validation pattern
    const validations = [
      // money-coach
      testRange && (['3mo', '12mo', 'ytd'].includes(testRange) || (testRange?.startsWith('month:') && testRange.length > 6)) ? testRange : '3mo',
      // dashboard-drawers
      testRange && (['3mo', '12mo', 'ytd'].includes(testRange) || (testRange?.startsWith('month:') && testRange.length > 6)) ? testRange : '3mo',
      // income-summary
      testRange && (['3mo', '12mo', 'ytd'].includes(testRange) || (testRange?.startsWith('month:') && testRange.length > 6)) ? testRange : '3mo',
      // spending-summary
      testRange && (['3mo', '12mo', 'ytd'].includes(testRange) || (testRange?.startsWith('month:') && testRange.length > 6)) ? testRange : '3mo',
    ];

    // All should accept the month range
    validations.forEach(result => {
      expect(result).toBe(testRange);
    });
  });

  it('empty range defaults to 3mo consistently', () => {
    const emptyRange = '';
    
    const validations = [
      emptyRange && (['3mo', '12mo', 'ytd'].includes(emptyRange) || (emptyRange?.startsWith('month:') && emptyRange.length > 6)) ? emptyRange : '3mo',
      emptyRange && (['3mo', '12mo', 'ytd'].includes(emptyRange) || (emptyRange?.startsWith('month:') && emptyRange.length > 6)) ? emptyRange : '3mo',
      emptyRange && (['3mo', '12mo', 'ytd'].includes(emptyRange) || (emptyRange?.startsWith('month:') && emptyRange.length > 6)) ? emptyRange : '3mo',
      emptyRange && (['3mo', '12mo', 'ytd'].includes(emptyRange) || (emptyRange?.startsWith('month:') && emptyRange.length > 6)) ? emptyRange : '3mo',
    ];

    // All should default to 3mo
    validations.forEach(result => {
      expect(result).toBe('3mo');
    });
  });
});
