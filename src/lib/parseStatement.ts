import type { ParsedStatementData } from "./types";
import { sendVisionRequest, sendPdfRequest, sendTextRequest } from "./ai";

const SYSTEM_PROMPT = `You are a financial analysis expert. Analyze this bank statement and extract structured data.

**Instructions:**
1. Extract the account details:
   - bankName: the name of the bank or financial institution
   - accountId: the masked account number as shown on the statement (e.g. "••••1234" or "****5678"). Use the last 4 digits if shown. If not present, use "unknown".
   - accountName: the account product name or nickname shown on the statement (e.g. "Chase Sapphire Reserve", "Everyday Savings", "Home Mortgage"). If not present, infer from context.
   - accountType: classify as exactly one of: "checking", "savings", "credit", "mortgage", "investment", "loan", "other"

2. Extract the total balance as "netWorth":
   - For asset accounts (checking, savings, investment): use the closing/ending balance as a POSITIVE number.
   - For debt accounts (credit, mortgage, loan, HELOC, line of credit): use the total outstanding balance as a NEGATIVE number.
   - IMPORTANT — Multi-segment statements (e.g. TD Home Equity FlexLine, Scotia Total Equity Plan, or any combined mortgage + line of credit product): these contain multiple sub-accounts (e.g. a revolving portion AND one or more term/fixed portions). You MUST sum ALL sub-account closing/principal balances together as one total debt. Example: revolving $34,717 + term 1 $444,469 + term 2 $37,805 = total −$517,991. Do NOT report only one segment.
   - Also set "assets" and "debts" explicitly:
     - For asset accounts: assets = closing balance, debts = 0
     - For debt accounts: assets = 0, debts = total outstanding balance (positive number)

3. Identify transactions if present (date, description, amount).
   - CRITICAL: List EVERY transaction individually. Do NOT deduplicate, merge, or omit repeated payees. If the same employer pays twice in a month, list both entries separately.
   - For mortgage/loan/investment statements with no consumer transactions, skip steps 3–6 and return empty arrays/zeros.
4. For checking, savings, and credit accounts — classify each debit/credit:
   INCOME (credits into the account):
   - Salary, wages, ANY deposit or credit, transfers in, government payments (e.g. "GC DEPOSIT", "CRA", "CANADA", "GST", "OAS", "CPP", "EI", "CERB"), employer payroll, freelance payments, e-transfers received.
   - When in doubt, if money is coming IN to the account, it is Income.
   - Use a clean human-readable description:
     * Identifiable employer/payroll → use the employer name (e.g. "MAM PAY" → "MAM Pay")
     * E-transfers, generic deposits, government payments, GC deposits, CRA → use "Cash / Deposit"
     * Do NOT use raw transaction codes, account numbers, or cryptic strings.

   EXPENSES (debits out of the account) — every debit MUST be categorized, no exceptions:
   - Housing: Rent, mortgage payments, utilities, home insurance
   - Dining: Restaurants, food delivery, coffee shops
   - Shopping: Retail, online shopping, Amazon, grocery stores
   - Transportation: Gas, Uber/Lyft, transit, parking, car payment
   - Entertainment: Streaming, movies, events, hobbies, sports
   - Subscriptions: Any recurring monthly charge (Netflix, Spotify, gym, etc.)
   - Healthcare: Medical, pharmacy, dental, insurance premiums
   - Transfers & Payments: Transfers to other accounts, credit card payments, bill payments, loan payments, interac transfers sent (e.g. "TFR-TO", "TRANSFER TO", "PAY TO", "IM200", "ONLINE TRANSFER")
   - Cash & ATM: ATM withdrawals, cash advances
   - Other: Any other debit not covered above
   
   CRITICAL: Do NOT skip any debit transaction. Every withdrawal, transfer out, payment, and ATM withdrawal must appear in expenses.transactions and be reflected in the category totals.
5. For each expense transaction, also populate expenses.transactions as a flat list:
   - merchant: clean, human-readable merchant name (e.g. "Amazon", "Tim Hortons", "Netflix"). Strip codes, terminal IDs, trailing numbers.
   - amount: transaction amount (positive number)
   - date: transaction date in ISO format YYYY-MM-DD (extract from statement — do NOT omit)
   - category: one of the category names from step 4
   - CRITICAL: list every individual expense transaction — do NOT deduplicate or aggregate. Two visits to Tim Hortons = two entries.
   - For mortgage/loan/investment: return [].
6. Detect subscriptions (recurring charges, same amount monthly).
   - For credit accounts: include subscriptions found in transactions (e.g. Netflix, Spotify).
   - For mortgage/loan/investment accounts: return [].
7. Calculate:
   - For checking/savings only: total income = sum of ALL individual income entries (do not deduplicate). Every credit/deposit to the account must appear in income.sources. total expenses = sum of ALL individual expense entries, savings rate = (income - expenses) / income
   - For credit accounts: total expenses only; set income = 0, savingsRate = 0
   - For mortgage/loan/investment: all return 0
8. Generate up to 4 personalized insights relevant to the account type:
   - For mortgage/loan: focus on interest rate, payoff timeline, equity building, overpayment opportunities
   - For investment: focus on growth, diversification, contribution rate
   - For checking/savings/credit: focus on spending patterns, savings opportunities, subscriptions

**Return JSON only, no markdown or explanation, in this exact structure.**

For a mortgage/loan (income, expenses, subscriptions will be empty):
{
  "netWorth": -517991.36,
  "assets": 0,
  "debts": 517991.36,
  "statementDate": "2026-01-31",
  "bankName": "TD Bank",
  "accountId": "••••0085",
  "accountName": "TD Home Equity FlexLine",
  "accountType": "mortgage",
  "income": { "total": 0, "sources": [] },
  "expenses": { "total": 0, "categories": [] },
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
  "income": {
    "total": 5200.00,
    "sources": [
      { "description": "Salary - Acme Corp", "amount": 4800.00 },
      { "description": "Freelance Payment", "amount": 400.00 }
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
      { "merchant": "Rogers", "amount": 120.00, "date": "2026-02-03", "category": "Housing" },
      { "merchant": "Tim Hortons", "amount": 8.50, "date": "2026-02-05", "category": "Dining" },
      { "merchant": "Tim Hortons", "amount": 6.75, "date": "2026-02-12", "category": "Dining" },
      { "merchant": "Amazon", "amount": 45.99, "date": "2026-02-14", "category": "Shopping" },
      { "merchant": "Netflix", "amount": 18.99, "date": "2026-02-01", "category": "Entertainment" }
    ]
  },
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
  return (
    typeof d.netWorth === "number" &&
    typeof d.statementDate === "string" &&
    typeof d.bankName === "string" &&
    d.income != null &&
    typeof (d.income as Record<string, unknown>).total === "number" &&
    Array.isArray((d.income as Record<string, unknown>).sources) &&
    d.expenses != null &&
    typeof (d.expenses as Record<string, unknown>).total === "number" &&
    Array.isArray((d.expenses as Record<string, unknown>).categories) &&
    Array.isArray(d.subscriptions) &&
    typeof d.savingsRate === "number" &&
    Array.isArray(d.insights)
  );
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
  const parsed = JSON.parse(jsonStr) as unknown;
  if (!validateParsedData(parsed)) {
    throw new Error("AI response did not match expected schema");
  }
  return normalizeData(parsed);
}
