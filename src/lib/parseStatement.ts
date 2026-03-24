import type { ParsedStatementData } from "./types";
import { sendVisionRequest, sendPdfRequest, sendTextRequest } from "./ai";

const SYSTEM_PROMPT = `You are a financial analysis expert. Analyze this bank statement and extract structured data.

**Instructions:**
1. Extract the account details:
   - bankName: the name of the bank or financial institution
   - accountId: the masked account number as shown on the statement (e.g. "••••1234" or "****5678"). Use the last 4 digits if shown. If not present, use "unknown".
   - accountName: the account product name or nickname shown on the statement (e.g. "Chase Sapphire Reserve", "Everyday Savings", "Home Mortgage"). If not present, infer from context.
   - accountType: classify as exactly one of: "checking", "savings", "credit", "mortgage", "investment", "loan", "other"
   - interestRate: the annual interest or return rate as a plain number (e.g. 4.25 for 4.25%). For debt accounts extract the APR/interest rate shown. For savings/investment accounts extract the APY/annual return shown. If no rate is stated anywhere on the statement, return null.

2. Extract the total balance as "netWorth":
   - For asset accounts (checking, savings, investment): use the closing/ending balance as a POSITIVE number.
   - For debt accounts (credit, mortgage, loan, HELOC, line of credit): use the total outstanding balance as a NEGATIVE number.
   - IMPORTANT — Multi-segment statements (e.g. TD Home Equity FlexLine, Scotia Total Equity Plan, or any combined mortgage + line of credit product): these contain multiple sub-accounts (e.g. a revolving portion AND one or more term/fixed portions). You MUST sum ALL sub-account closing/principal balances together as one total debt. Example: revolving $34,717 + term 1 $444,469 + term 2 $37,805 = total −$517,991. Do NOT report only one segment.
   - Also set "assets" and "debts" explicitly:
     - For asset accounts: assets = closing balance, debts = 0
     - For debt accounts: assets = 0, debts = total outstanding balance (positive number)

3. Identify transactions if present (date, description, amount).
   - CRITICAL: List EVERY transaction individually. Do NOT deduplicate, merge, or omit repeated payees. If the same employer pays twice in a month, list both entries separately.
   - For mortgage/loan/investment statements with no consumer transactions, skip steps 3–6 and return empty arrays/zeros for income, expenses, subscriptions, and savingsRate.
3b. For checking/savings accounts, also extract income.transactions as a flat list of every individual deposit/credit:
   - description: clean human-readable label (e.g. "Acme Corp — payroll", "Cash / Deposit", "Rental Income")
   - amount: deposit amount (positive)
   - date: ISO YYYY-MM-DD
   - source: which income source category this belongs to (must match one of the descriptions in income.sources)
   - CRITICAL: list every deposit individually — two salary deposits = two entries
   - For credit/mortgage/loan/investment: return []
4. For checking, savings, and credit accounts — classify each debit/credit:
   INCOME (credits into the account):
   - Salary, wages, ANY deposit or credit, transfers in, government payments (e.g. "GC DEPOSIT", "CRA", "CANADA", "GST", "OAS", "CPP", "EI", "CERB"), employer payroll, freelance payments, e-transfers received.
   - When in doubt, if money is coming IN to the account, it is Income.
   - Use a clean human-readable description:
     * Identifiable employer/payroll → use the employer name (e.g. "MAM PAY" → "MAM Pay")
     * E-transfers, generic deposits, government payments, GC deposits, CRA → use "Cash / Deposit"
     * Do NOT use raw transaction codes, account numbers, or cryptic strings.

   EXPENSES (debits out of the account):

   *** EXCLUDE ENTIRELY (do NOT add to expenses.transactions or expenses.total) ***
   - Credit card payments: any transaction that is clearly a payment TO a credit card (e.g. "VISA PAYMENT", "MASTERCARD PMT", "AMEX PAYMENT", "TD CREDIT CARD", "CIBC VISA", "PAYMENT - MASTERCARD", or similar). These purchases are already captured in the credit card statement — including them here is double-counting.
   - Loan / mortgage repayments: payments reducing a loan or mortgage balance. The balance is already tracked separately.
   - Transfers between your own accounts: moving money from chequing to savings or vice versa.

   *** INCLUDE as expenses (categorize below) ***
   - Housing: Rent, utilities (hydro, gas, internet, phone), home insurance, condo fees
   - Dining: Restaurants, food delivery, coffee shops
   - Groceries: Grocery stores, supermarkets, bulk food stores
   - Shopping: Retail, online shopping, clothing, electronics
   - Transportation: Gas, Uber/Lyft, transit, parking, car payment to a dealer/lender
   - Entertainment: Streaming, movies, events, hobbies, sports
   - Subscriptions: Any recurring monthly charge (Netflix, Spotify, gym, etc.)
   - Healthcare: Medical, pharmacy, dental, insurance premiums
   - Transfers & Payments: E-transfers sent to individuals or businesses for goods/services (e.g. rent paid via Interac e-transfer, paying a contractor). Do NOT use this for credit card payments or bank-to-bank transfers.
   - Cash & ATM: ATM withdrawals, cash advances
   - Other: Any other real spending not covered above

   CRITICAL: Do NOT include credit card payments, loan payments, or own-account transfers in expenses under any category.
5. For each expense transaction, also populate expenses.transactions as a flat list:
   - merchant: clean, human-readable merchant name (e.g. "Amazon", "Tim Hortons", "Netflix"). Strip codes, terminal IDs, trailing numbers.
   - amount: transaction amount (positive number)
   - date: transaction date in ISO format YYYY-MM-DD (extract from statement — do NOT omit)
   - category: one of the category names from step 4
   - recurring: ONLY include this field when you are confident the charge recurs on a fixed schedule. Use exactly one of: "weekly", "biweekly", "monthly", "quarterly", "annual". Examples: "Annual Fee" → "annual", "Netflix" → "monthly", "Spotify" → "monthly", "car insurance" paid quarterly → "quarterly". Omit the field entirely for one-time or ambiguous charges.
   - CRITICAL: list every individual expense transaction — do NOT deduplicate or aggregate. Two visits to Tim Hortons = two entries.
   - For mortgage/loan/investment: return [].
6. Detect subscriptions (recurring charges, same amount monthly).
   - For credit accounts: include subscriptions found in transactions (e.g. Netflix, Spotify).
   - For mortgage/loan/investment accounts: return [].
6b. For credit card, loan, and mortgage accounts — extract "paymentsMade":
   - paymentsMade: the total amount of payments received toward this account's balance during the statement period (e.g. the monthly credit card payment, mortgage payment, or loan payment credited to the account).
   - This is NOT income. It represents debt repayment made from a chequing/savings account. Tracking it separately allows the system to cancel the matching outgoing transfer in the bank account and avoid double-counting.
   - If no payment was received this period, set paymentsMade to 0.
   - For checking/savings/investment accounts: omit paymentsMade (or set to 0).
7. Calculate:
   - For checking/savings only: total income = sum of ALL individual income entries (do not deduplicate). Every credit/deposit to the account must appear in income.sources. total expenses = sum of ALL individual expense entries, savings rate = (income - expenses) / income
   - For credit accounts: total expenses only; set income = 0, savingsRate = 0; populate paymentsMade
   - For mortgage/loan: all expenses/income return 0; populate paymentsMade
   - For investment: all return 0
8. Generate up to 4 personalized insights relevant to the account type:
   - For mortgage/loan: focus on interest rate, payoff timeline, equity building, overpayment opportunities
   - For investment: focus on growth, diversification, contribution rate
   - For checking/savings/credit: focus on spending patterns, savings opportunities, subscriptions

**Return JSON only, no markdown or explanation, in this exact structure.**

For a mortgage/loan (income, expenses, subscriptions will be empty; paymentsMade = the payment credited this period):
{
  "netWorth": -517991.36,
  "assets": 0,
  "debts": 517991.36,
  "statementDate": "2026-01-31",
  "bankName": "TD Bank",
  "accountId": "••••0085",
  "accountName": "TD Home Equity FlexLine",
  "accountType": "mortgage",
  "interestRate": 3.9,
  "income": { "total": 0, "sources": [] },
  "expenses": { "total": 0, "categories": [] },
  "paymentsMade": 2500.00,
  "subscriptions": [],
  "savingsRate": 0,
  "insights": [
    {
      "type": "debt_insight",
      "title": "Mortgage Interest This Month",
      "message": "You paid $2,002 in interest this month. At 3.9%, making one extra payment per year could save years off your mortgage.",
      "cta": "Calculate Overpayment Savings",
      "priority": "high"
    }
  ]
}

For a checking/savings/credit account:
{
  "netWorth": 7148.01,
  "assets": 7148.01,
  "debts": 0,
  "statementDate": "2026-02-27",
  "bankName": "TD Bank",
  "accountId": "••••3156",
  "accountName": "TD All Inclusive Banking Plan",
  "accountType": "checking",
  "interestRate": null,
  "income": {
    "total": 5200.00,
    "sources": [
      { "description": "Salary - Acme Corp", "amount": 4800.00 },
      { "description": "Freelance Payment", "amount": 400.00 }
    ],
    "transactions": [
      { "description": "Acme Corp — payroll", "amount": 2400.00, "date": "2026-02-01", "source": "Salary - Acme Corp" },
      { "description": "Acme Corp — payroll", "amount": 2400.00, "date": "2026-02-15", "source": "Salary - Acme Corp" },
      { "description": "Freelance Payment", "amount": 400.00, "date": "2026-02-10", "source": "Freelance Payment" }
    ]
  },
  "expenses": {
    "total": 3800.00,
    "categories": [
      { "name": "Housing", "amount": 1200.00, "percentage": 32 },
      { "name": "Dining", "amount": 680.00, "percentage": 18 },
      { "name": "Shopping", "amount": 450.00, "percentage": 12 },
      { "name": "Transportation", "amount": 320.00, "percentage": 8 },
      { "name": "Entertainment", "amount": 180.00, "percentage": 5 },
      { "name": "Other", "amount": 970.00, "percentage": 25 }
    ],
    "transactions": [
      { "merchant": "Rogers", "amount": 120.00, "date": "2026-02-03", "category": "Housing", "recurring": "monthly" },
      { "merchant": "Annual Fee", "amount": 139.00, "date": "2026-02-03", "category": "Subscriptions", "recurring": "annual" },
      { "merchant": "Tim Hortons", "amount": 8.50, "date": "2026-02-05", "category": "Dining" },
      { "merchant": "Tim Hortons", "amount": 6.75, "date": "2026-02-12", "category": "Dining" },
      { "merchant": "Amazon", "amount": 45.99, "date": "2026-02-14", "category": "Shopping" },
      { "merchant": "Netflix", "amount": 18.99, "date": "2026-02-01", "category": "Entertainment", "recurring": "monthly" }
    ],
    "_note": "VISA PAYMENT $3200 on 2026-02-28 is NOT included above — it is a credit card payment and would double-count spending already captured in the credit card statement."
  },
  "paymentsMade": 0,
  "subscriptions": [
    { "name": "Netflix", "amount": 15.99, "frequency": "monthly" },
    { "name": "Spotify", "amount": 10.99, "frequency": "monthly" }
  ],
  "savingsRate": 27,
  "insights": [
    {
      "type": "spending_alert",
      "title": "High Dining Spend",
      "message": "You spent 13% of income on dining ($680). Reducing by 25% could save $2,160/year.",
      "cta": "Get Meal Planning Tips",
      "priority": "high"
    },
    {
      "type": "savings_opportunity",
      "title": "HYSA Opportunity",
      "message": "Your balance earns ~1%. Move to 5% HYSA for more.",
      "cta": "See Best HYSA Rates",
      "ctaUrl": "https://sofi.com/hysa?ref=networth",
      "priority": "high"
    },
    {
      "type": "positive_reinforcement",
      "title": "Great Savings Rate!",
      "message": "At 27% savings rate, you're on track.",
      "cta": "Set a Savings Target",
      "priority": "medium"
    },
    {
      "type": "credit_card",
      "title": "Cash Back Opportunity",
      "message": "A 2% cash back card could save you money on dining.",
      "cta": "Compare Cards",
      "ctaUrl": "https://creditcards.chase.com?ref=networth",
      "priority": "medium"
    }
  ]
}`;

