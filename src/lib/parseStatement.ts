import type { ParsedStatementData } from "./types";
import { sendVisionRequest, sendPdfRequest, sendTextRequest } from "./ai";

export const SYSTEM_PROMPT = `You are a financial analysis expert. Analyze this bank statement and extract structured data.

**CRITICAL — NO FABRICATION RULE:**
Every value you return MUST be copied verbatim from the document. Do NOT guess, infer, calculate, or invent any value that is not explicitly printed on the statement. If a field is not present, use the fallback specified (null, 0, "unknown", or []). This rule applies especially to account numbers, balances, dates, and interest rates.

---

**STEP 1 — ACCOUNT DETAILS**
Extract the following fields:
- bankName: name of the bank or financial institution as printed.
- accountId: copy the account number EXACTLY as printed (e.g. "28215846", "••••1234", "5223 XXXX XXXX 0773"). Copy character-for-character — do NOT reformat, mask, unmask, truncate, or invent digits. If absent, return "unknown".
- accountName: account product name or nickname (e.g. "TD All-Inclusive Banking", "Chase Sapphire Reserve"). Infer from context if not labelled.
- accountType: exactly one of: "checking", "savings", "credit", "mortgage", "investment", "loan", "other"
- interestRate: APR/APY as a plain number (e.g. 4.25). Return null if not stated — do NOT guess.
- currency: ISO 4217 code as printed on the statement (e.g. "USD", "CAD", "EUR"). If not explicitly stated, infer from context: US banks / US brokerage accounts (Fidelity, Vanguard, Schwab, TD Ameritrade, etc.) → "USD". Canadian banks (TD Canada Trust, RBC, BMO, CIBC, Scotiabank, Desjardins, etc.) → "CAD". Default to "CAD" only if you are confident it is a Canadian-dollar account.

---

**STEP 2 — BALANCE**
- statementDate: last day of the statement period as printed. Do NOT use today's date.
- netWorth: closing/ending balance.
  - Asset accounts (checking, savings, investment): POSITIVE closing balance.
  - Debt accounts (credit, mortgage, loan, HELOC, line of credit): NEGATIVE total outstanding balance.
  - Multi-segment statements (e.g. TD FlexLine = revolving HELOC + term mortgage portions): sum ALL sub-account balances into one negative total. Example: revolving $34,717 + term $444,469 = −$479,186.
- assets: closing balance for asset accounts; 0 for debt accounts.
- debts: 0 for asset accounts; total outstanding balance (positive) for debt accounts.

**INVESTMENT ACCOUNT BALANCE — CRITICAL RULES:**
For investment/retirement accounts (401k, RRSP, TFSA, brokerage, pension):
1. The authoritative balance is the field labelled "Ending Balance", "Account Total", "Closing Balance", "Total Market Value", or "Vested Balance" at the ACCOUNT level (your personal account, not the whole plan).
2. Do NOT use individual fund prices, share prices, inception-to-date contribution totals, plan-level aggregates, or any calculated/intermediate value.
3. Do NOT multiply shares × price yourself — only use a dollar total that is explicitly printed.
4. If the statement shows a table with columns like "Shares / Price / Market Value", use only the MARKET VALUE column total for the ending period.
5. Ignore any "Plan Total" or company-wide figures — use only the participant's own account balance.

---

**STEP 0 — IDENTIFY STATEMENT FORMAT BEFORE CLASSIFYING ANY TRANSACTION**
Scan the transaction table for column headers. Different banks use different layouts and some statements have NO headers at all. Use this detection order:

**If column headers ARE present**, identify columns by their label:
  - Debit/outgoing column: "Withdrawals", "Debits", "Charges", "Amount Out", "DR", "Payment", or similar.
  - Credit/incoming column: "Deposits", "Credits", "Amount In", "CR", "Receipt", or similar.
  - Combined column: "Amount", "Transaction Amount", or similar (one column for all transactions).
  - Column order (left-right) varies by bank — do NOT assume position.

**If NO headers are present**, infer format from the data patterns in the rows:
  - Two separate numeric columns, one of which is blank per row → FORMAT A (one column = debit, other = credit; identify which by tracing the running balance: a value that INCREASES the balance is a credit, a value that DECREASES is a debit).
  - Single column with CR/DR or (CR)/(DR) suffix → FORMAT B.
  - Single column where some values have a minus (−) sign → FORMAT C (negative = money OUT, positive or unsigned = money IN).
  - Single column, all positive, no notation → FORMAT D (use DIRECTION KEYWORDS below).

**Formats:**
  FORMAT A — Two separate amount columns (debit and credit). Each row has a value in one column only.
  FORMAT B — Single "Amount" column with CR/DR suffix. CR = money IN. DR = money OUT.
  FORMAT C — Single "Amount" column with +/− sign. Negative = money OUT. Positive = money IN.
  FORMAT D — Single "Amount" column, unsigned, no notation. Use DIRECTION KEYWORDS to determine direction.

Record the format AND what evidence you used (header labels found, or data-pattern reasoning) before classifying any row.

**DIRECTION KEYWORDS (use only when FORMAT D, or to resolve ambiguity)**
  ALWAYS money OUT (debit/expense — never income):
    - PYT TO, PAYMENT TO, PMT TO
    - SEND E-TRANSFER, SEND E-TER, SEND ETRANSFER
    - TFR TO, TFR-TO, TRANSFER TO, IN0XX TFR-TO
    - ATM WITHDRAWAL, CASH ADVANCE
    - Bill payments, retail purchases, point-of-sale transactions
  ALWAYS money IN (credit/income — unless explicitly listed above):
    - PAYROLL, PAY, SALARY, WAGES
    - GC DEPOSIT, CRA, CANADA DEPOSIT, GST, OAS, CPP, EI, CERB
    - E-TFR FRM, E-TRANSFER FROM, RECEIVE ETRANSFER, ETFR RCV
    - DIRECT DEPOSIT

---

**STEP 3 — TRANSACTION CLASSIFICATION: TWO-PASS RULE**
Skip balance-snapshot rows entirely — rows that record what the balance IS rather than money moving (e.g. "Opening Balance", "Closing Balance", "Balance Forward", "Prior Balance"). These are NOT transactions.

For pure mortgage and investment statements (no consumer purchases): skip Steps 3–6 and return empty arrays/zeros for income, expenses, subscriptions, and savingsRate.
EXCEPTION — HELOC / Line of Credit: extract every advance/charge as an expense and every payment received as paymentsMade. Do NOT skip.

**STEP 2B — INVESTMENT HOLDINGS (investment accounts only)**
If accountType is "investment", extract every line item from the portfolio/positions/holdings table.

**Multi-period tables (Fidelity NetBenefits and similar):**
These statements show the SAME metric for two dates side-by-side, e.g.:
  "Shares as of 01/31 | Shares as of 02/28 | Price as of 01/31 | Price as of 02/28 | Market Value as of 01/31 | Market Value as of 02/28"
ALWAYS use the LAST / MOST RECENT period column for value, shares, and price.
Fund names may wrap across multiple lines — reconstruct the full name before moving on.

**For each position:**
- symbol: ticker exactly as printed (e.g. "FXAIX", "VFV", "AAPL"). Omit if absent.
- name: full fund / security name, reconstructed from all lines that belong to this row.
- type: exactly one of "stock" | "etf" | "mutual_fund" | "bond" | "gic" | "cash" | "other".
  - Name contains "Index Fund", "Mutual Fund", "Fund" (no ETF) → "mutual_fund"
  - Name contains "ETF" or ticker only, no "Fund" → "etf"
  - Plain company name or single ticker → "stock"
  - "Bond", "Fixed Income", "Treasury" → "bond"
  - "GIC", "Term Deposit" → "gic"
  - "Cash", "Money Market", uninvested balance → "cash"
- value: most-recent-period market value in dollars. Must be explicitly printed — do NOT calculate from shares × price.
- units: shares/units for the most recent period. Omit if not stated.
- percentOfPortfolio: % weight if printed. Omit if not stated.

**Rules:**
- Only include rows that represent individual positions with an explicit dollar value.
- Skip subtotal rows ("Large Cap Total", "Account Totals", "Sub-Total", etc.).
- Skip header rows and footnote rows.
- If no holdings table exists, return holdings: [].

Skip Steps 3–6 for investment accounts (return empty arrays/zeros for income, expenses, subscriptions, savingsRate).

PASS 1 — Direction: For EVERY transaction row, determine money IN vs money OUT using the format identified in STEP 0. This is binary — there is no "unclear". If the statement's own notation is ambiguous, use DIRECTION KEYWORDS. Record your determination before moving to categorization.

**FORMAT A — column-label rule**: Use the column headers you identified in STEP 0. An amount appearing in the debit/withdrawal column is ALWAYS money OUT regardless of description. An amount in the credit/deposit column is ALWAYS money IN regardless of description. The description NEVER overrides the column label. Do NOT assume which side of the table is debit vs credit — read the headers.

PASS 2 — Category: Apply the category rules below. Category assignment only happens AFTER direction is confirmed.

**Classify as INCOME only if:**
  - Money is definitively moving INTO this account (balance increases), AND
  - The description does NOT match any item in the ALWAYS money OUT list above.
  Even if a transaction has a credit/deposit marker, if the description contains "PYT TO", "SEND E-TRANSFER", "TFR TO" or similar — it is an outgoing payment, not income. These keywords override CR notations.

**For each money-IN transaction, assign an income category:**
  - Salary: Regular employer payroll. Description contains PAYROLL, PAY, SALARY, WAGES, or deposit repeats on a predictable bi-weekly / semi-monthly schedule. Examples: "MAM PAY", "ADP PAYROLL", "CERIDIAN PAY".
  - Government: CRA, GST/HST credit, OAS, CPP, EI, CERB, provincial benefit, tax refund. Examples: "CRA DEPOSIT", "GC DEPOSIT", "GST", "OAS PMT".
  - Transfer In: Money received from another own account. Examples: "TFR FROM SAVINGS", "E-TFR FRM".
  - Other: Any other one-time or irregular deposit — e-transfers received from individuals, freelance payments, rental income, etc.

**Classify as EXPENSE for all money OUT transactions. Use these categories:**

  Housing: Rent, hydro/gas/water utilities, internet, home phone, home insurance, condo/strata fees.
    Examples: "ROGERS COMM", "HYDRO ONE", "ENBRIDGE GAS", "RENT E-TFR", "BELL CANADA"
    Never include: mortgage principal payments, loan payments, credit card payments (those are Debt Payments)

  Dining: Restaurants, fast food, food delivery apps, coffee shops, cafes, bars.
    Examples: "TIM HORTONS", "MCDONALD'S", "UBER EATS", "DOORDASH", "STARBUCKS", "SKIP THE DISHES"
    Never include: grocery stores, wholesale clubs

  Groceries: Supermarkets, grocery stores, bulk/warehouse food stores.
    Examples: "LOBLAWS", "METRO", "SOBEYS", "NO FRILLS", "FOOD BASICS", "WALMART GROCERY", "COSTCO"
    Never include: restaurants or food delivery (even if food-related)

  Shopping: Retail stores, online shopping, clothing, electronics, home goods, department stores.
    Examples: "AMAZON", "WALMART", "WINNERS", "HOME DEPOT", "BEST BUY", "IKEA", "ZARA", "ETSY"

  Transportation: Gas stations, rideshare, transit, parking, car payments to a dealer or lender (not credit card payments).
    Examples: "ESSO", "PETRO-CAN", "UBER TRIP", "TTC", "GO TRANSIT", "IMPARK", "HONDA FINANCIAL"

  Entertainment: Streaming services, movies/theatre, games, events, hobbies, sports.
    Examples: "NETFLIX", "DISNEY PLUS", "SPOTIFY", "APPLE MUSIC", "CINEPLEX", "STEAM"
    IMPORTANT: If a streaming/subscription charge recurs on a fixed monthly schedule, ALSO add it to Subscriptions.

  Subscriptions: Any fixed recurring charge on a predictable schedule (weekly/biweekly/monthly/quarterly/annual).
    Examples: "GYM MEMBERSHIP", "AMAZON PRIME", "ADOBE CC", "NORTON", "APPLE ONE"
    Note: Subscriptions often overlap with Entertainment or Healthcare categories. Include in both.

  Healthcare: Medical offices, pharmacies, dental, vision, medical labs, health/dental/vision insurance premiums.
    Examples: "SHOPPERS DRUG MART", "REXALL", "ONTARIO BLUE CROSS", "SUNLIFE HEALTH PMT"

  Fees: Bank-imposed charges, NSF/overdraft fees, monthly account fees, ATM fees, annual card fees, foreign transaction fees, service charges. Interest charges on credit/HELOC statements also go here.
    Examples: "SERVICE CHARGE", "O.D.P. FEE", "NSF FEE", "MONTHLY FEE", "ANNUAL FEE $139"

  Debt Payments: Payments sent FROM this account TO a credit card, loan, mortgage, or line of credit.
    Examples: "VISA PAYMENT", "MASTERCARD PMT", "CIBC MC", "TD CREDIT CARD PMT", "LOAN PAYMENT", "MORTGAGE PMT"
    CRITICAL: Do NOT include these in income even if they show as a credit on the receiving statement.

  Investments & Savings: RRSP/TFSA contributions, transfers to investment accounts, mutual fund/ETF purchases, GIC purchases, life insurance premiums.
    Examples: "WS INVESTMENTS", "WEALTHSIMPLE", "QUESTRADE", "SUNLIFE INS PMT", "RRSP CONTRIBUTION"

  Transfers: Inter-account transfers between own bank accounts, e-transfers sent to individuals, rent paid via Interac e-transfer, contractor payments by e-transfer.
    Examples: "TFR TO SAVINGS", "SEND E-TFR JOHN SMITH", "INTERAC E-TFR TO LANDLORD"
    Never include: debt payments or investment contributions (those have their own categories above)

  Cash & ATM: ATM cash withdrawals, bank cash advances.
    Examples: "ATM WITHDRAWAL", "CASH ADVANCE", "SCOTIABANK ATM"

  Other: Any debit not covered by the above categories.

---

**STEP 3B — INCOME TRANSACTION LIST (checking/savings only)**
List every individual money-IN transaction as a separate entry. Rules:
  - List every deposit you see in the statement, including repeated payees on different dates (e.g. bi-weekly payroll on the 1st and 15th). Do not skip any.
  - source: the actual payee or company name. Read the FULL transaction description row on the statement — the payee name is often embedded after a bank prefix. Examples: "DIRECT DEP MAM PAY INC" → "MAM PAY INC", "PAYROLL MAM ENTERPRISES" → "MAM Enterprises", "E-TFR FR JOHN SMITH" → "John Smith", "CRA GST/HST CREDIT" → "CRA". Clean trailing codes and reference numbers the same way you do for expense merchants.
  - category: exactly one of "Salary", "Government", "Transfer In", "Other".
  - NEVER include opening balance, closing balance, balance forward, or any bank-printed "Total Deposits" line.
  - NEVER include outgoing debits — always check the column/sign first.
  - date: full YYYY-MM-DD. Derive the 4-digit year from the statement period header — never use a 2-digit year or guess.
  - For credit/HELOC/LOC: return [] (payments are paymentsMade, not income).
  - For mortgage/loan/investment: return [].

---

**STEP 4 — EXPENSE TRANSACTION LIST**
List every individual money-OUT transaction. Rules:
  - Every debit must appear. Zero omissions. Include repeated merchants on different dates as separate entries.
  - merchant: clean human-readable name. "AMZN MKTP CA 12345" → "Amazon". "TH #1234 BRAMPTON" → "Tim Hortons".
  - amount: positive number.
  - date: full YYYY-MM-DD. Derive the 4-digit year from the statement period header — never guess or use today's date.
  - category: exactly one category name from Step 3.
  - recurring: include ONLY when confident the charge repeats on a fixed schedule. Use exactly: "weekly", "biweekly", "monthly", "quarterly", "annual". Omit entirely for one-off charges.
  - For mortgage/loan/investment: return [].

---

**STEP 5 — SUBSCRIPTIONS**
Detect recurring charges (same merchant, same amount, predictable schedule).
  - For credit accounts: include subscriptions found in transactions.
  - For mortgage/loan/investment: return [].

**STEP 6 — PAYMENTS MADE (credit, loan, mortgage, HELOC only)**
- paymentsMade: total payments received toward this account's balance this period.
- This is NOT income. It tracks debt repayment to offset the matching outgoing transfer in the chequing account.
- HELOC: include ALL payments across revolving + all term/fixed portions combined.
- If no payment received: set to 0.
- For checking/savings/investment: set to 0.

**STEP 7 — SUB-ACCOUNTS (multi-segment statements only)**
For combined products (HELOC + mortgage term portions, etc.):
  - Populate subAccounts[] with one entry per segment: { "id", "label", "type": "heloc"|"mortgage"|"loan"|"credit", "balance" (positive), "apr" or null, "maturityDate" YYYY-MM-DD if shown }.
  - Top-level netWorth: set to 0 — this will be recomputed from subAccount balances in code. Just extract the individual sub-account balances accurately.
  - Top-level interestRate = rate for the revolving/HELOC portion.
  - Single-account statements: return subAccounts as [].

For an investment / retirement account (401k, RRSP, TFSA, brokerage):
{
  "netWorth": 64510.67,
  "assets": 64510.67,
  "debts": 0,
  "statementDate": "2026-02-28",
  "bankName": "Fidelity",
  "accountId": "Z12345678",
  "accountName": "HPE Hewlett Packard Enterprise 401(k) Plan",
  "accountType": "investment",
  "currency": "USD",
  "interestRate": null,
  "income": { "transactions": [] },
  "expenses": { "transactions": [] },
  "paymentsMade": 0,
  "subscriptions": [],
  "subAccounts": [],
  "holdings": [
    { "name": "US Large Cap Equity Index", "type": "mutual_fund", "value": 64510.67, "units": 697.073 }
  ]
}

**Return JSON only, no markdown or explanation. Do NOT compute totals, percentages, or summaries — return transactions only. Totals and category aggregations are calculated by the application.**

For a HELOC / Home Equity Line of Credit (revolving advances are expenses; payments across ALL portions go into paymentsMade):
{
  "netWorth": -508329.06,
  "assets": 0,
  "debts": 508329.06,
  "statementDate": "2025-12-31",
  "bankName": "TD Bank",
  "accountId": "1185-4190085",
  "accountName": "TD Home Equity FlexLine",
  "accountType": "loan",
  "interestRate": 4.65,
  "income": { "transactions": [] },
  "expenses": {
    "transactions": [
      { "merchant": "Brampton Taxes", "amount": 1722.73, "date": "2025-12-10", "category": "Other" },
      { "merchant": "CIBC MC", "amount": 3000.00, "date": "2025-12-29", "category": "Debt Payments" },
      { "merchant": "Interest", "amount": 79.41, "date": "2025-12-31", "category": "Fees", "recurring": "monthly" }
    ]
  },
  "paymentsMade": 3291.64,
  "subscriptions": [],
  "subAccounts": [
    { "id": "1185-4190085",    "label": "Revolving Portion", "type": "heloc",    "balance": 23395.45,  "apr": 4.65 },
    { "id": "1185-4190085-01", "label": "Term Portion 1",    "type": "mortgage", "balance": 446969.13, "apr": 3.9, "maturityDate": "2030-02-21" },
    { "id": "1185-4190085-02", "label": "Term Portion 2",    "type": "mortgage", "balance": 37964.48,  "apr": 3.9, "maturityDate": "2030-02-08" }
  ]
}

For a pure mortgage/loan (no consumer purchases; income, expenses, subscriptions will be empty):
{
  "netWorth": -446969.13,
  "assets": 0,
  "debts": 446969.13,
  "statementDate": "2025-12-31",
  "bankName": "TD Bank",
  "accountId": "1185-4190085-01",
  "accountName": "TD Mortgage",
  "accountType": "mortgage",
  "interestRate": 3.9,
  "income": { "transactions": [] },
  "expenses": { "transactions": [] },
  "paymentsMade": 3001.68,
  "subscriptions": [],
  "subAccounts": []
}

For a checking/savings/credit account.
accountId examples: TD statement printing "••••3156" → use "••••3156". Wealthsimple printing "28215846" → use "28215846". Always copy verbatim.
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
    "transactions": [
      { "source": "MAM PAY", "amount": 2400.00, "date": "2026-02-01", "category": "Salary" },
      { "source": "MAM PAY", "amount": 2400.00, "date": "2026-02-15", "category": "Salary" },
      { "source": "Freelance E-Transfer", "amount": 400.00, "date": "2026-02-10", "category": "Other" }
    ]
  },
  "expenses": {
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
  "subAccounts": []
}`;

