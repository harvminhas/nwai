/**
 * Regression test script for dashboard bucket calculations.
 * 
 * Verifies that card values and drawer totals match, and compares against
 * a saved baseline to catch regressions.
 * 
 * Usage:
 *   npx tsx --env-file=.env.local scripts/regression-report.ts <uid>
 *   npx tsx --env-file=.env.local scripts/regression-report.ts <uid> --save-baseline
 * 
 * Read-only (never writes to Firestore), PowerShell-safe (no comma args).
 */

import * as fs from "fs";
import * as path from "path";
import { getFirebaseAdmin } from "../src/lib/firebase-admin";
import { getFinancialProfile } from "../src/lib/financialProfile";
import { computeMoneyCoachBreakdown } from "../src/lib/moneyCoach";
import { computeBucketBreakdown } from "../src/lib/bucketBreakdown";
import { computeAverageSavings, computeMonthlySavings } from "../src/lib/savingsCalculations";
import type { MoneyCoachBucket } from "../src/lib/moneyCoachBuckets";
import type { DebtPaymentReview } from "../src/lib/types";

const BASELINE_PATH = path.join(__dirname, "regression-baseline.json");

interface BucketReport {
  bucket: MoneyCoachBucket;
  cardValue: number;
  drawerTotal: number;
  match: boolean;
  categories?: Array<{ name: string; amount: number }>;
  loans?: Array<{ name: string; amount: number }>;
}

interface RegressionReport {
  uid: string;
  timestamp: string;
  buckets: BucketReport[];
  summary: {
    totalMismatches: number;
    baselineComparison?: {
      changes: Array<{ bucket: string; oldValue: number; newValue: number; pctChange: number }>;
      significantChanges: number;
    };
  };
}

