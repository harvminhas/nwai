/**
 * Synthetic Assets/Debts summaries for the unauthenticated preview harness.
 * Long names, large amounts, manual + imported rows, many categories, 12 months.
 * Not live financial data.
 */

import type { AssetsSummary, AssetGroup } from "@/lib/assetsSummary";
import type { DebtsSummary, DebtGroup } from "@/lib/debtsSummary";
import type { ManualAsset, ManualLiability } from "@/lib/types";

const MONTHS = [
  "2025-04", "2025-05", "2025-06", "2025-07", "2025-08", "2025-09",
  "2025-10", "2025-11", "2025-12", "2026-01", "2026-02", "2026-03",
] as const;

const MONTH_LABELS = [
  "Apr 2025", "May 2025", "Jun 2025", "Jul 2025", "Aug 2025", "Sep 2025",
  "Oct 2025", "Nov 2025", "Dec 2025", "Jan 2026", "Feb 2026", "Mar 2026",
] as const;

function manualAsset(
  partial: Pick<ManualAsset, "id" | "label" | "category" | "value">
): ManualAsset {
  return { updatedAt: "2026-03-01T00:00:00Z", ...partial };
}

function manualLiability(
  partial: Pick<ManualLiability, "id" | "label" | "category" | "balance"> & {
    interestRate?: number;
  }
): ManualLiability {
  return { updatedAt: "2026-03-01T00:00:00Z", ...partial };
}

const assetGroups: AssetGroup[] = [
  {
    type: "property",
    label: "Property",
    total: 1_300_000,
    accounts: [],
    manualAssets: [
      manualAsset({
        id: "house-1",
        label: "2 Bettey Drive Family Home with Very Long Street Name",
        category: "property",
        value: 1_300_000,
      }),
    ],
  },
  {
    type: "registered",
    label: "Registered (RRSP/TFSA)",
    total: 419_778,
    accounts: [
      {
        slug: "questrade-rrsp-8044",
        bankName: "Questrade",
        accountName: "Individual Registered Retirement Savings Plan (RRSP)",
        accountType: "rrsp",
        balance: 196_263,
        currency: "CAD",
        statementMonth: "2026-03",
        isStale: false,
        daysOld: 4,
        lastTransactionDate: "2026-03-12",
      },
      {
        slug: "hpe-401k-s3tw",
        bankName: "HPE Hewlett Packard Enterprise 401(k) Plan",
        accountName: "HPE Hewlett Packard Enterprise 401(k) Plan",
        accountType: "401k",
        balance: 100_306,
        currency: "CAD",
        statementMonth: "2026-03",
        isStale: false,
        daysOld: 8,
      },
      {
        slug: "ws-lira-6cad",
        bankName: "Wealthsimple Investments Inc.",
        accountName: "Order Execution Only LIRA Account",
        accountType: "lira",
        balance: 123_209,
        currency: "CAD",
        statementMonth: "2026-03",
        isStale: false,
        daysOld: 2,
        lastTransactionDate: "2026-03-12",
      },
    ],
    manualAssets: [],
  },
  {
    type: "investments",
    label: "Investments",
    total: 84_250,
    accounts: [
      {
        slug: "td-direct-investing-brokerage-99aa",
        bankName: "TD Direct Investing",
        accountName: "Self-Directed Brokerage",
        accountType: "investment",
        balance: 62_140,
        currency: "CAD",
        statementMonth: "2026-03",
        isStale: false,
        daysOld: 3,
      },
    ],
    manualAssets: [
      manualAsset({
        id: "car-1",
        label: "2022 Honda Civic",
        category: "vehicle",
        value: 22_110,
      }),
    ],
  },
  {
    type: "cash",
    label: "Cash & Savings",
    total: 43_235,
    accounts: [
      {
        slug: "cibc-chequing-1122",
        bankName: "Canadian Imperial Bank of Commerce",
        accountName: "Everyday Chequing Plus Unlimited",
        accountType: "checking",
        balance: 18_420.55,
        currency: "CAD",
        statementMonth: "2026-03",
        isStale: false,
        daysOld: 1,
        lastTransactionDate: "2026-03-28",
      },
      {
        slug: "ally-savings-usd-fx",
        bankName: "Ally Bank",
        accountName: "Online Savings (USD, FX-converted)",
        accountType: "savings",
        balance: 24_814.45,
        currency: "CAD",
        statementMonth: "2026-03",
        isStale: false,
        daysOld: 6,
      },
    ],
    manualAssets: [],
  },
  {
    type: "other",
    label: "Other Assets",
    total: 2_500,
    accounts: [],
    manualAssets: [
      manualAsset({
        id: "art-1",
        label: "Studio pottery collection",
        category: "other",
        value: 2_500,
      }),
    ],
  },
];

