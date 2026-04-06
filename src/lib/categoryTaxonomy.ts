/**
 * Category Taxonomy — single source of truth for expense category hierarchy.
 *
 * TO ADD A NEW SUBTYPE:  add it to the array under its parent in CATEGORY_TAXONOMY.
 * TO ADD A NEW PARENT:   add a key to CATEGORY_TAXONOMY (empty array = no subtypes)
 *                        and add it to PARENT_CATEGORIES.
 * Changes here automatically propagate to: CategoryPicker, AI prompt,
 * CSV parser, spending page rollup, and CORE_EXCLUDE_RE descendants.
 */

// ── Parent categories (canonical, displayed in picker and charts) ─────────────

export const PARENT_CATEGORIES = [
  "Housing",
  "Groceries",
  "Dining",
  "Transportation",
  "Shopping",
  "Entertainment",
  "Healthcare",
  "Subscriptions",
  "Fees",
  "Debt Payments",
  "Investments & Savings",
  "Transfers",
  "Transfer Out",
  "Transfers & Payments",
  "Cash & ATM",
  "Interest",
  "Other",
] as const;

export type ParentCategory = (typeof PARENT_CATEGORIES)[number];

// ── Subtype taxonomy ──────────────────────────────────────────────────────────
// Empty array = no subtypes. Subtypes are stored as their own value in Firestore
// and rolled up to their parent for chart totals.

export const CATEGORY_TAXONOMY: Record<ParentCategory, readonly string[]> = {
  Housing:                ["Rent", "Mortgage", "Utilities", "Internet & Phone", "Home Insurance", "Condo Fees"],
  Groceries:              [],
  Dining:                 ["Restaurants", "Coffee & Drinks", "Fast Food", "Food Delivery"],
  Transportation:         ["Gas", "Parking", "Car Insurance", "Transit", "Rideshare", "Auto Service"],
  Shopping:               ["Clothing", "Electronics", "Home & Garden", "Online Shopping"],
  Entertainment:          ["Streaming", "Movies & Events", "Sports", "Hobbies"],
  Healthcare:             ["Pharmacy", "Dental", "Vision", "Fitness", "Health Insurance"],
  Subscriptions:          ["Software", "Memberships", "News & Media"],
  Fees:                   ["Bank Fees", "NSF/OD Fees", "Annual Card Fee"],
  "Debt Payments":        [],
  "Investments & Savings":[],
  Transfers:              [],
  "Transfer Out":         [],
  "Transfers & Payments": [],
  "Cash & ATM":           [],
  Interest:               [],
  Other:                  [],
};

// ── Derived maps (auto-generated — do not edit directly) ──────────────────────

/** subtype (lowercase) → parent */
export const SUBTYPE_TO_PARENT: Record<string, ParentCategory> = Object.fromEntries(
  (Object.entries(CATEGORY_TAXONOMY) as [ParentCategory, readonly string[]][]).flatMap(
    ([parent, subtypes]) => subtypes.map((s) => [s.toLowerCase(), parent])
  )
);

/** All subtypes flattened (lowercase set) — for fast membership checks */
export const SUBTYPE_SET = new Set(Object.keys(SUBTYPE_TO_PARENT));

// ── Color palette — parent categories and their subtypes share the same hue ──

