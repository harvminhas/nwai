/**
 * AI-powered bank CSV parser.
 *
 * Sends the raw CSV text to the AI which handles any bank format —
 * with or without headers, any column order, any date convention,
 * any debit/credit layout. No per-bank heuristics needed.
 */

import { sendTextRequest } from "./ai";

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
- isExpense = true  → money going OUT (debit, withdrawal, purchase, fee, payment)
- isExpense = false → money coming IN  (credit, deposit, income, refund, transfer in)
- Skip non-transaction rows: headers, opening/closing balance lines, totals, blank lines
- Normalize all dates to YYYY-MM-DD regardless of source format
- If the CSV uses separate Debit and Credit columns, use whichever is populated to set isExpense
- If the CSV uses a single signed amount, negative = expense, positive = income
- Clean up descriptions: remove extra whitespace, keep merchant/payee name readable
- For income transactions (isExpense=false), set category to "Income"

Category must be one of these exact values (for expenses):
- "Dining"            — restaurants, sushi, pizza, coffee shops, fast food, food delivery
- "Groceries"         — grocery stores, supermarkets, bulk food (Costco, No Frills, Loblaws, etc.)
- "Shopping"          — retail, clothing, Amazon, online shopping, electronics, home goods
- "Transportation"    — gas stations, Uber, Lyft, transit, parking, car payments, auto service
- "Entertainment"     — streaming (Netflix, Spotify), movies, events, hobbies, sports, gym
- "Subscriptions"     — recurring monthly/annual charges (software, memberships, clubs)
- "Healthcare"        — medical, pharmacy, dental, optometrist, insurance premiums
- "Transfers & Payments" — e-transfers to individuals or businesses, rent, contractor payments, inter-account transfers, credit card payments
- "Other"             — anything that doesn't fit the above

Rules for closingBalance:
- If the CSV has a running balance column, set closingBalance to the balance on the LAST (most recent) transaction row
- If no balance column exists, set closingBalance to null`;

export async function parseCSV(csvText: string): Promise<CsvParseResult> {
  // Truncate to keep token usage reasonable
  const lines = csvText.split("\n");
  const truncated = lines.slice(0, MAX_ROWS).join("\n");

  let rawResponse: string;
  try {
    rawResponse = await sendTextRequest(SYSTEM_PROMPT, `Parse this bank CSV:\n\n${truncated}`);
  } catch (err) {
    return {
      rows: [], detectedFormat: "error", dateRange: null,
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

  const VALID_CATEGORIES = new Set([
    "Dining", "Groceries", "Shopping", "Transportation", "Entertainment",
    "Subscriptions", "Healthcare", "Transfers & Payments", "Other", "Income",
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