const debtGroups: DebtGroup[] = [
  {
    type: "mortgage",
    label: "Mortgages",
    totalBalance: -420_000,
    accounts: [
      {
        slug: "rbc-mortgage-home-8841",
        bankName: "Royal Bank of Canada",
        accountName: "Homeline Plan First Mortgage",
        accountType: "mortgage",
        balance: -420_000,
        currency: "CAD",
        interestRate: 4.29,
        statementMonth: "2026-03",
        monthlyPayment: 2_140,
        minPayment: 2_140,
        lastTransactionDate: "2026-03-01",
      },
    ],
    manualLiabilities: [],
  },
  {
    type: "credit_card",
    label: "Credit Cards",
    totalBalance: -12_847.32,
    accounts: [
      {
        slug: "amex-platinum-rewards-world",
        bankName: "Very Long Bank Name International Holdings",
        accountName: "Platinum Rewards World Elite Mastercard Ending In Extra Words",
        accountType: "credit_card",
        balance: -8_412.18,
        currency: "CAD",
        interestRate: 20.99,
        statementMonth: "2026-03",
        monthlyPayment: 250,
        minPayment: 170,
        lastTransactionDate: "2026-03-22",
      },
      {
        slug: "cibc-dividend-visa",
        bankName: "CIBC",
        accountName: "Dividend Visa Infinite",
        accountType: "credit_card",
        balance: -4_435.14,
        currency: "CAD",
        interestRate: 19.99,
        statementMonth: "2026-03",
        monthlyPayment: 120,
        minPayment: 89,
      },
    ],
    manualLiabilities: [],
  },
  {
    type: "loc",
    label: "Lines of Credit",
    totalBalance: -18_000,
    accounts: [
      {
        slug: "td-heloc-flexline",
        bankName: "TD Canada Trust",
        accountName: "Home Equity FlexLine",
        accountType: "loc",
        balance: -18_000,
        currency: "CAD",
        interestRate: 7.45,
        statementMonth: "2026-03",
        monthlyPayment: 180,
        minPayment: 90,
      },
    ],
    manualLiabilities: [],
  },
  {
    type: "other",
    label: "Other Debts",
    totalBalance: -6_400,
    accounts: [],
    manualLiabilities: [
      manualLiability({
        id: "osap-manual",
        label: "OSAP provincial student loan (manual)",
        category: "student_loan",
        balance: -6_400,
        interestRate: 5.5,
      }),
    ],
  },
];

function assetsHistory(kind: "many" | "one" | "empty"): AssetsSummary["monthlyHistory"] {
  if (kind === "empty") return [];
  const detailsMany = [
    { slug: "house-1", label: "2 Bettey Drive Family Home with Very Long Street Name", type: "property", value: 1_300_000 },
    { slug: "questrade-rrsp-8044", label: "Questrade · Individual Registered Retirement Savings Plan (RRSP)", type: "registered", value: 196_263 },
    { slug: "hpe-401k-s3tw", label: "HPE Hewlett Packard Enterprise 401(k) Plan", type: "registered", value: 100_306 },
    { slug: "ws-lira-6cad", label: "Wealthsimple Investments Inc. · Order Execution Only LIRA Account", type: "registered", value: 123_209 },
    { slug: "td-direct-investing-brokerage-99aa", label: "TD Direct Investing · Self-Directed Brokerage", type: "investments", value: 62_140 },
    { slug: "car-1", label: "2022 Honda Civic", type: "manual-vehicle", value: 22_110 },
    { slug: "cibc-chequing-1122", label: "Canadian Imperial Bank of Commerce · Everyday Chequing Plus Unlimited", type: "cash", value: 18_420.55 },
    { slug: "ally-savings-usd-fx", label: "Ally Bank · Online Savings (USD, FX-converted)", type: "cash", value: 24_814.45 },
    { slug: "art-1", label: "Studio pottery collection", type: "other", value: 2_500 },
  ];
  const latestTotal = detailsMany.reduce((s, r) => s + r.value, 0);
  if (kind === "one") {
    return [
      {
        month: "2026-03",
        monthLabel: "Mar 2026",
        total: latestTotal,
        groups: assetGroups.map((g) => ({ type: g.type, total: g.total })),
        accountDetails: detailsMany,
      },
    ];
  }
  return MONTHS.map((month, i) => {
    const drift = (i - (MONTHS.length - 1)) * 4200;
    const total = latestTotal + drift;
    return {
      month,
      monthLabel: MONTH_LABELS[i],
      total,
      groups: assetGroups.map((g) => ({ type: g.type, total: g.total + drift / assetGroups.length })),
      accountDetails: detailsMany.map((row, idx) => ({
        ...row,
        value: idx === 0 ? row.value : row.value + drift / (detailsMany.length - 1),
      })),
    };
  });
}