export function extractJson(text: string): string {
  const trimmed = text.trim();
  const start = trimmed.indexOf("{");
  if (start === -1) return trimmed;
  const end = trimmed.lastIndexOf("}") + 1;
  if (end === 0) return trimmed;
  const candidate = trimmed.slice(start, end);

  // Fast path — already valid
  try { JSON.parse(candidate); return candidate; } catch { /* fall through to repair */ }

  // Repair: the response was truncated mid-JSON (hit model output limit).
  // Walk the candidate and close any open strings, arrays, and objects so we
  // get as much valid data as possible rather than throwing a hard 500.
  let inString = false;
  let escape   = false;
  const stack: string[] = [];

  for (const ch of candidate) {
    if (escape)          { escape = false; continue; }
    if (ch === "\\")     { escape = true;  continue; }
    if (ch === '"')      { inString = !inString; continue; }
    if (inString)        continue;
    if (ch === "{" || ch === "[") stack.push(ch);
    else if (ch === "}" || ch === "]") stack.pop();
  }

  let repaired = candidate;
  if (inString) repaired += '"';           // close open string
  while (stack.length) {
    repaired += stack[stack.length - 1] === "{" ? "}" : "]";
    stack.pop();
  }

  return repaired;
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
    subAccounts: Array.isArray(data.subAccounts) ? data.subAccounts : [],
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
  const incomeTxns  = (data.income?.transactions ?? []).filter((t) => (t.amount ?? 0) > 0);

  // Expense amounts must always be positive (money out). The AI prompt says so,
  // but the AI occasionally returns negative amounts for credits/refunds.
  // Drop them here — the bucket (expenses vs income) is the canonical direction signal.
  const expenseTxns = (data.expenses?.transactions ?? []).filter((t) => (t.amount ?? 0) > 0);

  // Derive totals from individual transactions — never trust AI-computed sums.
  const incomeTotal   = incomeTxns.reduce((s, t) => s + (t.amount ?? 0), 0);
  const expensesTotal = expenseTxns.reduce((s, t) => s + (t.amount ?? 0), 0);

  // Build income.sources by grouping transactions by payee name (source field)
  // so "By Source" on the income page shows "MAM PAY", "CRA", etc.
  const sourceMap = new Map<string, number>();
  for (const t of incomeTxns) {
    const key = (t.source ?? "Unknown").trim();
    sourceMap.set(key, (sourceMap.get(key) ?? 0) + (t.amount ?? 0));
  }
  const sources = Array.from(sourceMap.entries()).map(([description, amount]) => ({ description, amount }));

  // Build expenses.categories by grouping transactions by their `category` field.
  const categoryMap = new Map<string, number>();
  for (const t of expenseTxns) {
    const key = (t.category ?? "Other").trim();
    categoryMap.set(key, (categoryMap.get(key) ?? 0) + (t.amount ?? 0));
  }
  const categories = Array.from(categoryMap.entries()).map(([name, amount]) => ({
    name,
    amount,
    percentage: expensesTotal > 0 ? Math.round((amount / expensesTotal) * 100) : 0,
  }));

  const savingsRate =
    incomeTotal > 0 ? Math.round(((incomeTotal - expensesTotal) / incomeTotal) * 100) : 0;

  // ── Sub-account recomputation ─────────────────────────────────────────────
  // The AI should only extract individual sub-account balances from the statement.
  // netWorth, assets, and debts are derived here in code — never trusted from AI.
  const subAccounts = data.subAccounts ?? [];
  let netWorth  = data.netWorth  ?? 0;
  let assets    = data.assets;
  let debts     = data.debts;

  if (subAccounts.length > 0) {
    const subTotal = subAccounts.reduce((s, a) => s + (a.balance ?? 0), 0);
    const accountType = (data.accountType ?? "").toLowerCase();
    const isDebt = ["mortgage", "loan", "heloc", "credit", "loc"].includes(accountType);

    if (isDebt) {
      // Debt accounts: netWorth is negative outstanding balance
      netWorth = -subTotal;
      debts    = subTotal;
      assets   = 0;
    } else {
      // Asset/investment accounts: netWorth is positive
      netWorth = subTotal;
      assets   = subTotal;
      debts    = 0;
    }
  }

  return {
    ...data,
    netWorth,
    assets,
    debts,
    income:   { sources, total: incomeTotal,   transactions: incomeTxns },
    expenses: { categories,  total: expensesTotal, transactions: expenseTxns },
    savingsRate,
  };
}

function parseJsonResponse(raw: string): ParsedStatementData {
  const jsonStr = extractJson(raw);

  // AI returned plain text instead of JSON (e.g. "I encountered an error..." or a refusal).
  if (!jsonStr.trimStart().startsWith("{")) {
    const preview = raw.slice(0, 300).replace(/\n/g, " ");
    throw new Error(`AI returned text instead of JSON: "${preview}"`);
  }

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
