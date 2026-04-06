/**
 * AI-powered bank CSV parser.
 *
 * Sends the raw CSV text to the AI which handles any bank format —
 * with or without headers, any column order, any date convention,
 * any debit/credit layout. No per-bank heuristics needed.
 */

import { sendTextRequest } from "./ai";
import { ALL_CATEGORY_VALUES } from "./categoryTaxonomy";

export interface ParsedRow {
  date: string;          // YYYY-MM-DD
  description: string;
  amount: number;        // always positive
  isExpense: boolean;    // true = money out, false = money in
  rawAmount: number;     // signed
  category: string;      // expense category (see SYSTEM_PROMPT for valid values)
}

export interface CsvParseResult {
  rows: ParsedRow[];
  detectedFormat: string;
  dateRange: { from: string; to: string } | null;
  closingBalance: number | null; // account balance after the last transaction (if CSV includes a balance column)
  errors: string[];
}

// Limit rows sent to the AI to control token cost.
// A typical month has 30–150 transactions; 600 rows covers ~6 months.
const MAX_ROWS = 600;

const SYSTEM_PROMPT = `You are a bank CSV transaction parser. Extract all transactions from any bank export format.

Return ONLY a JSON object — no markdown, no explanation, no code fences.
Format:
{
  "transactions": [ { "date": "YYYY-MM-DD", "description": string, "amount": number (always positive), "isExpense": boolean, "category": string } ],
  "closingBalance": number or null
}

Rules for transactions:
- isExpense = true  => money going OUT of the account (purchase, charge, fee, withdrawal, debit)
- isExpense = false => money coming IN  to the account (deposit, payment received, credit, refund)
- Skip non-transaction rows: headers, opening/closing balance lines, totals, blank lines
- Normalize all dates to YYYY-MM-DD regardless of source format
- If the CSV uses separate Debit and Credit columns: Debit column populated = isExpense=true, Credit column populated = isExpense=false
- If the CSV uses a single amount column: use the running balance direction and transaction description to determine direction — do NOT assume positive always means income or negative always means expense; instead use context (e.g. a purchase at a merchant = isExpense=true regardless of sign)
- Clean up descriptions: remove extra whitespace, keep merchant/payee name readable
- For income transactions (isExpense=false), set category to "Income"

Use the most specific category or subtype. Parent categories and their subtypes:
- "Housing"               -- rent, utilities, internet/phone, home insurance, condo fees
     subtypes: "Rent" | "Utilities" | "Internet & Phone" | "Home Insurance" | "Condo Fees"
- "Dining"                -- restaurants, food delivery, coffee shops, fast food
     subtypes: "Restaurants" | "Coffee & Drinks" | "Fast Food" | "Food Delivery"
- "Groceries"             -- grocery stores, supermarkets, bulk food (Costco, No Frills, Loblaws). No subtypes.
- "Shopping"              -- retail, clothing, electronics, home goods, online shopping
     subtypes: "Clothing" | "Electronics" | "Home & Garden" | "Online Shopping"
- "Transportation"        -- gas stations, transit, parking, rideshare, auto service
     subtypes: "Gas" | "Parking" | "Car Insurance" | "Transit" | "Rideshare" | "Auto Service"
- "Entertainment"         -- streaming, movies, events, sports, hobbies
     subtypes: "Streaming" | "Movies & Events" | "Sports" | "Hobbies"
- "Subscriptions"         -- recurring monthly/annual charges
     subtypes: "Software" | "Memberships" | "News & Media"
- "Healthcare"            -- medical, pharmacy, dental, vision, fitness, health insurance
     subtypes: "Pharmacy" | "Dental" | "Vision" | "Fitness" | "Health Insurance"
- "Fees"                  -- bank fees, NSF/OD fees, annual card fees, service charges
     subtypes: "Bank Fees" | "NSF/OD Fees" | "Annual Card Fee"
- "Debt Payments"         -- credit card payments, loan payments, mortgage payments. No subtypes.
- "Investments & Savings" -- RRSP/TFSA, investment transfers, mutual funds, GICs, life insurance. No subtypes.
- "Transfers"             -- inter-account transfers, e-transfers to individuals. No subtypes.
- "Other"                 -- anything else. No subtypes.
Use a subtype (e.g. "Gas") when confident. Fall back to the parent (e.g. "Transportation") when unsure.

Rules for closingBalance:
- If the CSV has a running balance column, set closingBalance to the balance on the transaction row with the MOST RECENT DATE (the highest date value) — regardless of which physical row position it appears at in the file (CSVs may be sorted newest-first or oldest-first)
- If no balance column exists, set closingBalance to null
- Always return closingBalance as a positive number (absolute value of the balance shown)`;

