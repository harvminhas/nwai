/**
 * Audit script for TD Home Equity FlexLine account (ending 0085)
 * 
 * Analyzes last 12 months of statements to track:
 * - Opening/closing balances
 * - Payments in (paymentsMade)
 * - Draws/advances out
 * - Interest charged
 * - Fees
 * - Balance reconciliation
 * - Where draws went (matching transfers to other accounts)
 * 
 * Usage: npx tsx --env-file=.env.local scripts/audit-flexline-0085.ts <uid>
 */

import { getFirebaseAdmin } from "../src/lib/firebase-admin";

interface MonthlyAnalysis {
  month: string;
  openingBalance: number;
  closingBalance: number;
  paymentsIn: number;
  draws: number;
  interest: number;
  fees: number;
  drawDescriptions: string[];
  reconciles: boolean;
  reconciliationError: number;
  potentialTransferMatches: Array<{
    drawDate: string;
    drawAmount: number;
    drawDesc: string;
    matchAccount: string;
    matchDate: string;
    matchAmount: number;
    matchDesc: string;
  }>;
}

async function auditFlexLine(uid: string) {
  console.log(`\n📊 TD HOME EQUITY FLEXLINE AUDIT (Account ending 0085)`);
  console.log(`User: ${uid}`);
  console.log(`Period: Last 12 months`);
  console.log("=".repeat(100) + "\n");

  const { db } = getFirebaseAdmin();
  
  // Get all statements for this user (same query as financialProfile)
  const statementsSnap = await db
    .collection("statements")
    .where("userId", "==", uid)
    .where("status", "==", "completed")
    .get();

  if (statementsSnap.empty) {
    console.log("❌ No statements found for this user");
    return;
  }

  // Filter to FlexLine account (look for FlexLine, HELOC, or Equity in the label)
  const flexLineStatements = statementsSnap.docs
    .map(doc => ({
      id: doc.id,
      ...doc.data(),
    }))
    .filter((stmt: any) => {
      const parsed = stmt.parsedData;
      if (!parsed) return false;
      
      const accountSlug = parsed.accountSlug || "";
      const bankName = (parsed.bankName || "").toLowerCase();
      const accountName = (parsed.accountName || "").toLowerCase();
      const accountType = (parsed.accountType || "").toLowerCase();
      
      // Look for TD Home Equity FlexLine indicators
      return (
        accountSlug.endsWith("0085") ||
        accountName.includes("flexline") ||
        accountName.includes("heloc") ||
        accountName.includes("equity") ||
        (bankName.includes("td") && accountType.includes("loc")) ||
        (bankName.includes("td") && accountType.includes("line"))
      );
    })
    .sort((a: any, b: any) => {
      const aMonth = a.parsedData?.statementMonth || "";
      const bMonth = b.parsedData?.statementMonth || "";
      return aMonth.localeCompare(bMonth);
    }) as Array<{ id: string; parsedData?: any; [key: string]: any }>;

  if (flexLineStatements.length === 0) {
    console.log("❌ No statements found for FlexLine account ending 0085");
    return;
  }

  console.log(`Found ${flexLineStatements.length} FlexLine statements\n`);
  
  // Debug: print all account slugs seen if no FlexLine found
  if (flexLineStatements.length === 0) {
    console.log("❌ No statements found for FlexLine account ending 0085");
    console.log("\nAll account slugs/labels found in statements:");
    const uniqueAccounts = new Map<string, string>();
    statementsSnap.docs.forEach(doc => {
      const data = doc.data();
      const slug = data.parsedData?.accountSlug || '';
      const label = data.parsedData?.bankName + ' ' + (data.parsedData?.accountName || data.parsedData?.accountType || '');
      if (slug && !uniqueAccounts.has(slug)) {
        uniqueAccounts.set(slug, label);
      }
    });
    
    const sortedAccounts = Array.from(uniqueAccounts.entries()).sort((a, b) => a[0].localeCompare(b[0]));
    sortedAccounts.forEach(([slug, label]) => {
      console.log(`  ${slug.padEnd(60)} ${label}`);
    });
    
    console.log(`\nTotal unique accounts: ${uniqueAccounts.size}`);
    console.log("Note: Looking for account with 'FlexLine', 'HELOC', or 'Equity' in name\n");
    return;
  }

  // Get all statements for cross-account transfer matching
  const allStatements = statementsSnap.docs.map(doc => ({
    id: doc.id,
    ...doc.data(),
  })) as Array<{ id: string; parsedData?: any; [key: string]: any }>;

  // Analyze each month
  const monthlyData: MonthlyAnalysis[] = [];
  let previousClosing: number | null = null;

  for (const stmt of flexLineStatements) {
    const parsed = stmt.parsedData;
    if (!parsed) continue;

    // Use the same fields as financialProfile
    const month = (stmt.yearMonth as string | undefined) ?? (parsed.statementDate ?? "").slice(0, 7);
    if (!month) continue;
    
    // FlexLine is a debt account, so balance is negative (or absolute value is the amount owed)
    const closingBalance = Math.abs(parsed.netWorth ?? parsed.closingBalance ?? 0);
    const openingBalance = previousClosing !== null ? previousClosing : Math.abs(parsed.openingBalance ?? closingBalance);
    
    // Extract financial data
    const paymentsIn = parsed.paymentsMade || 0;
    
    // Draws are expenses (negative amounts on a debt account)
    const expensesList = parsed.expenses?.transactions || [];
    const draws = expensesList
      .filter((e: any) => {
        const cat = (e.category || "").toLowerCase();
        const desc = (e.merchant || "").toLowerCase();
        // FlexLine draws are typically labeled as advances, transfers, or have "flexline" in description
        return cat.includes("transfer") || 
               cat.includes("advance") || 
               desc.includes("flexline") ||
               desc.includes("advance") ||
               desc.includes("draw");
      });
    
    const totalDraws = draws.reduce((sum: number, d: any) => sum + Math.abs(d.amount), 0);
    const drawDescriptions = draws.map((d: any) => `${d.date}: ${d.merchant} $${Math.abs(d.amount).toFixed(2)}`);
    
    // Interest charges
    const interest = expensesList
      .filter((e: any) => {
        const cat = (e.category || "").toLowerCase();
        const desc = (e.merchant || "").toLowerCase();
        return cat.includes("fees") || desc.includes("interest") || desc.includes("int chg");
      })
      .reduce((sum: number, e: any) => sum + Math.abs(e.amount), 0);
    
    // Fees (excluding interest)
    const fees = expensesList
      .filter((e: any) => {
        const cat = (e.category || "").toLowerCase();
        const desc = (e.merchant || "").toLowerCase();
        return (cat.includes("fees") || desc.includes("fee")) && 
               !desc.includes("interest") && 
               !desc.includes("int chg");
      })
      .reduce((sum: number, e: any) => sum + Math.abs(e.amount), 0);
    
    // Reconciliation check: closing = opening + draws + interest + fees - payments
    const expectedClosing = openingBalance + totalDraws + interest + fees - paymentsIn;
    const reconciles = Math.abs(expectedClosing - closingBalance) < 1.0;
    const reconciliationError = closingBalance - expectedClosing;
    
    // Find potential transfer matches to other accounts
    const potentialMatches: MonthlyAnalysis["potentialTransferMatches"] = [];
    
    for (const draw of draws) {
      const drawDate = draw.date;
      const drawAmount = Math.abs(draw.amount);
      const drawDesc = draw.merchant;
      
      // Look for matching deposits in other accounts within +/- 2 days
      for (const otherStmt of allStatements) {
        const otherParsed = otherStmt.parsedData;
        if (!otherParsed || otherParsed.accountSlug === parsed.accountSlug) continue;
        
        // Check income (deposits)
        const deposits = otherParsed.income?.transactions || [];
        for (const dep of deposits) {
          const depDate = dep.date;
          const depAmount = dep.amount;
          const depDesc = dep.source || "";
          
          // Match if amount is close and date is within 2 days
          if (Math.abs(depAmount - drawAmount) < 0.50) {
            const daysDiff = Math.abs(
              new Date(depDate).getTime() - new Date(drawDate).getTime()
            ) / 86400000;
            
            if (daysDiff <= 2) {
              potentialMatches.push({
                drawDate,
                drawAmount,
                drawDesc,
                matchAccount: otherParsed.accountSlug || otherStmt.id,
                matchDate: depDate,
                matchAmount: depAmount,
                matchDesc: depDesc,
              });
            }
          }
        }
      }
    }
    
    monthlyData.push({
      month,
      openingBalance,
      closingBalance,
      paymentsIn,
      draws: totalDraws,
      interest,
      fees,
      drawDescriptions,
      reconciles,
      reconciliationError,
      potentialTransferMatches: potentialMatches,
    });
    
    previousClosing = closingBalance;
  }

  // Sort by month
  monthlyData.sort((a, b) => a.month.localeCompare(b.month));

  // Print summary table
  console.log("MONTHLY SUMMARY");
  console.log("=".repeat(150));
  console.log(
    "Month".padEnd(10) +
    "Opening".padStart(12) +
    "Closing".padStart(12) +
    "Payments".padStart(12) +
    "Draws".padStart(12) +
    "Interest".padStart(10) +
    "Fees".padStart(10) +
    "Recon".padStart(8) +
    "Error".padStart(10)
  );
  console.log("=".repeat(150));
  
  let totalPayments = 0;
  let totalDraws = 0;
  let totalInterest = 0;
  let totalFees = 0;
  
  for (const data of monthlyData) {
    totalPayments += data.paymentsIn;
    totalDraws += data.draws;
    totalInterest += data.interest;
    totalFees += data.fees;
    
    console.log(
      String(data.month ?? '-').padEnd(10) +
      `$${(data.openingBalance ?? 0).toFixed(2)}`.padStart(12) +
      `$${(data.closingBalance ?? 0).toFixed(2)}`.padStart(12) +
      `$${(data.paymentsIn ?? 0).toFixed(2)}`.padStart(12) +
      `$${(data.draws ?? 0).toFixed(2)}`.padStart(12) +
      `$${(data.interest ?? 0).toFixed(2)}`.padStart(10) +
      `$${(data.fees ?? 0).toFixed(2)}`.padStart(10) +
      (data.reconciles ? "✓" : "✗").padStart(8) +
      `$${(data.reconciliationError ?? 0).toFixed(2)}`.padStart(10)
    );
  }
  
  console.log("=".repeat(150));
  console.log(
    "TOTAL".padEnd(10) +
    "".padStart(24) +
    `$${totalPayments.toFixed(2)}`.padStart(12) +
    `$${totalDraws.toFixed(2)}`.padStart(12) +
    `$${totalInterest.toFixed(2)}`.padStart(10) +
    `$${totalFees.toFixed(2)}`.padStart(10)
  );
  console.log();
  
  // Balance change analysis
  const firstMonth = monthlyData[0];
  const lastMonth = monthlyData[monthlyData.length - 1];
  const balanceGrowth = lastMonth.closingBalance - firstMonth.openingBalance;
  
  console.log("\nBALANCE CHANGE ANALYSIS");
  console.log("=".repeat(100));
  console.log(`Starting balance (${firstMonth.month}): $${firstMonth.openingBalance.toFixed(2)}`);
  console.log(`Ending balance (${lastMonth.month}): $${lastMonth.closingBalance.toFixed(2)}`);
  console.log(`Balance growth: $${balanceGrowth.toFixed(2)}`);
  console.log();
  console.log(`Total payments made: $${totalPayments.toFixed(2)}`);
  console.log(`Total draws taken: $${totalDraws.toFixed(2)}`);
  console.log(`Total interest charged: $${totalInterest.toFixed(2)}`);
  console.log(`Total fees: $${totalFees.toFixed(2)}`);
  console.log();
  console.log(`Net change (draws + interest + fees - payments): $${(totalDraws + totalInterest + totalFees - totalPayments).toFixed(2)}`);
  console.log(`Actual balance growth: $${balanceGrowth.toFixed(2)}`);
  console.log(`Difference: $${(balanceGrowth - (totalDraws + totalInterest + totalFees - totalPayments)).toFixed(2)}`);
  
  // Check for regular payments (same amount)
  const paymentAmounts = monthlyData.map(d => d.paymentsIn).filter(p => p > 0);
  const paymentCounts = new Map<number, number>();
  for (const amount of paymentAmounts) {
    // Round to 2 decimals for comparison
    const rounded = Math.round(amount * 100) / 100;
    paymentCounts.set(rounded, (paymentCounts.get(rounded) || 0) + 1);
  }
  
  const regularPayments = Array.from(paymentCounts.entries())
    .filter(([_, count]) => count >= 3)
    .sort((a, b) => b[1] - a[1]);
  
  if (regularPayments.length > 0) {
    console.log();
    console.log("REGULAR PAYMENTS DETECTED:");
    for (const [amount, count] of regularPayments) {
      console.log(`  $${amount.toFixed(2)} appears ${count} times (likely TD ALLINCLUSIVE automatic payment)`);
    }
  }
  
  // Detailed month-by-month findings
  console.log("\n\nDETAILED FINDINGS");
  console.log("=".repeat(100));
  
  for (const data of monthlyData) {
    console.log(`\n📅 ${data.month}`);
    console.log(`Opening: $${data.openingBalance.toFixed(2)} → Closing: $${data.closingBalance.toFixed(2)} (change: $${(data.closingBalance - data.openingBalance).toFixed(2)})`);
    console.log(`Payments in: $${data.paymentsIn.toFixed(2)}, Draws out: $${data.draws.toFixed(2)}, Interest: $${data.interest.toFixed(2)}, Fees: $${data.fees.toFixed(2)}`);
    
    if (!data.reconciles) {
      console.log(`⚠️  RECONCILIATION ISSUE: Expected closing $${(data.openingBalance + data.draws + data.interest + data.fees - data.paymentsIn).toFixed(2)}, Actual $${data.closingBalance.toFixed(2)} (error: $${data.reconciliationError.toFixed(2)})`);
    }
    
    if (data.drawDescriptions.length > 0) {
      console.log(`\nDraws:`);
      data.drawDescriptions.forEach(desc => console.log(`  - ${desc}`));
    }
    
    if (data.potentialTransferMatches.length > 0) {
      console.log(`\nPotential transfer matches:`);
      data.potentialTransferMatches.forEach(match => {
        console.log(`  - Draw ${match.drawDate} $${match.drawAmount.toFixed(2)} "${match.drawDesc}"`);
        console.log(`    → Match in ${match.matchAccount} on ${match.matchDate} $${match.matchAmount.toFixed(2)} "${match.matchDesc}"`);
      });
    }
  }
  
  console.log("\n" + "=".repeat(100));
  console.log("END OF AUDIT\n");
}

// Main
const args = process.argv.slice(2);
const uid = args[0];

if (!uid) {
  console.error("Usage: npx tsx --env-file=.env.local scripts/audit-flexline-0085.ts <uid>");
  process.exit(1);
}

auditFlexLine(uid).catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
