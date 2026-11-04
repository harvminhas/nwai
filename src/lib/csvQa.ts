/**
 * Pre-import QA for bank CSV files.
 *
 * Runs before anything is written: checks that the file is a reasonable size,
 * that each column can be identified (date, description, amount, balance), and
 * that the parsed transactions line up with what the file actually contains.
 * Pure functions — no AI, no Firestore — so the preview, the import and the
 * tests all see exactly the same verdict.
 */

import type { CsvParseResult } from "./csvParser";

/** Rows the AI parser will read. Matches MAX_ROWS in csvParser.ts. */
export const CSV_ROW_LIMIT = 600;

/** A file bigger than this is almost certainly not a single-account export. */
export const CSV_MAX_FILE_BYTES = 5 * 1024 * 1024;

export type QaStatus = "ok" | "warn" | "block";

export type ColumnRole = "date" | "description" | "amount" | "debit" | "credit" | "balance" | "unknown";

export interface QaColumn {
  index: number;
  header: string | null;
  role: ColumnRole;
  /** Up to three representative values, for showing the user what we read. */
  samples: string[];
}

export interface QaCheck {
  id: string;
  label: string;
  status: QaStatus;
  detail: string;
}

export interface CsvQaResult {
  status: QaStatus;
  checks: QaCheck[];
  columns: QaColumn[];
  rowCount: number;
  dataLineCount: number;
  fileBytes: number;
}

// ── raw CSV reading ─────────────────────────────────────────────────────────

/** Split one CSV line into fields, honouring double quotes. */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((f) => f.trim());
}

interface RawTable {
  header: string[] | null;
  rows: string[][];
  /** Non-empty, non-header lines — what we expect to become transactions. */
  dataLineCount: number;
}

function readTable(csvText: string): RawTable {
  const lines = csvText.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { header: null, rows: [], dataLineCount: 0 };

  const first = splitCsvLine(lines[0]);
  // A header row has no parseable date in any cell.
  const firstHasDate = first.some((cell) => isDateish(cell));
  const header = firstHasDate ? null : first;
  const body = header ? lines.slice(1) : lines;
  return { header, rows: body.map(splitCsvLine), dataLineCount: body.length };
}

// ── value classification ────────────────────────────────────────────────────

function isDateish(v: string): boolean {
  const s = (v ?? "").trim();
  if (!s) return false;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return true;
  if (/^\d{4}\/\d{1,2}\/\d{1,2}$/.test(s)) return true;
  if (/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(s)) return true;
  if (/^\d{1,2}-[A-Za-z]{3}-\d{2,4}$/.test(s)) return true;
  if (/^\d{8}$/.test(s)) return true;
  if (/^\d{1,2} [A-Za-z]{3,9} \d{4}$/.test(s)) return true;
  return false;
}

function parseNumberish(v: string): number | null {
  const s = (v ?? "").trim().replace(/[$,\s]/g, "").replace(/^\((.*)\)$/, "-$1");
  if (!s || !/^-?\d+(\.\d+)?$/.test(s)) return null;
  return Number(s);
}

function isNumberish(v: string): boolean {
  return parseNumberish(v) !== null;
}

function roleFromHeader(h: string): ColumnRole | null {
  const s = h.toLowerCase();
  if (/date|posting|transaction date|date posted/.test(s)) return "date";
  if (/description|payee|merchant|details|narrative|memo/.test(s)) return "description";
  if (/debit|withdrawal|money out/.test(s)) return "debit";
  if (/credit|deposit|money in/.test(s)) return "credit";
  if (/balance/.test(s)) return "balance";
  if (/amount|value/.test(s)) return "amount";
  return null;
}

/**
 * Work out what each column is. Headers win when present; otherwise the values
 * decide, since most bank exports either have no header at all or one we can't
 * rely on.
 */
