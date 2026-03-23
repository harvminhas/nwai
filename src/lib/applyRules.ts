import type { ParsedStatementData, ExpenseCategory } from "./types";

/** Stable key for a merchant name used as Firestore doc ID and rule lookup. */
export function merchantSlug(merchant: string): string {
  return merchant
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

// ── Well-known merchant lookup ────────────────────────────────────────────────
// Pattern matched against the normalized (lowercase, spaces→hyphens) merchant name.
// Priority: user rules > known merchants > AI category.

const KNOWN_MERCHANT_PATTERNS: { pattern: RegExp; category: string }[] = [
  // ── Dining ─────────────────────────────────────────────────────────────────
  { pattern: /tim.?horton/,           category: "Dining" },
  { pattern: /mcdonald/,             category: "Dining" },
  { pattern: /starbucks/,            category: "Dining" },
  { pattern: /subway/,               category: "Dining" },
  { pattern: /harvey.?s/,            category: "Dining" },
  { pattern: /a.?w.?(canada|rest)/,  category: "Dining" },
  { pattern: /burger.?king/,         category: "Dining" },
  { pattern: /wendy.?s/,             category: "Dining" },
  { pattern: /pizza.?hut/,           category: "Dining" },
  { pattern: /domino/,               category: "Dining" },
  { pattern: /swiss.?chalet/,        category: "Dining" },
  { pattern: /boston.?pizza/,        category: "Dining" },
  { pattern: /jack.?astor/,          category: "Dining" },
  { pattern: /east.?side.?mario/,    category: "Dining" },
  { pattern: /popeyes/,              category: "Dining" },
  { pattern: /kfc/,                  category: "Dining" },
  { pattern: /taco.?bell/,           category: "Dining" },
  { pattern: /five.?guys/,           category: "Dining" },
  { pattern: /chipotle/,             category: "Dining" },
  { pattern: /panera/,               category: "Dining" },
  { pattern: /dairy.?queen/,         category: "Dining" },
  { pattern: /baskin.?robbins/,      category: "Dining" },
  { pattern: /second.?cup/,          category: "Dining" },
  { pattern: /tim.?horton/,          category: "Dining" },
  { pattern: /freshii/,              category: "Dining" },
  { pattern: /mucho.?burrito/,       category: "Dining" },
  { pattern: /the.?keg/,             category: "Dining" },
  { pattern: /montana/,              category: "Dining" },
  { pattern: /cactus.?club/,         category: "Dining" },
  { pattern: /earls/,                category: "Dining" },
  { pattern: /joey.?rest/,           category: "Dining" },
  { pattern: /moxie/,                category: "Dining" },
  { pattern: /scores/,               category: "Dining" },
  { pattern: /st.?hubert/,           category: "Dining" },
  { pattern: /pita.?pit/,            category: "Dining" },
  { pattern: /manchu.?wok/,          category: "Dining" },
  { pattern: /new.?york.?fries/,     category: "Dining" },
  { pattern: /mr.?sub/,              category: "Dining" },
  { pattern: /sobremesa/,            category: "Dining" },
  { pattern: /uber.?eat/,            category: "Dining" },
  { pattern: /doordash/,             category: "Dining" },
  { pattern: /skip.?the.?dish/,      category: "Dining" },
  { pattern: /grubhub/,              category: "Dining" },
  { pattern: /instacart/,            category: "Groceries" },

  // ── Groceries ──────────────────────────────────────────────────────────────
  { pattern: /loblaws/,              category: "Groceries" },
  { pattern: /no.?frills/,           category: "Groceries" },
  { pattern: /real.?canadian.?super/, category: "Groceries" },
  { pattern: /real.?cdn.?super/,     category: "Groceries" },
  { pattern: /metro.?(inc|store|on|grocery)/i, category: "Groceries" },
  { pattern: /sobeys/,               category: "Groceries" },
  { pattern: /freshco/,              category: "Groceries" },
  { pattern: /food.?basics/,         category: "Groceries" },
  { pattern: /farm.?boy/,            category: "Groceries" },
  { pattern: /t.?t.?supermarket/,    category: "Groceries" },
  { pattern: /iga\b/,                category: "Groceries" },
  { pattern: /save.?on.?food/,       category: "Groceries" },
  { pattern: /superstore/,           category: "Groceries" },
  { pattern: /valumart/,             category: "Groceries" },
  { pattern: /fortino/,              category: "Groceries" },
  { pattern: /zehrs/,                category: "Groceries" },
  { pattern: /maxi\b/,               category: "Groceries" },
  { pattern: /provigo/,              category: "Groceries" },
  { pattern: /independent.?grocer/,  category: "Groceries" },
  { pattern: /whole.?food/,          category: "Groceries" },
  { pattern: /trader.?joe/,          category: "Groceries" },
  { pattern: /sprouts/,              category: "Groceries" },
  { pattern: /bulk.?barn/,           category: "Groceries" },

  // ── Transportation / Fuel ──────────────────────────────────────────────────
  { pattern: /petro.?canada/,        category: "Transportation" },
  { pattern: /esso/,                 category: "Transportation" },
  { pattern: /shell/,                category: "Transportation" },
  { pattern: /ultramar/,             category: "Transportation" },
  { pattern: /pioneer.?gas/,         category: "Transportation" },
  { pattern: /sunoco/,               category: "Transportation" },
  { pattern: /husky/,                category: "Transportation" },
  { pattern: /irving.?oil/,          category: "Transportation" },
  { pattern: /go.?transit/,          category: "Transportation" },
  { pattern: /ttc\b/,                category: "Transportation" },
  { pattern: /presto.?card/,         category: "Transportation" },
  { pattern: /uber\b/,               category: "Transportation" },
  { pattern: /lyft/,                 category: "Transportation" },
  { pattern: /parking/,              category: "Transportation" },
  { pattern: /sp.?plus.?corp/,       category: "Transportation" },
  { pattern: /impark/,               category: "Transportation" },
  { pattern: /greenp.?parking/,      category: "Transportation" },
  { pattern: /enterprise.?rent/,     category: "Transportation" },
  { pattern: /hertz/,                category: "Transportation" },
  { pattern: /budget.?car/,          category: "Transportation" },
  { pattern: /avis/,                 category: "Transportation" },

  // ── Shopping ───────────────────────────────────────────────────────────────
  { pattern: /amazon\b/,             category: "Shopping" },
  { pattern: /amzn/,                 category: "Shopping" },
  { pattern: /walmart/,              category: "Shopping" },
  { pattern: /costco/,               category: "Shopping" },
  { pattern: /canadian.?tire/,       category: "Shopping" },
  { pattern: /home.?depot/,          category: "Shopping" },
  { pattern: /ikea/,                 category: "Shopping" },
  { pattern: /best.?buy/,            category: "Shopping" },
  { pattern: /the.?bay\b/,           category: "Shopping" },
  { pattern: /hudson.?bay/,          category: "Shopping" },
  { pattern: /winners/,              category: "Shopping" },
  { pattern: /homesense/,            category: "Shopping" },
  { pattern: /marshalls/,            category: "Shopping" },
  { pattern: /tjmaxx/,               category: "Shopping" },
  { pattern: /chapters/,             category: "Shopping" },
  { pattern: /indigo/,               category: "Shopping" },
  { pattern: /sport.?chek/,          category: "Shopping" },
  { pattern: /marks.?work/,          category: "Shopping" },
  { pattern: /reitmans/,             category: "Shopping" },
  { pattern: /old.?navy/,            category: "Shopping" },
  { pattern: /gap\b/,                category: "Shopping" },
  { pattern: /h.?m\b/,               category: "Shopping" },
  { pattern: /zara/,                 category: "Shopping" },
  { pattern: /uniqlo/,               category: "Shopping" },
  { pattern: /roots\b/,              category: "Shopping" },
  { pattern: /lululemon/,            category: "Shopping" },
  { pattern: /apple.?store/,         category: "Shopping" },
  { pattern: /dollarama/,            category: "Shopping" },
  { pattern: /dollar.?tree/,         category: "Shopping" },
  { pattern: /staples/,              category: "Shopping" },
  { pattern: /officemax/,            category: "Shopping" },
  { pattern: /rona\b/,               category: "Shopping" },
  { pattern: /lowes/,                category: "Shopping" },

  // ── Entertainment ──────────────────────────────────────────────────────────
  { pattern: /cineplex/,             category: "Entertainment" },
  { pattern: /landmark.?cinema/,     category: "Entertainment" },
  { pattern: /scotiabank.?arena/,    category: "Entertainment" },
  { pattern: /rogers.?centre/,       category: "Entertainment" },
  { pattern: /acc\b/,                category: "Entertainment" },
  { pattern: /ritz.?carlton/,        category: "Entertainment" },
  { pattern: /ticketmaster/,         category: "Entertainment" },
  { pattern: /stubhub/,              category: "Entertainment" },
  { pattern: /eventbrite/,           category: "Entertainment" },
  { pattern: /steam\b/,              category: "Entertainment" },
  { pattern: /playstation/,          category: "Entertainment" },
  { pattern: /xbox/,                 category: "Entertainment" },
  { pattern: /nintendo/,             category: "Entertainment" },

  // ── Healthcare ─────────────────────────────────────────────────────────────
  { pattern: /shoppers.?drug/,       category: "Healthcare" },
  { pattern: /rexall/,               category: "Healthcare" },
  { pattern: /pharma.?plus/,         category: "Healthcare" },
  { pattern: /jean.?coutu/,          category: "Healthcare" },
  { pattern: /uniprix/,              category: "Healthcare" },
  { pattern: /pharmasave/,           category: "Healthcare" },
  { pattern: /medical.?centre/,      category: "Healthcare" },
  { pattern: /dental/,               category: "Healthcare" },
  { pattern: /optometri/,            category: "Healthcare" },
  { pattern: /physio/,               category: "Healthcare" },
  { pattern: /chiropractic/,         category: "Healthcare" },

  // ── Housing / Utilities ────────────────────────────────────────────────────
  { pattern: /hydro.?one/,           category: "Housing" },
  { pattern: /toronto.?hydro/,       category: "Housing" },
  { pattern: /enbridge/,             category: "Housing" },
  { pattern: /union.?gas/,           category: "Housing" },
  { pattern: /rogers\b/,             category: "Housing" },
  { pattern: /bell\b/,               category: "Housing" },
  { pattern: /telus/,                category: "Housing" },
  { pattern: /shaw\b/,               category: "Housing" },
  { pattern: /videotron/,            category: "Housing" },
  { pattern: /cogeco/,               category: "Housing" },
  { pattern: /fido\b/,               category: "Housing" },
  { pattern: /koodo/,                category: "Housing" },
  { pattern: /virgin.?mobile/,       category: "Housing" },
  { pattern: /public.?mobile/,       category: "Housing" },
  { pattern: /wind.?mobile/,         category: "Housing" },
  { pattern: /freedom.?mobile/,      category: "Housing" },
];

/**
 * Look up a well-known merchant category by name.
 * Returns undefined if not in the table (AI category is used instead).
 */
export function knownMerchantCategory(merchant: string): string | undefined {
  const normalized = merchant.toLowerCase();
  for (const { pattern, category } of KNOWN_MERCHANT_PATTERNS) {
    if (pattern.test(normalized)) return category;
  }
  return undefined;
}

/**
 * Apply a map of { merchantSlug → category } rules to all expense transactions,
 * then re-aggregate expense categories and totals from the updated transactions.
 *
 * Priority: user rules > known merchant lookup > AI-assigned category.
 */
export function applyRulesAndRecalculate(
  data: ParsedStatementData,
  rules: Map<string, string>
): ParsedStatementData {
  const transactions = (data.expenses?.transactions ?? []).map((tx) => ({
    ...tx,
    category:
      rules.get(merchantSlug(tx.merchant)) ??        // 1. user rule
      knownMerchantCategory(tx.merchant) ??           // 2. known brand lookup
      tx.category,                                    // 3. AI-assigned
  }));

  // Re-aggregate categories from updated transactions
  const categoryMap = new Map<string, number>();
  for (const tx of transactions) {
    const key = tx.category || "Other";
    categoryMap.set(key, (categoryMap.get(key) ?? 0) + tx.amount);
  }

  const total = transactions.reduce((s, tx) => s + tx.amount, 0);
  const categories: ExpenseCategory[] = Array.from(categoryMap.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([name, amount]) => ({
      name,
      amount,
      percentage: total > 0 ? Math.round((amount / total) * 100) : 0,
    }));

  // Recalculate savings rate with new expense total
  const incomeTotal = data.income?.total ?? 0;
  const savingsRate =
    incomeTotal > 0 ? Math.round(((incomeTotal - total) / incomeTotal) * 100) : data.savingsRate;

  return {
    ...data,
    expenses: { ...data.expenses, transactions, categories, total },
    savingsRate,
  };
}
