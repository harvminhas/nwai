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
      // Checking: Sep 30 statement → assigned to Sep (30 ≥ 16)
      {
        accountType: 'checking',
        statementMonth: '2026-09',
        statementDate: '2026-09-30',
        accountName: 'TD Checking',
        slug: 'td-checking-1234',
      },
      // Checking: Oct 31 statement → assigned to Oct
      {
        accountType: 'checking',
        statementMonth: '2026-10',
        statementDate: '2026-10-31',
        accountName: 'TD Checking',
        slug: 'td-checking-1234',
      },
      // Credit: Oct 21 statement → assigned to Oct (21 ≥ 16)
      {
        accountType: 'credit',
        statementMonth: '2026-10',
        statementDate: '2026-10-21',
        accountName: 'CIBC Visa',
        slug: 'cibc-credit-5678',
      },
    ];
    
    const months = getSelectableMonths(accountSnapshots, now);
    
    // Oct should be complete (both accounts have statements assigned to Oct)
    const octMonth = months.find(m => m.yearMonth === '2026-10');
    expect(octMonth).toBeDefined();
    expect(octMonth?.isComplete).toBe(true);
    expect(octMonth?.missingAccounts).toEqual([]);
    
    // Sep should be incomplete (credit card is missing - Oct 21 doesn't count for Sep)
    const sepMonth = months.find(m => m.yearMonth === '2026-09');
    expect(sepMonth).toBeDefined();
    expect(sepMonth?.isComplete).toBe(false);
    expect(sepMonth?.missingAccounts.length).toBeGreaterThan(0);
    expect(sepMonth?.missingAccounts[0]).toContain('CIBC Visa');
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
      // August statements
      {
        accountType: 'checking',
        statementMonth: '2026-08',
        statementDate: '2026-08-31',
        slug: 'td-checking-1234',
      },
      {
        accountType: 'credit',
        statementMonth: '2026-08',
        statementDate: '2026-08-31',
        slug: 'cibc-credit-5678',
      },
      // September statements
      {
        accountType: 'checking',
        statementMonth: '2026-09',
        statementDate: '2026-09-30',
        slug: 'td-checking-1234',
      },
      {
        accountType: 'credit',
        statementMonth: '2026-09',
        statementDate: '2026-09-30',
        slug: 'cibc-credit-5678',
      },
      // October statements
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

  it('month selection produces different values from 3mo when data differs', () => {
    (globalThis as any).__TEST_NOW__ = new Date('2026-11-01T00:00:00');
    
    // Create history with varying data across months
    const monthlyHistory = [
      { yearMonth: '2026-08', totalSpending: 1000 },
      { yearMonth: '2026-09', totalSpending: 2000 },
      { yearMonth: '2026-10', totalSpending: 3000 },
    ];
    
    const accountSnapshots = [
      // August statement
      {
        accountType: 'checking',
        statementMonth: '2026-08',
        statementDate: '2026-08-31',
        slug: 'td-checking-1234',
      },
      // September statement
      {
        accountType: 'checking',
        statementMonth: '2026-09',
        statementDate: '2026-09-30',
        slug: 'td-checking-1234',
      },
      // October statement
      {
        accountType: 'checking',
        statementMonth: '2026-10',
        statementDate: '2026-10-31',
        slug: 'td-checking-1234',
      },
    ];
    
    // Select single month (October)
    const singleMonth = resolveWindowMonths('month:2026-10', monthlyHistory, accountSnapshots);
    
    // Select 3mo range
    const threeMonths = resolveWindowMonths('3mo', monthlyHistory, accountSnapshots);
    
    // Verify they resolve to different month sets
    expect(singleMonth.months).toEqual(['2026-10']);
    expect(threeMonths.months).toEqual(['2026-08', '2026-09', '2026-10']);
    
    // Verify counts are different
    expect(singleMonth.actualCount).toBe(1);
    expect(threeMonths.actualCount).toBe(3);
    
    // Verify they don't fall back to same value
    expect(singleMonth.months).not.toEqual(threeMonths.months);
    expect(singleMonth.actualCount).not.toEqual(threeMonths.actualCount);
    
    delete (globalThis as any).__TEST_NOW__;
  });
});