export function detectColumns(table: RawTable): QaColumn[] {
  const width = Math.max(table.header?.length ?? 0, ...table.rows.map((r) => r.length), 0);
  if (width === 0) return [];

  const sample = table.rows.slice(0, 40);
  const columns: QaColumn[] = [];

  for (let i = 0; i < width; i++) {
    const header = table.header?.[i]?.trim() || null;
    const values = sample.map((r) => r[i] ?? "").filter((v) => v.trim().length > 0);
    const samples = values.slice(0, 3);

    let role: ColumnRole = "unknown";
    const headerRole = header ? roleFromHeader(header) : null;
    if (headerRole) role = headerRole;

    if (role === "unknown" && values.length > 0) {
      const dateShare = values.filter(isDateish).length / values.length;
      const numShare = values.filter(isNumberish).length / values.length;
      if (dateShare >= 0.8) role = "date";
      else if (numShare >= 0.8) role = "amount";
      else role = "description";
    }

    columns.push({ index: i, header, role, samples });
  }

  // The rightmost numeric column of a bank export is the running balance; the
  // ones before it are amounts. Promote accordingly when we inferred generically.
  const numeric = columns.filter((c) => c.role === "amount");
  if (numeric.length >= 2) {
    const last = numeric[numeric.length - 1];
    last.role = "balance";
    if (numeric.length === 3) {
      numeric[0].role = "debit";
      numeric[1].role = "credit";
    }
  }

  // If there are several description-ish columns, keep the widest as the
  // description and leave the rest unknown rather than guessing.
  const descs = columns.filter((c) => c.role === "description");
  if (descs.length > 1) {
    const widest = descs.reduce((a, b) =>
      (b.samples.join("").length > a.samples.join("").length ? b : a));
    for (const c of descs) if (c !== widest) c.role = "unknown";
  }

  return columns;
}

// ── the check ───────────────────────────────────────────────────────────────

function worst(statuses: QaStatus[]): QaStatus {
  if (statuses.includes("block")) return "block";
  if (statuses.includes("warn")) return "warn";
  return "ok";
}

export function runCsvQualityCheck(args: {
  csvText: string;
  parsed: CsvParseResult;
  /** Rows already covered by statements, so a "nothing new" file isn't a fault. */
  gapRowCount?: number;
}): CsvQaResult {
  const { csvText, parsed } = args;
  const table = readTable(csvText);
  const columns = detectColumns(table);
  const fileBytes = csvText.length;
  const checks: QaCheck[] = [];

  // 1. Size
  if (fileBytes > CSV_MAX_FILE_BYTES) {
    checks.push({
      id: "size", status: "block", label: "File size",
      detail: `This file is ${(fileBytes / 1024 / 1024).toFixed(1)} MB. Export one account at a time — files this large are not a single bank export.`,
    });
  } else {
    checks.push({
      id: "size", status: "ok", label: "File size",
      detail: `${(fileBytes / 1024).toFixed(0)} KB.`,
    });
  }

  // 2. Row count
  if (table.dataLineCount === 0) {
    checks.push({
      id: "rows", status: "block", label: "Row count",
      detail: "No transaction rows found in the file.",
    });
  } else if (table.dataLineCount > CSV_ROW_LIMIT) {
    checks.push({
      id: "rows", status: "warn", label: "Row count",
      detail: `${table.dataLineCount} rows — only the newest ${CSV_ROW_LIMIT} are read, so older months in this file are skipped. Export a shorter date range if you need them.`,
    });
  } else {
    checks.push({
      id: "rows", status: "ok", label: "Row count",
      detail: `${table.dataLineCount} rows, within the ${CSV_ROW_LIMIT}-row limit.`,
    });
  }

  // 3. Columns
  const has = (r: ColumnRole) => columns.some((c) => c.role === r);
  const hasAmount = has("amount") || has("debit") || has("credit");
  const missing = [
    has("date") ? null : "date",
    has("description") ? null : "description",
    hasAmount ? null : "amount",
  ].filter(Boolean) as string[];

  if (missing.length > 0) {
    checks.push({
      id: "columns", status: "block", label: "Columns",
      detail: `Couldn't identify the ${missing.join(", ")} column${missing.length > 1 ? "s" : ""}. Expected a date column, a description/payee column and an amount (or debit/credit) column.`,
    });
  } else {
    const named = columns
      .filter((c) => c.role !== "unknown")
      .map((c) => `${c.header ?? `column ${c.index + 1}`} → ${c.role}`);
    checks.push({
      id: "columns", status: "ok", label: "Columns",
      detail: named.join(", "),
    });
  }

  // 4. Rows that made it through parsing
  if (parsed.rows.length === 0) {
    checks.push({
      id: "parsed", status: "block", label: "Transactions read",
      detail: parsed.errors[0] ?? "No transactions could be read from this file.",
    });
  } else {
    const lost = table.dataLineCount - parsed.rows.length;
    const lostShare = table.dataLineCount > 0 ? lost / table.dataLineCount : 0;
    if (lostShare > 0.15) {
      checks.push({
        id: "parsed", status: "warn", label: "Transactions read",
        detail: `${parsed.rows.length} of ${table.dataLineCount} rows became transactions — ${lost} were skipped. Check the file isn't split across several accounts.`,
      });
    } else {
      checks.push({
        id: "parsed", status: "ok", label: "Transactions read",
        detail: `${parsed.rows.length} of ${table.dataLineCount} rows read as transactions.`,
      });
    }
  }

  // 5. Date range: what the file contains vs what we read
  const fileDates = table.rows
    .map((r) => r.find((cell) => isDateish(cell)))
    .filter(Boolean) as string[];
  if (fileDates.length > 0 && parsed.dateRange) {
    const rawSpan = rawDateSpan(table);
    const parsedTo = parsed.dateRange.to;
    if (rawSpan && rawSpan.to > parsedTo) {
      checks.push({
        id: "dates", status: "warn", label: "Date range",
        detail: `The file has rows dated ${rawSpan.from} to ${rawSpan.to} but only ${parsed.dateRange.from} to ${parsedTo} were read.`,
      });
    } else {
      checks.push({
        id: "dates", status: "ok", label: "Date range",
        detail: `${parsed.dateRange.from} to ${parsed.dateRange.to}.`,
      });
    }
  }

  // 6. Direction sanity
  const expenses = parsed.rows.filter((r) => r.isExpense).length;
  const income = parsed.rows.length - expenses;
  if (parsed.rows.length > 0 && (expenses === 0 || income === 0)) {
    checks.push({
      id: "direction", status: "warn", label: "Money in / out",
      detail: expenses === 0
        ? "Every row reads as money coming in — the debit/credit direction may be reversed."
        : "Every row reads as money going out — the debit/credit direction may be reversed.",
    });
  } else if (parsed.rows.length > 0) {
    checks.push({
      id: "direction", status: "ok", label: "Money in / out",
      detail: `${expenses} out, ${income} in.`,
    });
  }

  // 7. Balance continuity, when the file carries a running balance
  const continuity = checkBalanceContinuity(table, columns);
  if (continuity) checks.push(continuity);

  if (parsed.errors.length > 0) {
    checks.push({
      id: "errors", status: "block", label: "Parser messages",
      detail: parsed.errors.join(" · "),
    });
  }

  const status = worst(checks.map((c) => c.status));
  return {
    status,
    checks,
    columns,
    rowCount: parsed.rows.length,
    dataLineCount: table.dataLineCount,
    fileBytes,
  };
}

