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
  "Personal Care",
  "Subscriptions",
  "Education",
  "Fees",
  "Travel",
  "Taxes",
  "Debt Payments",
  "Insurance",
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
  Housing:                ["Rent", "Mortgage", "Utilities", "Internet & Phone", "Home Insurance", "Condo Fees", "Maintenance & Repairs"],
  Groceries:              [],
  Dining:                 ["Restaurants", "Coffee & Drinks", "Fast Food", "Food Delivery"],
  Transportation:         ["Gas", "Parking", "Car Insurance", "Transit", "Rideshare", "Auto Service"],
  Shopping:               ["Clothing", "Electronics", "Home & Garden", "Online Shopping"],
  Entertainment:          ["Streaming", "Movies & Events", "Sports", "Hobbies"],
  Healthcare:             ["Pharmacy", "Dental", "Vision", "Fitness", "Health Insurance", "Vet"],
  "Personal Care":        ["Spa", "Salon & Haircare", "Massage", "Skincare & Beauty", "Barber", "Nail Care"],
  Subscriptions:          ["Software", "Memberships", "News & Media"],
  Education:              ["Tuition", "Courses & Training", "Books & Supplies", "School Fees", "Childcare"],
  Fees:                   ["Bank Fees", "NSF/OD Fees", "Annual Card Fee"],
  Travel:                 ["Accommodation", "Flights", "Car Rental", "Train & Bus", "Cruise", "Travel Insurance", "Vacation Packages"],
  Taxes:                  ["Property Tax", "Income Tax", "HST / GST", "Sales Tax", "Business Tax", "Capital Gains Tax"],
  "Debt Payments":        ["Credit Card Payment", "Loan Payment", "Mortgage Payment", "Line of Credit", "Student Loan"],
  Insurance:              ["Life Insurance", "Disability Insurance", "Critical Illness", "Tenant Insurance", "Pet Insurance"],
  "Investments & Savings":["RRSP", "TFSA", "RESP", "Stocks & ETFs", "Mutual Funds", "GICs & Bonds", "Crypto", "Emergency Fund"],
  Transfers:              ["Transfer In", "Incoming Transfer"],
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
  travel:                   "#0ea5e9",
  taxes:                    "#dc2626",
  insurance:                "#8b5cf6",

  "debt payments":          "#ef4444",
  "credit card payment":    "#ef4444",
  "loan payment":           "#f87171",
  "mortgage payment":       "#fca5a5",
  "line of credit":         "#dc2626",
  "student loan":           "#b91c1c",

  "investments & savings":  "#10b981",
  rrsp:                     "#10b981",
  tfsa:                     "#34d399",
  resp:                     "#6ee7b7",
  "stocks & etfs":          "#059669",
  "mutual funds":           "#047857",
  "gics & bonds":           "#065f46",
  crypto:                   "#0d9488",
  "emergency fund":         "#14b8a6",
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
  "maintenance & repairs":  "#1e40af",

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
  vet:                      "#0e7490",

  // Personal Care subtypes
  "personal care":          "#f472b6",
  spa:                      "#f472b6",
  "salon & haircare":       "#f9a8d4",
  massage:                  "#fbcfe8",
  "skincare & beauty":      "#fce7f3",
  barber:                   "#ec4899",
  "nail care":              "#db2777",

  // Subscriptions subtypes
  software:                 "#94a3b8",
  memberships:              "#cbd5e1",
  "news & media":           "#64748b",

  // Education subtypes
  education:                "#6366f1",
  tuition:                  "#6366f1",
  "courses & training":     "#818cf8",
  "books & supplies":       "#a5b4fc",
  "school fees":            "#4f46e5",
  childcare:                "#4338ca",

  // Fees subtypes
  "bank fees":              "#f97316",
  "nsf/od fees":            "#fb923c",
  "annual card fee":        "#fed7aa",

  // Travel subtypes
  accommodation:            "#0ea5e9",
  flights:                  "#38bdf8",
  "car rental":             "#7dd3fc",
  "train & bus":            "#bae6fd",
  cruise:                   "#0284c7",
  "travel insurance":       "#0369a1",
  "vacation packages":      "#075985",

  // Taxes subtypes
  "property tax":           "#dc2626",
  "income tax":             "#ef4444",
  "hst / gst":              "#f87171",
  "sales tax":              "#fca5a5",
  "business tax":           "#b91c1c",
  "capital gains tax":      "#991b1b",

  // Insurance subtypes
  "life insurance":         "#8b5cf6",
  "disability insurance":   "#a78bfa",
  "critical illness":       "#c4b5fd",
  "tenant insurance":       "#6d28d9",
  "pet insurance":          "#5b21b6",

  // Income re-assignment categories
  "income - salary":        "#16a34a",
  "income - other":         "#4ade80",
};

