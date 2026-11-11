import type { TrackerLinkedTransaction } from "@/app/api/user/trackers/route";

export interface TrackerTotals {
  incomeIn: number;
  spendingOut: number;
  net: number;
}

/** Income in, spending out, and net (income − spending) from linked rows. */
export function computeTrackerTotals(
  transactions: TrackerLinkedTransaction[] | null | undefined
): TrackerTotals {
  let incomeIn = 0;
  let spendingOut = 0;
  for (const tx of transactions ?? []) {
    if (tx.kind === "income") incomeIn += tx.amount;
    else spendingOut += tx.amount;
  }
  return { incomeIn, spendingOut, net: incomeIn - spendingOut };
}

function csvCell(value: string | number): string {
  const s = String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** CSV of a tracker's linked transactions, newest first. Does not mutate source rows. */
export function trackerTransactionsToCsv(
  transactions: TrackerLinkedTransaction[] | null | undefined
): string {
  const rows = [...(transactions ?? [])].sort((a, b) => b.date.localeCompare(a.date));
  const header = ["Date", "Type", "Merchant", "Category", "Amount"].map(csvCell).join(",");
  const body = rows.map((tx) =>
    [
      csvCell(tx.date),
      csvCell(tx.kind === "income" ? "Income" : "Spending"),
      csvCell(tx.merchant),
      csvCell(tx.category),
      csvCell(tx.amount),
    ].join(",")
  );
  return [header, ...body].join("\n");
}

export function trackerCsvFilename(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `${slug || "tracker"}-transactions.csv`;
}

export function defaultFilterLabel(filter: string): string {
  if (filter === "income") return "Income";
  if (filter === "spending") return "Spending";
  return "All";
}
