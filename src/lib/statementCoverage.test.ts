/**
 * Unit tests for statementCoverage
 * 
 * Run with: npx tsx src/lib/statementCoverage.test.ts
 */

import { computeStatementCoverage } from "./statementCoverage";
import type { UserStatementSummary } from "./types";

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

function assertEqual<T>(actual: T, expected: T, message: string) {
  if (actual !== expected) {
    throw new Error(`${message}\nExpected: ${expected}\nActual: ${actual}`);
  }
}

// Test case: accounts with name variants should be merged into one row
function testAccountNameVariantsMerge() {
  console.log("Test: Account name variants should merge into one row");
  
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;
  
  // Helper to create a statement
  const createStatement = (
    accountId: string,
    accountName: string,
    bankName: string,
    monthOffset: number,
    uploadDate: string
  ): UserStatementSummary => {
    const statementMonth = currentMonth - monthOffset;
    const year = statementMonth > 0 ? currentYear : currentYear - 1;
    const month = statementMonth > 0 ? statementMonth : 12 + statementMonth;
    
    return {
      id: `stmt-${accountId}-${monthOffset}`,
      status: "completed",
      statementDate: `${year}-${String(month).padStart(2, "0")}-15`,
      bankName,
      accountId: `XXXX${accountId}`, // Masked format
      accountName,
      accountType: "credit",
      uploadedAt: uploadDate,
      fileName: `statement-${accountId}-${monthOffset}.pdf`,
    };
  };
  
  const statements: UserStatementSummary[] = [
    // Same account (0773) with three different name variants
    createStatement("0773", "CIBC Costco World Mastercard®", "CIBC", 3, "2026-09-15T10:00:00Z"),
    createStatement("0773", "CIBC Costco World Mastercard", "CIBC", 2, "2026-10-01T10:00:00Z"),
    createStatement("0773", "CIBC Costco World Mastercard®", "CIBC", 1, "2026-10-15T10:00:00Z"),
    
    // Another account (7035) with two name variants
    createStatement("7035", "TD FIRST CLASS TRAVEL CARD", "TD", 3, "2026-09-15T10:00:00Z"),
    createStatement("7035", "TD First Class Travel Card™", "TD", 2, "2026-10-01T10:00:00Z"),
    
    // Different account (should not merge)
    createStatement("1234", "TD Aeroplan Visa Infinite", "TD", 2, "2026-10-01T10:00:00Z"),
  ];
  
  const result = computeStatementCoverage(statements, 6);
  
  // Should have exactly 3 accounts (not 6 due to duplicates)
  assertEqual(result.groups.flatMap(g => g.accounts).length, 3, "Should merge duplicate accounts");
  
  // Find the CIBC account
  const cibcAccounts = result.groups.find(g => g.bankName === "CIBC")?.accounts || [];
  assertEqual(cibcAccounts.length, 1, "CIBC should have exactly 1 account row");
  
  // Check the merged account has the clean name (no ®)
  const cibcAccount = cibcAccounts[0];
  assert(
    !cibcAccount.accountName.includes("®"),
    "Account name should have ® stripped: " + cibcAccount.accountName
  );
  assert(
    cibcAccount.accountName.includes("CIBC Costco World Mastercard"),
    "Account name should contain base name: " + cibcAccount.accountName
  );
  
  // Check it has 3 uploaded months
  const uploadedCells = cibcAccount.cells.filter(c => c.state === "uploaded");
  assertEqual(uploadedCells.length, 3, "Should have 3 uploaded months from merged statements");
  
  // Find the TD accounts
  const tdAccounts = result.groups.find(g => g.bankName === "TD")?.accounts || [];
  assertEqual(tdAccounts.length, 2, "TD should have exactly 2 account rows (7035 and 1234)");
  
  // Check the TD 7035 account has clean name
  const td7035 = tdAccounts.find(a => a.accountId.endsWith("7035"));
  assert(!!td7035, "Should find TD account ending in 7035");
  assert(
    !td7035!.accountName.includes("™"),
    "TD account name should have ™ stripped: " + td7035!.accountName
  );
  
  // Check it has 2 uploaded months
  const td7035Uploaded = td7035!.cells.filter(c => c.state === "uploaded");
  assertEqual(td7035Uploaded.length, 2, "TD 7035 should have 2 uploaded months");
  
  console.log("✓ Test passed: Account name variants merge correctly");
}

// Test case: missing month count should be correct after merging
function testMissingCountAfterMerge() {
  console.log("Test: Missing count should be correct after merging rows");
  
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;
  
  const createStatement = (
    accountId: string,
    accountName: string,
    monthOffset: number
  ): UserStatementSummary => {
    const statementMonth = currentMonth - monthOffset;
    const year = statementMonth > 0 ? currentYear : currentYear - 1;
    const month = statementMonth > 0 ? statementMonth : 12 + statementMonth;
    
    return {
      id: `stmt-${accountId}-${monthOffset}`,
      status: "completed",
      statementDate: `${year}-${String(month).padStart(2, "0")}-15`,
      bankName: "TD",
      accountId: `XXXX${accountId}`,
      accountName,
      accountType: "credit",
      uploadedAt: "2026-10-01T10:00:00Z",
      fileName: `statement-${accountId}-${monthOffset}.pdf`,
    };
  };
  
  // Account with statements at months 5, 3, 1 (gaps at 4 and 2)
  const statements: UserStatementSummary[] = [
    createStatement("0773", "CIBC Costco World Mastercard®", 5),
    createStatement("0773", "CIBC Costco World Mastercard", 3),  // Different name
    createStatement("0773", "CIBC Costco World Mastercard®", 1), // Different name
  ];
  
  const result = computeStatementCoverage(statements, 6);
  
  const accounts = result.groups.flatMap(g => g.accounts);
  assertEqual(accounts.length, 1, "Should have exactly 1 merged account");
  
  // Should have exactly 2 missing months (4 and 2)
  assertEqual(accounts[0].missingCount, 2, "Should have 2 missing months after merge");
  
  // Total missing should also be 2
  assertEqual(result.totalMissing, 2, "Total missing should be 2");
  
  console.log("✓ Test passed: Missing count correct after merge");
}

// Run all tests
try {
  testAccountNameVariantsMerge();
  testMissingCountAfterMerge();
  console.log("\n✓ All tests passed!");
  process.exit(0);
} catch (error) {
  console.error("\n✗ Test failed:");
  console.error(error);
  process.exit(1);
}
