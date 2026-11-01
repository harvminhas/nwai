/**
 * Tests for Month dropdown functionality.
 * 
 * - Lists last 12 finished months
 * - Marks incomplete months as disabled
 * - Single-month selection works through shared helpers
 */

import { describe, it, expect } from 'vitest';
import { getSelectableMonths, resolveWindowMonths } from '../lib/rangeUtils';

describe('Month dropdown', () => {
  it('lists last 12 finished months, newest first', () => {
    // Inject Nov 1, 2026 as "now"
    const now = new Date('2026-11-01T00:00:00');
    
    const accountSnapshots = [
      {
        accountType: 'checking',
        statementMonth: '2026-10',
        statementDate: '2026-10-31',
        slug: 'td-checking-1234',
      },
    ];
    
    const months = getSelectableMonths(accountSnapshots, now);
    
    // Should return 12 months
    expect(months).toHaveLength(12);
    
    // Should be newest first
    expect(months[0].yearMonth).toBe('2026-10'); // Oct 2026
    expect(months[11].yearMonth).toBe('2025-11'); // Nov 2025
    
    // Should never include current month (Nov 2026)
    expect(months.every(m => m.yearMonth !== '2026-11')).toBe(true);
  });
  
  it('marks months as incomplete when accounts are missing', () => {
    const now = new Date('2026-11-01T00:00:00');
    
    const accountSnapshots = [
      // Checking has statements through Sep
      {
        accountType: 'checking',
        statementMonth: '2026-09',
        statementDate: '2026-09-30',
        accountName: 'TD Checking',
        slug: 'td-checking-1234',
      },
      // Credit has statements through Oct
      {
        accountType: 'credit',
        statementMonth: '2026-10',
        statementDate: '2026-10-31',
        accountName: 'CIBC Visa',
        slug: 'cibc-credit-5678',
      },
    ];
    
    const months = getSelectableMonths(accountSnapshots, now);
    
    // Oct should be incomplete (checking is missing)
    const octMonth = months.find(m => m.yearMonth === '2026-10');
    expect(octMonth).toBeDefined();
    expect(octMonth?.isComplete).toBe(false);
    expect(octMonth?.missingAccounts.length).toBeGreaterThan(0);
    expect(octMonth?.missingAccounts[0]).toContain('TD Checking');
    expect(octMonth?.missingAccounts[0]).toContain('1234');
    
    // Sep should be complete (both have it)
    const sepMonth = months.find(m => m.yearMonth === '2026-09');
    expect(sepMonth).toBeDefined();
    expect(sepMonth?.isComplete).toBe(true);
    expect(sepMonth?.missingAccounts).toEqual([]);
  });
  
  it('single-month selection resolves to one month', () => {
    (globalThis as any).__TEST_NOW__ = new Date('2026-11-01T00:00:00');
    
    const monthlyHistory = [
      { yearMonth: '2026-08' },
      { yearMonth: '2026-09' },
      { yearMonth: '2026-10' },
    ];
    
    const accountSnapshots = [
      {
        accountType: 'checking',
        statementMonth: '2026-10',
        statementDate: '2026-10-31',
        slug: 'td-checking-1234',
      },
      {
        accountType: 'credit',
        statementMonth: '2026-10',
        statementDate: '2026-10-31',
        slug: 'cibc-credit-5678',
      },
    ];
    
    // Select October as single month
    const result = resolveWindowMonths('month:2026-10', monthlyHistory, accountSnapshots);
    
    // Should return exactly one month
    expect(result.months).toEqual(['2026-10']);
    expect(result.actualCount).toBe(1);
    expect(result.requestedCount).toBe(1);
    
    // Should not have missing months/accounts (single month doesn't show nudge)
    expect(result.missingMonths).toBeUndefined();
    expect(result.missingAccounts).toBeUndefined();
    
    delete (globalThis as any).__TEST_NOW__;
  });
  
  it('default view is always 3mo, not a single month', () => {
    (globalThis as any).__TEST_NOW__ = new Date('2026-11-01T00:00:00');
    
    const monthlyHistory = [
      { yearMonth: '2026-08' },
      { yearMonth: '2026-09' },
      { yearMonth: '2026-10' },
    ];
    
    const accountSnapshots = [
      {
        accountType: 'checking',
        statementMonth: '2026-10',
        statementDate: '2026-10-31',
        slug: 'td-checking-1234',
      },
      {
        accountType: 'credit',
        statementMonth: '2026-10',
        statementDate: '2026-10-31',
        slug: 'cibc-credit-5678',
      },
    ];
    
    // Default 3mo range
    const result = resolveWindowMonths('3mo', monthlyHistory, accountSnapshots);
    
    // Should return 3 months
    expect(result.months).toEqual(['2026-08', '2026-09', '2026-10']);
    expect(result.actualCount).toBe(3);
    expect(result.requestedCount).toBe(3);
    
    delete (globalThis as any).__TEST_NOW__;
  });
  
  it('formats month labels correctly', () => {
    const now = new Date('2026-11-01T00:00:00');
    
    const accountSnapshots = [
      {
        accountType: 'checking',
        statementMonth: '2026-10',
        statementDate: '2026-10-31',
        slug: 'td-checking-1234',
      },
    ];
    
    const months = getSelectableMonths(accountSnapshots, now);
    
    // Check a few month labels
    const octMonth = months.find(m => m.yearMonth === '2026-10');
    expect(octMonth?.label).toBe('Oct 2026');
    
    const decMonth = months.find(m => m.yearMonth === '2025-12');
    expect(decMonth?.label).toBe('Dec 2025');
  });
});