export const CATEGORY_COLORS: Record<string, string> = {
  // Parents
  housing:                  "#3b82f6",
  groceries:                "#22c55e",
  dining:                   "#fb923c",
  transportation:           "#f59e0b",
  shopping:                 "#a855f7",
  entertainment:            "#ec4899",
  subscriptions:            "#94a3b8",
  healthcare:               "#14b8a6",
  fees:                     "#f97316",
  "debt payments":          "#ef4444",
  "investments & savings":  "#10b981",
  transfers:                "#06b6d4",
  "transfer out":           "#06b6d4",
  "transfers & payments":   "#06b6d4",
  "cash & atm":             "#f87171",
  interest:                 "#f43f5e",
  other:                    "#d1d5db",

  // Housing subtypes
  rent:                     "#3b82f6",
  mortgage:                 "#60a5fa",
  utilities:                "#93c5fd",
  "internet & phone":       "#bfdbfe",
  "home insurance":         "#1d4ed8",
  "condo fees":             "#2563eb",

  // Dining subtypes
  restaurants:              "#fb923c",
  "coffee & drinks":        "#fdba74",
  "fast food":              "#fed7aa",
  "food delivery":          "#ea580c",

  // Transportation subtypes
  gas:                      "#f59e0b",
  parking:                  "#fbbf24",
  "car insurance":          "#fcd34d",
  transit:                  "#d97706",
  rideshare:                "#b45309",
  "auto service":           "#92400e",

  // Shopping subtypes
  clothing:                 "#a855f7",
  electronics:              "#c084fc",
  "home & garden":          "#d8b4fe",
  "online shopping":        "#7c3aed",

  // Entertainment subtypes
  streaming:                "#ec4899",
  "movies & events":        "#f472b6",
  sports:                   "#f9a8d4",
  hobbies:                  "#db2777",

  // Healthcare subtypes
  pharmacy:                 "#14b8a6",
  dental:                   "#2dd4bf",
  vision:                   "#5eead4",
  fitness:                  "#0d9488",
  "health insurance":       "#0f766e",

  // Subscriptions subtypes
  software:                 "#94a3b8",
  memberships:              "#cbd5e1",
  "news & media":           "#64748b",

  // Fees subtypes
  "bank fees":              "#f97316",
  "nsf/od fees":            "#fb923c",
  "annual card fee":        "#fed7aa",

  // Income re-assignment categories
  "income - salary":        "#16a34a",
  "income - other":         "#4ade80",
};

export function categoryColor(name: string): string {
  return CATEGORY_COLORS[name.toLowerCase()] ?? "#a855f7";
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Returns the parent category for any category string.
 * - If it's already a parent → returns as-is (typed).
 * - If it's a subtype        → returns its parent.
 * - If unknown               → returns "Other".
 */
export function getParentCategory(cat: string): ParentCategory {
  const lower = cat.trim().toLowerCase();
  const asParent = PARENT_CATEGORIES.find((p) => p.toLowerCase() === lower);
  if (asParent) return asParent;
  return SUBTYPE_TO_PARENT[lower] ?? "Other";
}

/** True when `cat` is a subtype (not a parent). */
export function isSubtype(cat: string): boolean {
  return SUBTYPE_SET.has(cat.trim().toLowerCase());
}

/** All parents that have at least one subtype. */
export const PARENTS_WITH_SUBTYPES = new Set(
  (Object.entries(CATEGORY_TAXONOMY) as [ParentCategory, readonly string[]][])
    .filter(([, subs]) => subs.length > 0)
    .map(([p]) => p.toLowerCase())
);

// ── Flat category list for pickers / AI prompt ────────────────────────────────
// Parents listed first, then their subtypes indented.

export const PICKER_CATEGORIES: Array<{ value: string; parent: ParentCategory | null; isParent: boolean }> = 
  (Object.entries(CATEGORY_TAXONOMY) as [ParentCategory, readonly string[]][]).flatMap(
    ([parent, subtypes]) => [
      { value: parent, parent: null, isParent: true },
      ...subtypes.map((s) => ({ value: s, parent, isParent: false })),
    ]
  );

/** Flat list of all valid category strings (parents + subtypes). */
export const ALL_CATEGORY_VALUES: readonly string[] = PICKER_CATEGORIES.map((c) => c.value);

/**
 * Prompt-ready category list for the AI — compact format.
 * Returns a string like:
 *   Transportation (or subtype: Gas | Parking | Car Insurance | Transit | Rideshare | Auto Service)
 *   Dining (or subtype: Restaurants | Coffee & Drinks | Fast Food | Food Delivery)
 *   ...
 */
export function buildCategoryPromptLines(): string {
  return (Object.entries(CATEGORY_TAXONOMY) as [ParentCategory, readonly string[]][])
    .map(([parent, subs]) =>
      subs.length > 0
        ? `  ${parent} (or subtype: ${subs.join(" | ")})`
        : `  ${parent}`
    )
    .join("\n");
}