function extractJson(text: string): string {
  const trimmed = text.trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}") + 1;
  if (start === -1 || end === 0) return trimmed;
  return trimmed.slice(start, end);
}

function validateParsedData(data: unknown): data is ParsedStatementData {
  if (!data || typeof data !== "object") return false;
  const d = data as Record<string, unknown>;
  // Only hard-require the truly essential fields — everything else gets defaulted
  return (
    typeof d.netWorth === "number" &&
    typeof d.statementDate === "string" &&
    typeof d.bankName === "string"
  );
}

/** Fill in any missing optional fields so downstream code never crashes. */
function coerceDefaults(data: Record<string, unknown>): ParsedStatementData {
  const income = (data.income ?? {}) as Record<string, unknown>;
  const expenses = (data.expenses ?? {}) as Record<string, unknown>;
  return {
    netWorth: data.netWorth as number,
    assets: typeof data.assets === "number" ? data.assets : undefined,
    debts: typeof data.debts === "number" ? data.debts : undefined,
    statementDate: data.statementDate as string,
    bankName: data.bankName as string,
    accountId: typeof data.accountId === "string" ? data.accountId : undefined,
    accountName: typeof data.accountName === "string" ? data.accountName : undefined,
    accountType: (data.accountType as ParsedStatementData["accountType"]) ?? "other",
    interestRate: typeof data.interestRate === "number" ? data.interestRate : null,
    income: {
      total: typeof income.total === "number" ? income.total : 0,
      sources: Array.isArray(income.sources) ? income.sources : [],
      transactions: Array.isArray(income.transactions) ? income.transactions : [],
    },
    expenses: {
      total: typeof expenses.total === "number" ? expenses.total : 0,
      categories: Array.isArray(expenses.categories) ? expenses.categories : [],
      transactions: Array.isArray(expenses.transactions) ? expenses.transactions : [],
    },
    paymentsMade: typeof data.paymentsMade === "number" ? data.paymentsMade : 0,
    subscriptions: Array.isArray(data.subscriptions) ? data.subscriptions : [],
    savingsRate: typeof data.savingsRate === "number" ? data.savingsRate : 0,
    insights: Array.isArray(data.insights) ? data.insights : [],
  };
}