export function categoryColor(name: string): string {
  return CATEGORY_COLORS[name.toLowerCase()] ?? "#a855f7";
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Aliases for AI-generated category strings that don't match the taxonomy.
 * Keys are lowercase. Add entries here whenever the AI produces a new variant.
 */
const CATEGORY_ALIASES: Record<string, ParentCategory> = {
  // Groceries / Retail variants
  "retail & grocery":       "Groceries",
  "grocery":                "Groceries",
  "supermarket":            "Groceries",
  "retail":                 "Shopping",
  "retail shopping":        "Shopping",

  // Dining variants
  "food & dining":          "Dining",
  "food & drink":           "Dining",
  "food":                   "Dining",
  "bar & restaurant":       "Dining",
  "bar":                    "Dining",
  "cafe":                   "Dining",

  // Transportation variants
  "transport":              "Transportation",
  "travel & transport":     "Transportation",
  "gas & fuel":             "Transportation",
  "fuel":                   "Transportation",
  "automotive":             "Transportation",

  // Housing variants
  "utilities":              "Housing",
  "rent & utilities":       "Housing",
  "home":                   "Housing",
  "telecom":                "Housing",
  "internet":               "Housing",
  "phone":                  "Housing",

  // Health variants
  "health & wellness":      "Healthcare",
  "health":                 "Healthcare",
  "medical":                "Healthcare",
  "wellness":               "Healthcare",
  "gym":                    "Healthcare",

  // Entertainment / Subscriptions
  "streaming services":     "Entertainment",
  "software & subscriptions": "Subscriptions",
  "subscription":           "Subscriptions",
  "apps":                   "Subscriptions",

  // Personal Care misc
  "salon":                  "Personal Care",
  "nail salon":             "Personal Care",
  "hair salon":             "Personal Care",
  "haircare":               "Personal Care",
  "hair care":              "Personal Care",
  "hairdresser":            "Personal Care",
  "beauty salon":           "Personal Care",
  "beauty":                 "Personal Care",
  "skincare":               "Personal Care",
  "grooming":               "Personal Care",

  // Healthcare misc
  "veterinary":             "Healthcare",
  "pet care":               "Healthcare",
  "pet health":             "Healthcare",

  // Travel
  "hotel":                  "Travel",
  "hotels":                 "Travel",
  "motel":                  "Travel",
  "resort":                 "Travel",
  "airbnb":                 "Travel",
  "hostel":                 "Travel",
  "lodging":                "Travel",
  "airline":                "Travel",
  "airways":                "Travel",
  "air travel":             "Travel",
  "flight":                 "Travel",
  "train":                  "Travel",
  "via rail":               "Travel",
  "amtrak":                 "Travel",
  "bus":                    "Travel",
  "ferry":                  "Travel",
  "travel":                 "Travel",
  "hotel, entertainment and recreation": "Travel",

  // Debt Payments
  "credit card":            "Debt Payments",
  "loan":                   "Debt Payments",
  "debt":                   "Debt Payments",
  "debt payment":           "Debt Payments",
  "line of credit":         "Debt Payments",
  "heloc":                  "Debt Payments",
  "student loan":           "Debt Payments",

  // Insurance
  "life insurance":         "Insurance",
  "disability":             "Insurance",
  "disability insurance":   "Insurance",
  "critical illness":       "Insurance",
  "tenant insurance":       "Insurance",
  "renter's insurance":     "Insurance",
  "pet insurance":          "Insurance",
  "insurance":              "Insurance",

  // Investments & Savings
  "investment":             "Investments & Savings",
  "investments":            "Investments & Savings",
  "savings":                "Investments & Savings",
  "rrsp":                   "Investments & Savings",
  "tfsa":                   "Investments & Savings",
  "resp":                   "Investments & Savings",
  "stocks":                 "Investments & Savings",
  "etf":                    "Investments & Savings",
  "mutual fund":            "Investments & Savings",
  "gic":                    "Investments & Savings",
  "bond":                   "Investments & Savings",
  "cryptocurrency":         "Investments & Savings",
  "crypto":                 "Investments & Savings",
  "brokerage":              "Investments & Savings",
  "wealthsimple":           "Investments & Savings",
  "questrade":              "Investments & Savings",
  "fidelity":               "Investments & Savings",

  // Taxes
  "tax":                    "Taxes",
  "taxes":                  "Taxes",
  "property tax":           "Taxes",
  "income tax":             "Taxes",
  "hst":                    "Taxes",
  "gst":                    "Taxes",
  "hst/gst":                "Taxes",
  "sales tax":              "Taxes",
  "government":             "Taxes",
  "government services":    "Taxes",
  "municipal tax":          "Taxes",

  // Transfers / misc
  "transfer in":            "Transfers",
  "incoming transfer":      "Transfers",
  "interac":                "Transfers",
  "e-transfer":             "Transfers",
  "wire transfer":          "Transfers",
};

/**
 * Returns the parent category for any category string.
 * - If it's already a parent → returns as-is (typed).
 * - If it's a subtype        → returns its parent.
 * - If it's an alias         → returns the mapped parent.
 * - If unknown               → returns "Other".
 */
export function getParentCategory(cat: string): ParentCategory {
  const lower = cat.trim().toLowerCase();
  const asParent = PARENT_CATEGORIES.find((p) => p.toLowerCase() === lower);
  if (asParent) return asParent;
  return SUBTYPE_TO_PARENT[lower] ?? CATEGORY_ALIASES[lower] ?? "Other";
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
