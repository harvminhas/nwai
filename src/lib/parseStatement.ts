import type { ParsedStatementData } from "./types";
import { sendVisionRequest, sendPdfRequest, sendTextRequest } from "./anthropic";

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
   - For mortgage/loan/investment statements with no consumer transactions, skip steps 3–6 and return empty arrays/zeros.
4. For checking, savings, and credit accounts — categorize each transaction:
   - Income: Salary, wages, deposits, transfers in
   - Housing: Rent, mortgage payments, utilities, insurance
   - Dining: Restaurants, food delivery, coffee shops
   - Shopping: Retail, online shopping, Amazon
   - Transportation: Gas, Uber/Lyft, car payment, public transit
   - Entertainment: Streaming, movies, events, hobbies
   - Subscriptions: Any recurring monthly charge
   - Healthcare: Medical, pharmacy, insurance
   - Other: Anything else
5. Detect subscriptions (recurring charges, same amount monthly).
   - For credit accounts: include subscriptions found in transactions (e.g. Netflix, Spotify).
   - For mortgage/loan/investment accounts: return [].
6. Calculate:
   - For checking/savings only: total income, total expenses, savings rate = (income - expenses) / income
   - For credit accounts: total expenses only; set income = 0, savingsRate = 0
   - For mortgage/loan/investment: all return 0
7. Generate up to 4 personalized insights relevant to the account type:
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
  const prompt = `${SYSTEM_PROMPT}\n\n**Image content (bank statement) is attached. Return the JSON now.**`;
  const raw = await sendVisionRequest({ prompt, imageBase64, mediaType });
  return parseJsonResponse(raw);
}

export async function parseStatementPdf(pdfBase64: string): Promise<ParsedStatementData> {
  const prompt = `${SYSTEM_PROMPT}\n\n**The attached PDF is a bank statement. Return the JSON now.**`;
  const raw = await sendPdfRequest(prompt, pdfBase64);
  return parseJsonResponse(raw);
}

const MAX_CSV_CHARS = 120_000;

export async function parseStatementCsv(csvText: string): Promise<ParsedStatementData> {
  const trimmed =
    csvText.length > MAX_CSV_CHARS
      ? csvText.slice(0, MAX_CSV_CHARS) +
        "\n\n[Truncated for length; analyze what is shown.]"
      : csvText;
  const prompt = `${SYSTEM_PROMPT}

**Below is CSV data (often a transaction export from a bank). Infer net worth from ending balance or last row if present; otherwise estimate from transactions. Return the JSON now.**

---CSV---
${trimmed}
---END---`;
  const raw = await sendTextRequest(prompt);
  return parseJsonResponse(raw);
}

function parseJsonResponse(raw: string): ParsedStatementData {
  const jsonStr = extractJson(raw);
  const parsed = JSON.parse(jsonStr) as unknown;
  if (!validateParsedData(parsed)) {
    throw new Error("Claude response did not match expected schema");
  }
  return parsed;
}
