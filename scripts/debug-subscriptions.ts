/**
 * Debug Subscription Synthesis
 * 
 * Diagnoses why manually marked subscriptions don't appear in the Subscriptions tab.
 * 
 * Usage:
 *   npx tsx --env-file=.env.local scripts/debug-subscriptions.ts <uid>
 */

import { getFirebaseAdmin } from "../src/lib/firebase-admin";
import { getFinancialProfile } from "../src/lib/financialProfile";
import { buildSubscriptionSummary } from "../src/lib/subscriptionEngine";
import { synthesizeSubscriptions } from "../src/lib/subscriptionSynthesis";
import { merchantSlug as merchantSlugFn } from "../src/lib/applyRules";

async function debugSubscriptions(uid: string) {
  console.log("=".repeat(80));
  console.log("SUBSCRIPTION SYNTHESIS DEBUG");
  console.log("=".repeat(80));
  console.log(`User: ${uid}\n`);

  const { db } = getFirebaseAdmin();
  
  // Load financial profile
  console.log("Loading financial profile...");
  const profile = await getFinancialProfile(uid, db);
  console.log(`✓ Loaded ${profile.expenseTxns.length} expense transactions\n`);
  
  // Load subscription reviews
  console.log("Loading subscription reviews...");
  const subReviewsSnap = await db
    .collection(`users/${uid}/reviews`)
    .where("type", "==", "subscription")
    .get();
  
  console.log(`✓ Found ${subReviewsSnap.docs.length} subscription reviews\n`);
  
  if (subReviewsSnap.docs.length === 0) {
    console.log("No subscription reviews found. User hasn't marked any merchants as subscriptions.\n");
    return;
  }
  
  // Parse reviews
  console.log("Subscription Reviews:");
  console.log("-".repeat(80));
  
  const userConfirmedSlugs: string[] = [];
  const excludedSlugs = new Set<string>();
  const stillActiveSlugs = new Set<string>();
  const cancelledSlugs = new Set<string>();
  const billingFrequencyOverrides = new Map<string, import("../src/lib/reviewTypes").BillingFrequency>();
  
  subReviewsSnap.docs.forEach(doc => {
    const classification = doc.get("classification");
    const merchantSlug = doc.get("merchantSlug") || doc.id;
    const billingFrequency = doc.get("billingFrequency");
    const date = doc.get("date");
    const amount = doc.get("amount");
    
    console.log(`  ID: ${doc.id}`);
    console.log(`  merchantSlug: ${merchantSlug}`);
    console.log(`  classification: ${classification}`);
    if (billingFrequency) console.log(`  billingFrequency: ${billingFrequency}`);
    if (date) console.log(`  date: ${date}`);
    if (amount) console.log(`  amount: ${amount}`);
    console.log();
    
    if (classification === "is_subscription") {
      userConfirmedSlugs.push(merchantSlug);
    } else if (classification === "not_subscription") {
      excludedSlugs.add(merchantSlug);
    } else if (classification === "still_active") {
      userConfirmedSlugs.push(merchantSlug);
      stillActiveSlugs.add(merchantSlug);
    } else if (classification === "cancelled") {
      cancelledSlugs.add(merchantSlug);
    }
    
    if (billingFrequency) {
      billingFrequencyOverrides.set(merchantSlug, billingFrequency);
    }
  });
  
  console.log("Summary:");
  console.log(`  User-confirmed (is_subscription + still_active): ${userConfirmedSlugs.length}`);
  console.log(`  Excluded (not_subscription): ${excludedSlugs.size}`);
  console.log(`  Cancelled: ${cancelledSlugs.size}\n`);
  
  // Filter excluded merchants
  const filteredExpenseTxns = profile.expenseTxns.filter(txn => {
    const slug = merchantSlugFn(txn.merchant);
    return !excludedSlugs.has(slug);
  });
  
  // Run engine detection
  console.log("Running subscription engine...");
  const summary = buildSubscriptionSummary(
    filteredExpenseTxns,
    profile.homeCurrency,
    undefined,
    userConfirmedSlugs,
    billingFrequencyOverrides
  );
  
  console.log(`✓ Engine detected ${summary.subscriptions.length} confirmed, ${summary.candidates.length} candidates, ${summary.inactive.length} inactive\n`);
  
  // Check each is_subscription slug
  console.log("Checking each is_subscription slug:");
  console.log("-".repeat(80));
  
  const allDetectedSlugs = new Set([
    ...summary.subscriptions.map(s => s.merchantSlug),
    ...summary.candidates.map(s => s.merchantSlug),
    ...summary.inactive.map(s => s.merchantSlug),
  ]);
  
  userConfirmedSlugs.forEach(slug => {
    console.log(`\nSlug: "${slug}"`);
    
    // Check if detected
    const wasDetected = allDetectedSlugs.has(slug);
    console.log(`  Detected by engine: ${wasDetected ? "YES" : "NO"}`);
    
    if (wasDetected) {
      const sub = [...summary.subscriptions, ...summary.candidates, ...summary.inactive].find(s => s.merchantSlug === slug);
      if (sub) {
        console.log(`  Tier: ${sub.tier}, Status: ${sub.status}`);
        console.log(`  Merchant: ${sub.merchant}`);
        console.log(`  Amount: ${sub.amount} ${profile.homeCurrency}`);
        console.log(`  Charge count: ${sub.chargeCount}`);
      }
    }
    
    // Find matching transactions
    const matchingTxns = profile.expenseTxns.filter(txn => {
      const txnSlug = merchantSlugFn(txn.merchant);
      return txnSlug === slug;
    });
    
    console.log(`  Matching transactions in profile.expenseTxns: ${matchingTxns.length}`);
    
    if (matchingTxns.length > 0) {
      console.log(`  Sample transaction fields:`);
      const sample = matchingTxns[0];
      console.log(`    merchant: "${sample.merchant}"`);
      console.log(`    merchantSlug (computed): "${merchantSlugFn(sample.merchant)}"`);
      console.log(`    category: "${sample.category}"`);
      console.log(`    amount: ${sample.amount}`);
      console.log(`    date: ${sample.date}`);
      
      if (matchingTxns.length <= 5) {
        console.log(`  All transactions:`);
        matchingTxns.forEach(t => {
          console.log(`    ${t.date}: ${t.amount} ${profile.homeCurrency} - ${t.merchant}`);
        });
      } else {
        console.log(`  Most recent 5:`);
        matchingTxns.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5).forEach(t => {
          console.log(`    ${t.date}: ${t.amount} ${profile.homeCurrency} - ${t.merchant}`);
        });
      }
    } else {
      console.log(`  ⚠️  NO MATCHING TRANSACTIONS FOUND`);
      console.log(`  This slug won't synthesize without transaction data.`);
      
      // Show similar slugs to help debug
      const allSlugs = new Set(profile.expenseTxns.map(t => merchantSlugFn(t.merchant)));
      const similarSlugs = Array.from(allSlugs).filter(s => 
        s.includes(slug.slice(0, 5)) || slug.includes(s.slice(0, 5))
      );
      
      if (similarSlugs.length > 0) {
        console.log(`  Similar slugs in transactions: ${similarSlugs.slice(0, 5).join(", ")}`);
      }
    }
  });
  
  // Run synthesis
  console.log("\n" + "=".repeat(80));
  console.log("SYNTHESIS RESULTS");
  console.log("=".repeat(80) + "\n");
  
  const synthesizedSubs = synthesizeSubscriptions(
    userConfirmedSlugs,
    allDetectedSlugs,
    profile.expenseTxns,
    billingFrequencyOverrides
  );
  
  console.log(`Synthesized ${synthesizedSubs.length} subscriptions for undetected is_subscription slugs:\n`);
  
  if (synthesizedSubs.length === 0) {
    console.log("No subscriptions synthesized. Either:");
    console.log("  - All is_subscription slugs were already detected by the engine, OR");
    console.log("  - No matching transactions found for undetected slugs\n");
  } else {
    synthesizedSubs.forEach(sub => {
      console.log(`  ${sub.merchant}`);
      console.log(`    Slug: ${sub.merchantSlug}`);
      console.log(`    Amount: ${sub.amount} ${profile.homeCurrency}`);
      console.log(`    Cadence: ${sub.cadence}`);
      console.log(`    Billing frequency: ${sub.billingFrequency || "none"}`);
      console.log(`    Charges: ${sub.chargeCount}`);
      console.log(`    Last: ${sub.lastDate}, Next: ${sub.nextDate || "unknown"}`);
      console.log(`    Tier: ${sub.tier}, Status: ${sub.status}\n`);
    });
  }
  
  // Final summary (matching API route logic)
  console.log("=".repeat(80));
  console.log("FINAL OUTPUT (what /api/user/subscriptions would return)");
  console.log("=".repeat(80) + "\n");
  
  // Match API route: ALL confirmed subscriptions stay active (engine-confirmed or user-confirmed)
  const cancelled = summary.inactive.filter(s => cancelledSlugs.has(s.merchantSlug));
  const inactive = summary.inactive.filter(s => !cancelledSlugs.has(s.merchantSlug));
  const confirmedInactive = inactive.filter(s => s.tier === "confirmed");
  
  const finalConfirmedActive = [
    ...summary.subscriptions,
    ...confirmedInactive, // ALL confirmed items from inactive list
    ...synthesizedSubs,
  ];
  
  const finalInactive: any[] = []; // Empty - only cancelled items go here
  
  console.log(`Total confirmed active subscriptions: ${finalConfirmedActive.length}`);
  console.log(`  From engine (naturally active): ${summary.subscriptions.length}`);
  console.log(`  Confirmed (was inactive): ${confirmedInactive.length}`);
  console.log(`  Synthesized: ${synthesizedSubs.length}\n`);
  
  if (finalConfirmedActive.length > 0) {
    console.log("Active list:");
    finalConfirmedActive.forEach(sub => {
      const noRecentStr = sub.noRecentCharge ? " [NO RECENT CHARGE]" : "";
      const cadenceStr = sub.cadence === "yearly" ? "yearly" : sub.cadence === "monthly" ? "monthly" : "ambig";
      const tierStr = sub.tier === "confirmed" ? "confirmed" : "candidate";
      console.log(`  - ${sub.merchant} (${sub.merchantSlug})`);
      console.log(`    Amount: ${sub.amount} ${profile.homeCurrency}, Cadence: ${cadenceStr}, Tier: ${tierStr}, Last: ${sub.lastDate}${noRecentStr}`);
    });
  }
  
  console.log(`\nInactive (cancelled only): ${cancelled.length}`);
  if (cancelled.length > 0) {
    cancelled.forEach(sub => {
      console.log(`  - ${sub.merchant} (${sub.merchantSlug})`);
    });
  }
  
  // Merge suggestions (over ALL detected subscriptions, not just active)
  console.log("\n" + "=".repeat(80));
  console.log("MERGE SUGGESTIONS");
  console.log("=".repeat(80) + "\n");
  
  const { findMergeSuggestions } = await import("../src/lib/merchantSimilarity");
  
  // Run over all detected subscriptions (active, candidates, inactive) to catch split variants
  const allDetected = [
    ...finalConfirmedActive,
    ...summary.candidates,
    ...finalInactive,
  ];
  
  const groups = findMergeSuggestions(allDetected);
  
  console.log(`Found ${groups.length} merge suggestion groups:\n`);
  
  if (groups.length === 0) {
    console.log("  No merge suggestions (all merchants are distinct)\n");
  } else {
    groups.forEach((group, i) => {
      console.log(`Group ${i + 1}: ${group.length} similar merchants`);
      group.forEach(sub => {
        console.log(`  - ${sub.merchant} (${sub.merchantSlug}): ${sub.amount} ${profile.homeCurrency}`);
      });
      const totalMonthly = group.reduce((sum, sub) => {
        if (sub.billingFrequency === "yearly" || (!sub.billingFrequency && sub.cadence === "yearly")) {
          return sum + (sub.amount / 12);
        }
        return sum + sub.amount;
      }, 0);
      console.log(`  Combined monthly: ${totalMonthly.toFixed(2)} ${profile.homeCurrency}\n`);
    });
  }
  
  console.log("=".repeat(80));
}

// Main
const args = process.argv.slice(2);
const uid = args[0];

if (!uid) {
  console.error("Usage: npx tsx --env-file=.env.local scripts/debug-subscriptions.ts <uid>");
  process.exit(1);
}

debugSubscriptions(uid).catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