function formatCurrency(amount: number, currency: string = "CAD"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

async function generateReport(uid: string, saveBaseline: boolean): Promise<void> {
  console.log(`\n🧪 Regression Report for UID: ${uid}\n`);
  console.log(`Time: ${new Date().toISOString()}\n`);

  const { db } = getFirebaseAdmin();
  
  // Get financial profile
  const profile = await getFinancialProfile(uid, db);
  const currency = profile.homeCurrency || "CAD";
  
  // Load user debt payment reviews
  const reviewsSnap = await db.collection(`users/${uid}/debtPaymentReviews`).get();
  const userReviews: DebtPaymentReview[] = reviewsSnap.docs.map((doc) => ({
    txFingerprint: doc.id,
    accountSlug: doc.get("accountSlug"),
    classification: doc.get("classification"),
    date: doc.get("date"),
    amount: doc.get("amount"),
    reviewedAt: doc.get("reviewedAt"),
  }));
  
  // Compute Money Coach breakdown (card values)
  const breakdown = computeMoneyCoachBreakdown(profile, userReviews);
  
  // Get last 3 complete months
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const completeMonths = profile.monthlyHistory
    .filter(h => h.yearMonth < currentMonth && h.incomeTotal > 0)
    .slice(-3)
    .map(h => h.yearMonth);
  
  console.log(`📅 Last 3 complete months: ${completeMonths.join(", ")}\n`);
  
  // Test each bucket
  const buckets: MoneyCoachBucket[] = ["fixed", "essentials", "flexible", "savings"];
  const reports: BucketReport[] = [];
  
  for (const bucket of buckets) {
    // Get card value from Money Coach
    const bucketSummary = breakdown.buckets.find(b => b.bucket === bucket);
    const cardValue = bucketSummary?.monthlyAverage || 0;
    
    let drawerTotal: number;
    let categories: Array<{ name: string; amount: number }> = [];
    let loans: Array<{ name: string; amount: number }> = [];
    
    if (bucket === "savings") {
      // Savings drawer uses NET balance calculation, not category breakdown
      drawerTotal = computeAverageSavings(
        profile.monthlyHistory,
        profile.accountBalanceHistory,
        profile.expenseTxns,
        completeMonths
      );
      
      // Get cash/debt/contributions breakdown for display
      const lastMonth = completeMonths[completeMonths.length - 1];
      const monthlySavings = computeMonthlySavings(
        profile.monthlyHistory,
        profile.accountBalanceHistory,
        profile.expenseTxns,
        lastMonth
      );
      
      categories = [
        { name: "Cash change", amount: monthlySavings.netCashChange },
        { name: "Debt paydown", amount: monthlySavings.netDebtChange },
        { name: "Outside contributions", amount: monthlySavings.contributionsToOutside },
      ].filter(c => Math.abs(c.amount) > 0.5);
    } else {
      // Other buckets use category breakdown
      const drawerBreakdown = computeBucketBreakdown(
        bucket,
        profile.expenseTxns,
        profile.accountSnapshots,
        profile.debtPaymentHistory,
        completeMonths,
        currency,
        userReviews,
        profile.fxRates || {}
      );
      
      drawerTotal = drawerBreakdown.monthlyAverage;
      
      categories = drawerBreakdown.categories.map(cat => ({
        name: cat.category,
        amount: cat.amount,
      }));
      
      // Extract loan details for Fixed bucket
      if (bucket === "fixed") {
        const loanCategory = drawerBreakdown.categories.find(c => c.category === "Loan payments");
        if (loanCategory) {
          for (const merchant of loanCategory.merchants) {
            loans.push({
              name: merchant.merchant,
              amount: merchant.amount,
            });
          }
        }
      }
    }
    
    const match = Math.abs(cardValue - drawerTotal) < 1; // Allow $1 rounding difference
    
    const report: BucketReport = {
      bucket,
      cardValue,
      drawerTotal,
      match,
      categories,
      loans: loans.length > 0 ? loans : undefined,
    };
    
    reports.push(report);
  }
  
  // Print results
  console.log("=".repeat(80));
  console.log("BUCKET COMPARISON (Card Value vs Drawer Total)");
  console.log("=".repeat(80) + "\n");
  
  let totalMismatches = 0;
  
  for (const report of reports) {
    const status = report.match ? "✓" : "✗ MISMATCH";
    const bucketName = report.bucket.toUpperCase().padEnd(12);
    
    console.log(`${status} ${bucketName}`);
    console.log(`   Card:   ${formatCurrency(report.cardValue, currency)}`);
    console.log(`   Drawer: ${formatCurrency(report.drawerTotal, currency)}`);
    
    if (!report.match) {
      const diff = report.drawerTotal - report.cardValue;
      console.log(`   Diff:   ${formatCurrency(diff, currency)}`);
      totalMismatches++;
    }
    
    if (report.categories && report.categories.length > 0) {
      console.log(`\n   Categories:`);
      for (const cat of report.categories) {
        console.log(`     ${cat.name.padEnd(30)} ${formatCurrency(cat.amount, currency)}`);
      }
    }
    
    if (report.loans && report.loans.length > 0) {
      console.log(`\n   Loan Details:`);
      for (const loan of report.loans) {
        console.log(`     ${loan.name.padEnd(40)} ${formatCurrency(loan.amount, currency)}`);
      }
    }
    
    console.log();
  }
  
  console.log("=".repeat(80));
  console.log(`SUMMARY: ${totalMismatches} mismatch(es) found`);
  console.log("=".repeat(80) + "\n");
  
  // Compare against baseline
  let baselineComparison;
  if (fs.existsSync(BASELINE_PATH)) {
    const baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, "utf-8")) as RegressionReport;
    
    console.log(`📊 Comparing against baseline (${baseline.timestamp}):\n`);
    
    const changes: Array<{ bucket: string; oldValue: number; newValue: number; pctChange: number }> = [];
    let significantChanges = 0;
    
    for (const report of reports) {
      const baselineBucket = baseline.buckets.find(b => b.bucket === report.bucket);
      if (baselineBucket) {
        const oldValue = baselineBucket.cardValue;
        const newValue = report.cardValue;
        const pctChange = oldValue !== 0 ? ((newValue - oldValue) / oldValue) * 100 : 0;
        
        if (Math.abs(pctChange) > 0.1) { // Show any change > 0.1%
          const flag = Math.abs(pctChange) > 5 ? "⚠️  " : "   ";
          console.log(`${flag}${report.bucket.toUpperCase().padEnd(12)} ${formatCurrency(oldValue, currency)} → ${formatCurrency(newValue, currency)} (${pctChange > 0 ? "+" : ""}${pctChange.toFixed(1)}%)`);
          
          changes.push({ bucket: report.bucket, oldValue, newValue, pctChange });
          
          if (Math.abs(pctChange) > 5) {
            significantChanges++;
          }
        }
      }
    }
    
    if (changes.length === 0) {
      console.log("   No changes detected.\n");
    } else {
      console.log();
    }
    
    if (significantChanges > 0) {
      console.log(`⚠️  WARNING: ${significantChanges} bucket(s) changed by more than 5%\n`);
    }
    
    baselineComparison = { changes, significantChanges };
  } else {
    console.log("ℹ️  No baseline found. Run with --save-baseline to create one.\n");
  }
  
  // Save baseline if requested
  if (saveBaseline) {
    const reportData: RegressionReport = {
      uid,
      timestamp: new Date().toISOString(),
      buckets: reports,
      summary: {
        totalMismatches,
        baselineComparison,
      },
    };
    
    fs.writeFileSync(BASELINE_PATH, JSON.stringify(reportData, null, 2), "utf-8");
    console.log(`✅ Baseline saved to ${BASELINE_PATH}\n`);
  }
  
  // Exit with error code if mismatches found
  if (totalMismatches > 0) {
    console.error(`❌ Test failed: ${totalMismatches} card/drawer mismatch(es)\n`);
    process.exit(1);
  }
  
  if (baselineComparison && baselineComparison.significantChanges > 0) {
    console.error(`❌ Test failed: ${baselineComparison.significantChanges} significant change(s) from baseline\n`);
    process.exit(1);
  }
  
  console.log("✅ All tests passed\n");
}

// Main
const args = process.argv.slice(2);
const uid = args.find(arg => !arg.startsWith("--"));
const saveBaseline = args.includes("--save-baseline");

if (!uid) {
  console.error("Usage: npx tsx --env-file=.env.local scripts/regression-report.ts <uid> [--save-baseline]");
  process.exit(1);
}

generateReport(uid, saveBaseline).catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