function debtsHistory(kind: "many" | "one" | "empty"): DebtsSummary["monthlyHistory"] {
  if (kind === "empty") return [];
  const detailsMany = [
    { slug: "rbc-mortgage-home-8841", label: "Royal Bank of Canada · Homeline Plan First Mortgage", type: "mortgage", value: -420_000 },
    { slug: "amex-platinum-rewards-world", label: "Very Long Bank Name International Holdings · Platinum Rewards World Elite Mastercard Ending In Extra Words", type: "credit_card", value: -8_412.18 },
    { slug: "cibc-dividend-visa", label: "CIBC · Dividend Visa Infinite", type: "credit_card", value: -4_435.14 },
    { slug: "td-heloc-flexline", label: "TD Canada Trust · Home Equity FlexLine", type: "loc", value: -18_000 },
    { slug: "osap-manual", label: "OSAP provincial student loan (manual)", type: "other", value: -6_400 },
  ];
  const latestAbs = detailsMany.reduce((s, r) => s + Math.abs(r.value), 0);
  if (kind === "one") {
    return [
      {
        month: "2026-03",
        monthLabel: "Mar 2026",
        totalDebt: latestAbs,
        totalPayments: 2_690,
        groups: debtGroups.map((g) => ({ type: g.type, balance: g.totalBalance })),
        accountDetails: detailsMany,
      },
    ];
  }
  return MONTHS.map((month, i) => {
    const extra = (MONTHS.length - 1 - i) * 1800;
    const totalDebt = latestAbs + extra;
    return {
      month,
      monthLabel: MONTH_LABELS[i],
      totalDebt,
      totalPayments: 2_690,
      groups: debtGroups.map((g) => ({ type: g.type, balance: g.totalBalance })),
      accountDetails: detailsMany.map((row, idx) => ({
        ...row,
        value: idx === 0 ? row.value - extra : row.value,
      })),
    };
  });
}

export type PreviewMonthKind = "many" | "one" | "empty";

export function buildPreviewAssetsSummary(kind: PreviewMonthKind = "many"): AssetsSummary {
  const groups = kind === "empty" ? [] : assetGroups;
  const monthlyHistory = assetsHistory(kind);
  const totalAssets = groups.reduce((s, g) => s + g.total, 0);
  return {
    totalAssets,
    currency: "CAD",
    changeVsLastMonth: 12_450.22,
    changeVs12Months: 84_210.08,
    groups,
    monthlyHistory,
    staleAccounts: [],
    accountBalanceHistory: [],
    expenseTxns: [],
    incomeTxns: [],
  };
}

export function buildPreviewDebtsSummary(kind: PreviewMonthKind = "many"): DebtsSummary {
  const groups = kind === "empty" ? [] : debtGroups;
  const monthlyHistory = debtsHistory(kind);
  const totalDebt = groups.reduce((s, g) => s + Math.abs(g.totalBalance), 0);
  return {
    totalDebt,
    currency: "CAD",
    changeVsLastMonth: -2_180.4,
    changeVs12Months: -18_640,
    monthlyPayments: 2_690,
    interestPaidLast3Months: 6_412.55,
    interestPaidByYear: [{ period: "2026", total: 25_650.2 }],
    weightedAvgRate: 5.12,
    groups,
    payoffEstimates: [
      { accountSlug: "rbc-mortgage-home-8841", monthsToPayoff: 214, payoffDate: "2043-12" },
      { accountSlug: "amex-platinum-rewards-world", monthsToPayoff: 48, payoffDate: "2030-03" },
    ],
    monthlyHistory,
    accountBalanceHistory: [],
    expenseTxns: [],
    incomeTxns: [],
  };
}

export type PreviewSwitcherItem = {
  key: string;
  label: string;
  sub: string;
  amount: number | null;
  href: string;
  group: string;
  icon: "asset" | "debt";
  cur: string;
};

export function buildPreviewSwitcherItems(side: "assets" | "debts"): PreviewSwitcherItem[] {
  if (side === "assets") {
    const assets = buildPreviewAssetsSummary("many");
    const items: PreviewSwitcherItem[] = [];
    for (const g of assets.groups) {
      for (const acc of g.accounts) {
        items.push({
          key: `acc-${acc.slug}`,
          label: acc.bankName + (acc.accountName ? ` · ${acc.accountName}` : ""),
          sub: `${g.label} · imported`,
          amount: acc.balance,
          href: `/account/accounts/${acc.slug}`,
          group: g.label,
          icon: "asset",
          cur: assets.currency,
        });
      }
      for (const asset of g.manualAssets) {
        items.push({
          key: `man-${asset.id}`,
          label: asset.label,
          sub: `${g.label} · manual`,
          amount: asset.value,
          href: `/account/assets/${asset.id}`,
          group: g.label,
          icon: "asset",
          cur: assets.currency,
        });
      }
    }
    return items;
  }
  const debts = buildPreviewDebtsSummary("many");
  const items: PreviewSwitcherItem[] = [];
  for (const g of debts.groups) {
    for (const acc of g.accounts) {
      items.push({
        key: `debt-${acc.slug}`,
        label: acc.bankName + (acc.accountName ? ` · ${acc.accountName}` : ""),
        sub: `${g.label} · imported`,
        amount: Math.abs(acc.balance ?? 0),
        href: `/account/accounts/${acc.slug}`,
        group: g.label,
        icon: "debt",
        cur: debts.currency,
      });
    }
    for (const liability of g.manualLiabilities) {
      items.push({
        key: `man-${liability.id}`,
        label: liability.label,
        sub: `${g.label} · manual`,
        amount: Math.abs(liability.balance),
        href: `/account/liabilities`,
        group: g.label,
        icon: "debt",
        cur: debts.currency,
      });
    }
  }
  return items;
}