/** Min/max date in the raw file, normalised to YYYY-MM-DD where possible. */
function rawDateSpan(table: RawTable): { from: string; to: string } | null {
  const iso: string[] = [];
  for (const row of table.rows) {
    for (const cell of row) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(cell.trim())) iso.push(cell.trim());
    }
  }
  if (iso.length === 0) return null;
  iso.sort();
  return { from: iso[0], to: iso[iso.length - 1] };
}

/**
 * Walk the rows in file order and confirm each balance step matches the amount
 * on that row. A mismatch usually means we read the wrong column.
 */
function checkBalanceContinuity(table: RawTable, columns: QaColumn[]): QaCheck | null {
  const balanceCol = columns.find((c) => c.role === "balance");
  const amountCol = columns.find((c) => c.role === "amount");
  const debitCol = columns.find((c) => c.role === "debit");
  const creditCol = columns.find((c) => c.role === "credit");
  if (!balanceCol) return null;
  if (!amountCol && !debitCol && !creditCol) return null;

  /** The money moved on this row, as a positive number, from whichever layout the file uses. */
  const amountOn = (row: string[]): number | null => {
    if (amountCol) return parseNumberish(row[amountCol.index] ?? "");
    const debit = debitCol ? parseNumberish(row[debitCol.index] ?? "") : null;
    const credit = creditCol ? parseNumberish(row[creditCol.index] ?? "") : null;
    const d = debit === null ? 0 : Math.abs(debit);
    const c = credit === null ? 0 : Math.abs(credit);
    if (d === 0 && c === 0) return null;
    return d + c;
  };

  let compared = 0;
  let mismatched = 0;
  let prev: number | null = null;

  for (const row of table.rows) {
    const bal = parseNumberish(row[balanceCol.index] ?? "");
    const amt = amountOn(row);
    if (bal === null) continue;
    if (prev !== null && amt !== null) {
      compared++;
      const delta = Number((bal - prev).toFixed(2));
      if (Math.abs(Math.abs(delta) - amt) > 0.02) mismatched++;
    }
    prev = bal;
  }

  if (compared === 0) return null;
  const share = mismatched / compared;
  if (share > 0.1) {
    return {
      id: "balance", status: "block", label: "Balance column",
      detail: `The running balance doesn't line up with the amounts on ${mismatched} of ${compared} rows, so the amount and balance columns may be swapped.`,
    };
  }
  return {
    id: "balance", status: "ok", label: "Balance column",
    detail: `Closing balance read from the last row; ${compared - mismatched} of ${compared} steps reconcile.`,
  };
}