export async function parseCSV(csvText: string, accountType?: string): Promise<CsvParseResult> {
  // Truncate to keep token usage reasonable
  const lines = csvText.split("\n");
  const truncated = lines.slice(0, MAX_ROWS).join("\n");

  const isDebtType = accountType ? ["credit", "loan", "mortgage"].includes(accountType.toLowerCase()) : false;
  const accountTypeNote = accountType
    ? `\n\nAccount type: ${accountType}. ` + (
        isDebtType
          ? "This is a credit card / loan / mortgage. Every purchase or charge (money going OUT, i.e. a merchant transaction, fee, interest) is isExpense=true. A payment received (money coming IN to reduce the balance) is isExpense=false."
          : "This is a checking or savings account. Deposits and incoming transfers are isExpense=false. Withdrawals, purchases, and outgoing transfers are isExpense=true."
      )
    : "";

  let rawResponse: string;
  try {
    rawResponse = await sendTextRequest(
      SYSTEM_PROMPT + accountTypeNote,
      `Parse this bank CSV:\n\n${truncated}`
    );
  } catch (err) {
    return {
      rows: [], detectedFormat: "error", dateRange: null, closingBalance: null,
      errors: [`AI parsing failed: ${err instanceof Error ? err.message : "Unknown error"}`],
    };
  }

  // Extract the JSON object from the response (handles any stray text around it)
  const objMatch = rawResponse.match(/\{[\s\S]*\}/);
  if (!objMatch) {
    return {
      rows: [], detectedFormat: "error", dateRange: null, closingBalance: null,
      errors: ["AI returned an unexpected response — no JSON object found."],
    };
  }

  // Build valid category set from taxonomy (parents + subtypes) + legacy values
  const VALID_CATEGORIES = new Set([
    ...ALL_CATEGORY_VALUES,
    "Transfers & Payments", // legacy
    "Transfer Out",
    "Income",
  ]);

  type AiRow = { date?: string; description?: string; amount?: number; isExpense?: boolean; category?: string };
  type AiResponse = { transactions?: AiRow[]; closingBalance?: number | null };
  let aiResponse: AiResponse;
  try {
    aiResponse = JSON.parse(objMatch[0]) as AiResponse;
  } catch {
    return {
      rows: [], detectedFormat: "error", dateRange: null, closingBalance: null,
      errors: ["Could not parse AI response as JSON."],
    };
  }

  const aiRows: AiRow[] = Array.isArray(aiResponse.transactions) ? aiResponse.transactions
    : Array.isArray(aiResponse) ? (aiResponse as unknown as AiRow[]) // fallback: AI returned bare array
    : [];
  const closingBalance = typeof aiResponse.closingBalance === "number" ? aiResponse.closingBalance : null;

  const rows: ParsedRow[] = [];
  for (const item of aiRows) {
    if (!item.date || !item.description || item.amount == null) continue;
    const amount = Math.abs(item.amount);
    if (amount <= 0) continue;
    const isExpense = item.isExpense ?? true;
    const category = (item.category && VALID_CATEGORIES.has(item.category)) ? item.category
      : isExpense ? "Other" : "Income";
    rows.push({
      date: item.date,
      description: item.description.trim(),
      amount,
      isExpense,
      rawAmount: isExpense ? -amount : amount,
      category,
    });
  }

  if (rows.length === 0) {
    return {
      rows: [], detectedFormat: "error", dateRange: null, closingBalance: null,
      errors: ["No transactions found in the CSV."],
    };
  }

  const dates = rows.map((r) => r.date).sort();
  const dateRange = { from: dates[0], to: dates[dates.length - 1] };

  return { rows, detectedFormat: "ai-parsed", dateRange, closingBalance, errors: [] };
}