export async function parseStatementImage(
  imageBase64: string,
  mediaType: "image/png" | "image/jpeg" | "image/gif" | "image/webp"
): Promise<ParsedStatementData> {
  const raw = await sendVisionRequest(
    SYSTEM_PROMPT,
    "Analyze this bank statement image and return the JSON now.",
    imageBase64,
    mediaType
  );
  return parseJsonResponse(raw);
}

export async function parseStatementPdf(pdfBase64: string): Promise<ParsedStatementData> {
  const raw = await sendPdfRequest(
    SYSTEM_PROMPT,
    "Analyze this bank statement PDF and return the JSON now.",
    pdfBase64
  );
  return parseJsonResponse(raw);
}

const MAX_CSV_CHARS = 120_000;

export async function parseStatementCsv(csvText: string): Promise<ParsedStatementData> {
  const trimmed =
    csvText.length > MAX_CSV_CHARS
      ? csvText.slice(0, MAX_CSV_CHARS) + "\n\n[Truncated for length; analyze what is shown.]"
      : csvText;
  const userPrompt = `Below is CSV data (a transaction export from a bank). Infer net worth from ending balance or last row if present; otherwise estimate from transactions. Return the JSON now.

---CSV---
${trimmed}
---END---`;
  const raw = await sendTextRequest(SYSTEM_PROMPT, userPrompt);
  return parseJsonResponse(raw);
}

