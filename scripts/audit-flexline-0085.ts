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
  
  // Get all statements for this user
  const statementsSnap = await db
    .collection(`statements`)
    .where("uid", "==", uid)
    .where("status", "==", "completed")
    .get();

  if (statementsSnap.empty) {
    console.log("❌ No statements found for this user");
    return;
  }

  // Filter to FlexLine account (slug ending 0085)
  const flexLineStatements = statementsSnap.docs
    .map(doc => ({
      id: doc.id,
      ...doc.data(),
    }))
    .filter((stmt: any) => {
      const accountSlug = stmt.parsedData?.accountSlug || "";
      return accountSlug.endsWith("0085");
    })
    .sort((a: any, b: any) => {
      const aMonth = a.parsedData?.statementMonth || "";
      const bMonth = b.parsedData?.statementMonth || "";
      return aMonth.localeCompare(bMonth);
    });

  if (flexLineStatements.length === 0) {
    console.log("❌ No statements found for FlexLine account ending 0085");
    return;
  }

  console.log(`Found ${flexLineStatements.length} FlexLine statements\n`);

  // Get all statements for cross-account transfer matching
  const allStatements = statementsSnap.docs.map(doc => ({
    id: doc.id,
    ...doc.data(),
  }));

  // Analyze each month
  const monthlyData: MonthlyAnalysis[] = [];
  let previousClosing: number | null = null;

  for (const stmt of flexLineStatements) {
    const parsed = stmt.parsedData;
    if (!parsed) continue;

    const month = parsed.statementMonth;
    const closingBalance = Math.abs(parsed.closingBalance || 0);
    const openingBalance = previousClosing !== null ? previousClosing : Math.abs(parsed.openingBalance || closingBalance);
    
    // Extract financial data
    const paymentsIn = parsed.paymentsMade || 0;
    
    // Draws are expenses (negative amounts on a debt account)
    const expenses = parsed.expenses || [];
    const draws = expenses
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
    const interest = expenses
      .filter((e: any) => {
        const cat = (e.category || "").toLowerCase();
        const desc = (e.merchant || "").toLowerCase();
        return cat.includes("fees") || desc.includes("interest") || desc.includes("int chg");
      })
      .reduce((sum: number, e: any) => sum + Math.abs(e.amount), 0);
    
    // Fees (excluding interest)
    const fees = expenses
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
        const deposits = otherParsed.income || [];
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
      data.month.padEnd(10) +
      `$${data.openingBalance.toFixed(2)}`.padStart(12) +
      `$${data.closingBalance.toFixed(2)}`.padStart(12) +
      `$${data.paymentsIn.toFixed(2)}`.padStart(12) +
      `$${data.draws.toFixed(2)}`.padStart(12) +
      `$${data.interest.toFixed(2)}`.padStart(10) +
      `$${data.fees.toFixed(2)}`.padStart(10) +
      (data.reconciles ? "✓" : "✗").padStart(8) +
      `$${data.reconciliationError.toFixed(2)}`.padStart(10)
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
