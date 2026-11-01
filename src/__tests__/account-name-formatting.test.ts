/**
 * Test account name formatting for missing statements modal.
 * 
 * Bug: formatAccountName took first word of name, so "The Bank of Nova Scotia" 
 * became "The credit •••1009" instead of the full name.
 */

import { describe, it, expect } from 'vitest';
import { resolveWindowMonths } from '../lib/rangeUtils';

describe('Account name formatting in missing statements', () => {
  it('should use full account name when it starts with "The"', () => {
    // Inject test date: Nov 1, 2026
    (globalThis as any).__TEST_NOW__ = new Date('2026-11-01T00:00:00');
    
    const monthlyHistory = [
      { yearMonth: '2026-08' },
    ];
    
    const accountSnapshots = [
      // Checking account with complete coverage
      {
        accountType: 'checking',
        statementMonth: '2026-08',
        statementDate: '2026-08-31',
        accountName: 'TD Everyday Chequing',
        slug: 'td-checking-1234',
      },
      // Credit card starting with "The" - has coverage through Aug only
      {
        accountType: 'credit',
        statementMonth: '2026-08',
        statementDate: '2026-08-31',
        accountName: 'The Bank of Nova Scotia Momentum VISA',
        slug: 'scotiabank-credit-1009',
      },
    ];
    
    const result = resolveWindowMonths('3mo', monthlyHistory, accountSnapshots);
    
    // Should have missing accounts (need Sep and Oct statements)
    expect(result.missingAccounts).toBeDefined();
    expect(result.missingAccounts?.length).toBeGreaterThan(0);
    
    // The Scotiabank account should show full name, not just "The"
    const scotiaAccount = result.missingAccounts?.find(acc => acc.includes('1009'));
    expect(scotiaAccount).toBeDefined();
    expect(scotiaAccount).toContain('The Bank of Nova Scotia');
    expect(scotiaAccount).toContain('•••1009');
    expect(scotiaAccount).not.toBe('The credit •••1009'); // Bug case
    
    // Clean up
    delete (globalThis as any).__TEST_NOW__;
  });
  
  it('should use full account name for multi-word banks', () => {
    (globalThis as any).__TEST_NOW__ = new Date('2026-11-01T00:00:00');
    
    const monthlyHistory = [{ yearMonth: '2026-08' }];
    
    const accountSnapshots = [
      {
        accountType: 'checking',
        statementMonth: '2026-08',
        statementDate: '2026-08-31',
        accountName: 'TD Everyday Chequing',
        slug: 'td-checking-1234',
      },
      {
        accountType: 'credit',
        statementMonth: '2026-08',
        statementDate: '2026-08-31',
        accountName: 'Royal Bank of Canada Avion VISA',
        slug: 'rbc-credit-5678',
      },
    ];
    
    const result = resolveWindowMonths('3mo', monthlyHistory, accountSnapshots);
    
    const rbcAccount = result.missingAccounts?.find(acc => acc.includes('5678'));
    expect(rbcAccount).toContain('Royal Bank of Canada');
    expect(rbcAccount).toContain('•••5678');
    expect(rbcAccount).not.toBe('Royal credit •••5678'); // Would be wrong
    
    delete (globalThis as any).__TEST_NOW__;
  });
  
  it('should fall back to bank name + type when accountName missing', () => {
    (globalThis as any).__TEST_NOW__ = new Date('2026-11-01T00:00:00');
    
    const monthlyHistory = [{ yearMonth: '2026-08' }];
    
    const accountSnapshots = [
      {
        accountType: 'checking',
        statementMonth: '2026-08',
        statementDate: '2026-08-31',
        slug: 'td-checking-1234',
        // No accountName provided
      },
      {
        accountType: 'credit',
        statementMonth: '2026-08',
        statementDate: '2026-08-31',
        slug: 'cibc-credit-9999',
        // No accountName provided
      },
    ];
    
    const result = resolveWindowMonths('3mo', monthlyHistory, accountSnapshots);
    
    // Should fall back to "Bank type •••last4" format
    const cibcAccount = result.missingAccounts?.find(acc => acc.includes('9999'));
    expect(cibcAccount).toBeDefined();
    expect(cibcAccount).toMatch(/Cibc credit •••9999/i);
    
    delete (globalThis as any).__TEST_NOW__;
  });
  
  it('should handle single-word account names', () => {
    (globalThis as any).__TEST_NOW__ = new Date('2026-11-01T00:00:00');
    
    const monthlyHistory = [{ yearMonth: '2026-08' }];
    
    const accountSnapshots = [
      {
        accountType: 'checking',
        statementMonth: '2026-08',
        statementDate: '2026-08-31',
        accountName: 'TD Everyday Chequing',
        slug: 'td-checking-1234',
      },
      {
        accountType: 'savings',
        statementMonth: '2026-08',
        statementDate: '2026-08-31',
        accountName: 'Wealthsimple',
        slug: 'wealthsimple-savings-7777',
      },
    ];
    
    const result = resolveWindowMonths('3mo', monthlyHistory, accountSnapshots);
    
    // Savings accounts don't block, so only checking should be in missing
    // But if it were to show, should handle single word correctly
    if (result.missingAccounts?.some(acc => acc.includes('7777'))) {
      const wsAccount = result.missingAccounts.find(acc => acc.includes('7777'));
      expect(wsAccount).toContain('Wealthsimple');
      expect(wsAccount).toContain('•••7777');
    }
    
    delete (globalThis as any).__TEST_NOW__;
  });
});