/**
 * Recalculate all derived numeric fields from their line items.
 * The AI often returns inconsistent totals/percentages — this is the
 * single source of truth before data is written to Firestore.
 */
function normalizeData(data: ParsedStatementData): ParsedStatementData {
  const sources = data.income?.sources ?? [];
  const categories = data.expenses?.categories ?? [];

  const incomeTotal = sources.reduce((s, x) => s + (x.amount ?? 0), 0);
  const expensesTotal = categories.reduce((s, x) => s + (x.amount ?? 0), 0);

  const normalizedCategories = categories.map((cat) => ({
    ...cat,
    percentage: incomeTotal > 0 ? Math.round((cat.amount / expensesTotal) * 100) : cat.percentage,
  }));

  const savingsRate =
    incomeTotal > 0 ? Math.round(((incomeTotal - expensesTotal) / incomeTotal) * 100) : 0;

  return {
    ...data,
    income: { sources, total: incomeTotal },
    expenses: {
      categories: normalizedCategories,
      total: expensesTotal,
      transactions: data.expenses?.transactions ?? [],
    },
    savingsRate,
  };
}

function parseJsonResponse(raw: string): ParsedStatementData {
  const jsonStr = extractJson(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (e) {
    console.error("AI response JSON parse failed. Raw (first 2000 chars):", raw.slice(0, 2000));
    throw new Error("AI returned invalid JSON: " + (e instanceof Error ? e.message : String(e)));
  }
  if (!validateParsedData(parsed)) {
    console.error("AI response failed schema validation. Parsed:", JSON.stringify(parsed).slice(0, 2000));
    throw new Error("AI response missing required fields (netWorth, statementDate, bankName)");
  }
  return normalizeData(coerceDefaults(parsed as unknown as Record<string, unknown>));
}
