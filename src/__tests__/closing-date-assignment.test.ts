/**
 * Tests for closing date assignment rule.
 * 
 * Rule: Statement closing day ≤15 = previous month, ≥16 = current month
 * 
 * Examples:
 * - Oct 21 → October
 * - Nov 3 → October (3 ≤ 15, so previous month)
 * - Oct 31 → October
 * - Oct 15 → September (15 ≤ 15, so previous month)
 * - Oct 16 → October (16 ≥ 16, so current month)
 */

import { describe, it, expect } from 'vitest';
import { getSelectableMonths, getLatestCompleteMonth, resolveWindowMonths } from '../lib/rangeUtils';

describe('Closing date assignment rule', () => {
  it('statement closing on 15th counts for previous month', () => {
    const now = new Date('2026-12-01T00:00:00');
    
    const accountSnapshots = [
      {
        accountType: 'credit',
        statementMonth: '2026-10',
        statementDate: '2026-10-15', // 15th = previous month (Sep)
        accountName: 'Amex',
        slug: 'amex-credit-1234',
      },
    ];
    
    const months = getSelectableMonths(accountSnapshots, now);
    
    // October should be incomplete (statement on 15th counts for Sep)
    const octMonth = months.find(m => m.yearMonth === '2026-10');
    expect(octMonth?.isComplete).toBe(false);
    expect(octMonth?.missingAccounts.length).toBeGreaterThan(0);
    
    // September should be complete (statement on 15th counts for Sep)
    const sepMonth = months.find(m => m.yearMonth === '2026-09');
    expect(sepMonth?.isComplete).toBe(true);
  });
  
  it('statement closing on 16th counts for current month', () => {
    const now = new Date('2026-12-01T00:00:00');
    
    const accountSnapshots = [
      {
        accountType: 'credit',
        statementMonth: '2026-10',
        statementDate: '2026-10-16', // 16th = current month (Oct)
        accountName: 'Amex',
        slug: 'amex-credit-1234',
      },
    ];
    
    const months = getSelectableMonths(accountSnapshots, now);
    
    // October should be complete (statement on 16th counts for Oct)
    const octMonth = months.find(m => m.yearMonth === '2026-10');
    expect(octMonth?.isComplete).toBe(true);
    expect(octMonth?.missingAccounts).toEqual([]);
    
    // September should be incomplete (no statement counts for Sep)
    const sepMonth = months.find(m => m.yearMonth === '2026-09');
    expect(sepMonth?.isComplete).toBe(false);
  });
  
  it('statement closing on 3rd counts for previous month', () => {
    // Nov 3 → October (3 ≤ 15)
    const now = new Date('2026-12-01T00:00:00');
    
    const accountSnapshots = [
      {
        accountType: 'credit',
        statementMonth: '2026-11',
        statementDate: '2026-11-03', // 3rd = previous month (Oct)
        accountName: 'Chase',
        slug: 'chase-credit-5678',
      },
    ];
    
    const months = getSelectableMonths(accountSnapshots, now);
    
    // November should be incomplete (statement on 3rd counts for Oct)
    const novMonth = months.find(m => m.yearMonth === '2026-11');
    expect(novMonth?.isComplete).toBe(false);
    
    // October should be complete (statement on 3rd counts for Oct)
    const octMonth = months.find(m => m.yearMonth === '2026-10');
    expect(octMonth?.isComplete).toBe(true);
  });
  
  it('statement closing on 21st counts for current month', () => {
    // Oct 21 → October (21 ≥ 16)
    const now = new Date('2026-12-01T00:00:00');
    
    const accountSnapshots = [
      {
        accountType: 'credit',
        statementMonth: '2026-10',
        statementDate: '2026-10-21', // 21st = current month (Oct)
        accountName: 'Amex',
        slug: 'amex-credit-1234',
      },
    ];
    
    const months = getSelectableMonths(accountSnapshots, now);
    
    // October should be complete (statement on 21st counts for Oct)
    const octMonth = months.find(m => m.yearMonth === '2026-10');
    expect(octMonth?.isComplete).toBe(true);
    expect(octMonth?.missingAccounts).toEqual([]);
  });
  
  it('statement closing on 31st counts for current month', () => {
    // Oct 31 → October (31 ≥ 16)
    const now = new Date('2026-12-01T00:00:00');
    
    const accountSnapshots = [
      {
        accountType: 'checking',
        statementMonth: '2026-10',
        statementDate: '2026-10-31', // 31st = current month (Oct)
        accountName: 'TD Checking',
        slug: 'td-checking-9999',
      },
    ];
    
    const months = getSelectableMonths(accountSnapshots, now);
    
    // October should be complete (statement on 31st counts for Oct)
    const octMonth = months.find(m => m.yearMonth === '2026-10');
    expect(octMonth?.isComplete).toBe(true);
    expect(octMonth?.missingAccounts).toEqual([]);
  });
  
  it('multiple accounts with different closing days', () => {
    const now = new Date('2026-12-01T00:00:00');
    
    const accountSnapshots = [
      {
        accountType: 'checking',
        statementMonth: '2026-10',
        statementDate: '2026-10-31', // 31st → Oct
        accountName: 'TD Checking',
        slug: 'td-checking-1234',
      },
      {
        accountType: 'credit',
        statementMonth: '2026-10',
        statementDate: '2026-10-21', // 21st → Oct
        accountName: 'Amex',
        slug: 'amex-credit-5678',
      },
      {
        accountType: 'credit',
        statementMonth: '2026-11',
        statementDate: '2026-11-03', // 3rd → Oct
        accountName: 'Chase',
        slug: 'chase-credit-9999',
      },
    ];
    
    const months = getSelectableMonths(accountSnapshots, now);
    
    // October should be complete (all three statements count for Oct)
    const octMonth = months.find(m => m.yearMonth === '2026-10');
    expect(octMonth?.isComplete).toBe(true);
    expect(octMonth?.missingAccounts).toEqual([]);
    
    // November should be incomplete (Chase on 3rd counts for Oct, not Nov)
    const novMonth = months.find(m => m.yearMonth === '2026-11');
    expect(novMonth?.isComplete).toBe(false);
    expect(novMonth?.missingAccounts.length).toBe(3); // All accounts missing Nov
  });
  
  it('getLatestCompleteMonth uses closing day assignment', () => {
    // Use September data so November is definitely in the past
    const accountSnapshots = [
      {
        accountType: 'checking',
        statementMonth: '2026-08',
        statementDate: '2026-08-31', // 31st → Aug
        accountName: 'TD Checking',
        slug: 'td-checking-1234',
      },
      {
        accountType: 'credit',
        statementMonth: '2026-09',
        statementDate: '2026-09-03', // 3rd → Aug
        accountName: 'Chase',
        slug: 'chase-credit-5678',
      },
    ];
    
    const result = getLatestCompleteMonth(accountSnapshots);
    
    // Latest complete month should be August (both statements count for Aug)
    expect(result.latestCompleteMonth).toBe('2026-08');
    
    // September should be the missing month (well into the past now)
    expect(result.missingMonth).toBe('2026-09');
    expect(result.missingAccounts.length).toBeGreaterThan(0);
  });
  
  it('edge case: statement on 1st counts for previous month', () => {
    // Nov 1 → October (1 ≤ 15)
    const now = new Date('2026-12-01T00:00:00');
    
    const accountSnapshots = [
      {
        accountType: 'credit',
        statementMonth: '2026-11',
        statementDate: '2026-11-01', // 1st = previous month (Oct)
        accountName: 'Visa',
        slug: 'visa-credit-1111',
      },
    ];
    
    const months = getSelectableMonths(accountSnapshots, now);
    
    // November should be incomplete (statement on 1st counts for Oct)
    const novMonth = months.find(m => m.yearMonth === '2026-11');
    expect(novMonth?.isComplete).toBe(false);
    
    // October should be complete (statement on 1st counts for Oct)
    const octMonth = months.find(m => m.yearMonth === '2026-10');
    expect(octMonth?.isComplete).toBe(true);
  });
  
  it('all accounts must have statements assigned to month for completeness', () => {
    const now = new Date('2026-12-01T00:00:00');
    
    const accountSnapshots = [
      {
        accountType: 'checking',
        statementMonth: '2026-10',
        statementDate: '2026-10-31', // 31st → Oct
        accountName: 'TD Checking',
        slug: 'td-checking-1234',
      },
      {
        accountType: 'credit',
        statementMonth: '2026-10',
        statementDate: '2026-10-15', // 15th → Sep (not Oct!)
        accountName: 'Visa',
        slug: 'visa-credit-5678',
      },
    ];
    
    const months = getSelectableMonths(accountSnapshots, now);
    
    // October should be incomplete (Visa on 15th counts for Sep, not Oct)
    const octMonth = months.find(m => m.yearMonth === '2026-10');
    expect(octMonth?.isComplete).toBe(false);
    expect(octMonth?.missingAccounts.length).toBe(1);
    expect(octMonth?.missingAccounts[0]).toContain('Visa');
    
    // September should be incomplete (checking doesn't have Sep)
    const sepMonth = months.find(m => m.yearMonth === '2026-09');
    expect(sepMonth?.isComplete).toBe(false);
    expect(sepMonth?.missingAccounts.length).toBe(1);
    expect(sepMonth?.missingAccounts[0]).toContain('TD Checking');
  });

  it('REGRESSION: current month must never be complete, even with statements (Nov 2, 2026)', () => {
    // Bug: dashboard showed "Based on Sep, Oct and Nov 2026" on Nov 2
    // Root cause: no current month guard in resolveWindowMonths/isMonthComplete
    const now = new Date('2026-11-02T00:00:00');
    (globalThis as any).__TEST_NOW__ = now;
    
    const accountSnapshots = [
      // October statements (complete)
      {
        accountType: 'checking',
        statementMonth: '2026-10',
        statementDate: '2026-10-31',
        accountName: 'TD Checking',
        slug: 'td-checking-1234',
      },
      {
        accountType: 'credit',
        statementMonth: '2026-10',
        statementDate: '2026-10-21',
        accountName: 'Amex',
        slug: 'amex-credit-5678',
      },
      // November statements (exist but current month!)
      {
        accountType: 'checking',
        statementMonth: '2026-11',
        statementDate: '2026-11-01', // 1st → Oct (but this is edge case)
        accountName: 'TD Checking',
        slug: 'td-checking-1234',
      },
    ];
    
    const months = getSelectableMonths(accountSnapshots, now);
    
    // November appears (it has data) but is flagged as in progress, never complete
    const novMonth = months.find(m => m.yearMonth === '2026-11');
    expect(novMonth).toBeDefined();
    expect(novMonth?.isCurrent).toBe(true);
    expect(novMonth?.isComplete).toBe(false);
    
    // October should be complete
    const octMonth = months.find(m => m.yearMonth === '2026-10');
    expect(octMonth?.isComplete).toBe(true);
    
    // Test resolveWindowMonths directly
    const monthlyHistory = [
      { yearMonth: '2026-09' },
      { yearMonth: '2026-10' },
      { yearMonth: '2026-11' }, // This exists in data
    ];
    
    const resolved = resolveWindowMonths('3mo', monthlyHistory, accountSnapshots);
    
    // Should NOT include November (current month)
    expect(resolved.months).not.toContain('2026-11');
    // Should include September and October (both past)
    expect(resolved.months.length).toBeLessThanOrEqual(2);
    
    delete (globalThis as any).__TEST_NOW__;
  });
});
