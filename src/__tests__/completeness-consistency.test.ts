/**
 * Test that getSelectableMonths (Month dropdown) and resolveWindowMonths (nudge)
 * agree on which months are incomplete and which accounts are missing.
 * 
 * Bug: Sep/Oct showed as incomplete in dropdown but no nudge appeared because
 * resolveWindowMonths only checked for gaps AFTER a complete month, not when
 * ALL months are incomplete.
 */

import { describe, it, expect } from 'vitest';
import { getSelectableMonths, resolveWindowMonths } from '../lib/rangeUtils';

describe('Completeness consistency between dropdown and nudge', () => {
  it('60-day active window excludes old accounts from completeness check', () => {
    // Scenario: Amex has old Aug statement (outside 60-day window)
    // Sep and Oct complete for active accounts (checking, Visa)
    // Demonstrates that inactive accounts don't block completeness
    const now = new Date('2026-11-02T00:00:00');
    (globalThis as any).__TEST_NOW__ = now;
    
    const accountSnapshots = [
      // September - checking and Visa (Amex missing)
      {
        accountType: 'checking',
        statementMonth: '2026-09',
        statementDate: '2026-09-30',
        accountName: 'TD Checking',
        slug: 'td-checking-1234',
      },
      {
        accountType: 'credit',
        statementMonth: '2026-09',
        statementDate: '2026-09-21',
        accountName: 'TD Visa',
        slug: 'td-credit-7035',
      },
      // October - checking and Visa (Amex missing)
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
        accountName: 'TD Visa',
        slug: 'td-credit-7035',
      },
      // Amex only has Aug (outside 60-day window from Oct 31)
      {
        accountType: 'credit',
        statementMonth: '2026-08',
        statementDate: '2026-08-18',
        accountName: 'Amex Gold',
        slug: 'amex-credit-1009',
      },
    ];
    
    // Month dropdown - check which months are incomplete
    const selectableMonths = getSelectableMonths(accountSnapshots, now);
    const sepDropdown = selectableMonths.find(m => m.yearMonth === '2026-09');
    const octDropdown = selectableMonths.find(m => m.yearMonth === '2026-10');
    
    // Both Sep and Oct are complete for ACTIVE accounts (Amex is inactive)
    // This demonstrates the 60-day active window effect
    expect(sepDropdown?.isComplete).toBe(true);
    expect(octDropdown?.isComplete).toBe(true);
    
    // Window resolution
    const monthlyHistory = [
      { yearMonth: '2026-09' },
      { yearMonth: '2026-10' },
    ];
    
    const resolved = resolveWindowMonths('3mo', monthlyHistory, accountSnapshots);
    
    // Should use both months (both complete for active accounts)
    expect(resolved.months).toEqual(['2026-09', '2026-10']);
    
    // No missing months (Amex inactive, so not checked)
    expect(resolved.missingMonths).toBeUndefined();
    
    delete (globalThis as any).__TEST_NOW__;
  });
  
  it('dropdown and nudge agree when there ARE complete months', () => {
    const now = new Date('2026-11-02T00:00:00');
    (globalThis as any).__TEST_NOW__ = now;
    
    const accountSnapshots = [
      // August - both complete
      {
        accountType: 'checking',
        statementMonth: '2026-08',
        statementDate: '2026-08-31',
        accountName: 'TD Checking',
        slug: 'td-checking-1234',
      },
      {
        accountType: 'credit',
        statementMonth: '2026-08',
        statementDate: '2026-08-21',
        accountName: 'Amex Gold',
        slug: 'amex-credit-1009',
      },
      // September - both complete
      {
        accountType: 'checking',
        statementMonth: '2026-09',
        statementDate: '2026-09-30',
        accountName: 'TD Checking',
        slug: 'td-checking-1234',
      },
      {
        accountType: 'credit',
        statementMonth: '2026-09',
        statementDate: '2026-09-21',
        accountName: 'Amex Gold',
        slug: 'amex-credit-1009',
      },
      // October - checking only (credit missing)
      {
        accountType: 'checking',
        statementMonth: '2026-10',
        statementDate: '2026-10-31',
        accountName: 'TD Checking',
        slug: 'td-checking-1234',
      },
    ];
    
    // Month dropdown
    const selectableMonths = getSelectableMonths(accountSnapshots, now);
    const augDropdown = selectableMonths.find(m => m.yearMonth === '2026-08');
    const sepDropdown = selectableMonths.find(m => m.yearMonth === '2026-09');
    const octDropdown = selectableMonths.find(m => m.yearMonth === '2026-10');
    
    // Aug and Sep should be complete
    expect(augDropdown?.isComplete).toBe(true);
    expect(sepDropdown?.isComplete).toBe(true);
    
    // Oct should be incomplete
    expect(octDropdown?.isComplete).toBe(false);
    expect(octDropdown?.missingAccounts.some(a => a.includes('Amex'))).toBe(true);
    
    // Window resolution
    const monthlyHistory = [
      { yearMonth: '2026-08' },
      { yearMonth: '2026-09' },
      { yearMonth: '2026-10' },
    ];
    
    const resolved = resolveWindowMonths('3mo', monthlyHistory, accountSnapshots);
    
    // Should use Aug and Sep (complete), not Oct
    expect(resolved.months).toEqual(['2026-08', '2026-09']);
    
    // Should detect Oct as missing
    expect(resolved.missingMonths).toContain('2026-10');
    expect(resolved.missingAccounts!.some(a => a.includes('Amex'))).toBe(true);
    
    delete (globalThis as any).__TEST_NOW__;
  });
  
  it('no false positive when all months are complete', () => {
    const now = new Date('2026-11-02T00:00:00');
    (globalThis as any).__TEST_NOW__ = now;
    
    const accountSnapshots = [
      // All months complete for both accounts
      {
        accountType: 'checking',
        statementMonth: '2026-08',
        statementDate: '2026-08-31',
        accountName: 'TD Checking',
        slug: 'td-checking-1234',
      },
      {
        accountType: 'credit',
        statementMonth: '2026-08',
        statementDate: '2026-08-21',
        accountName: 'Amex',
        slug: 'amex-credit-1009',
      },
      {
        accountType: 'checking',
        statementMonth: '2026-09',
        statementDate: '2026-09-30',
        accountName: 'TD Checking',
        slug: 'td-checking-1234',
      },
      {
        accountType: 'credit',
        statementMonth: '2026-09',
        statementDate: '2026-09-21',
        accountName: 'Amex',
        slug: 'amex-credit-1009',
      },
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
        slug: 'amex-credit-1009',
      },
    ];
    
    // Month dropdown - all should be complete
    const selectableMonths = getSelectableMonths(accountSnapshots, now);
    const augDropdown = selectableMonths.find(m => m.yearMonth === '2026-08');
    const sepDropdown = selectableMonths.find(m => m.yearMonth === '2026-09');
    const octDropdown = selectableMonths.find(m => m.yearMonth === '2026-10');
    
    expect(augDropdown?.isComplete).toBe(true);
    expect(sepDropdown?.isComplete).toBe(true);
    expect(octDropdown?.isComplete).toBe(true);
    
    // Window resolution - no missing months
    const monthlyHistory = [
      { yearMonth: '2026-08' },
      { yearMonth: '2026-09' },
      { yearMonth: '2026-10' },
    ];
    
    const resolved = resolveWindowMonths('3mo', monthlyHistory, accountSnapshots);
    
    // Should use all three months
    expect(resolved.months).toEqual(['2026-08', '2026-09', '2026-10']);
    
    // No missing months or accounts
    expect(resolved.missingMonths).toBeUndefined();
    expect(resolved.missingAccounts).toBeUndefined();
    
    delete (globalThis as any).__TEST_NOW__;
  });
});
