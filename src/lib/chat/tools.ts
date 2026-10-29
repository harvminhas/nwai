/**
 * Gemini function-calling tool declarations for the AI chat.
 *
 * `TOOL_NAMES` must include every `name` in `functionDeclarations` below — that list is
 * paired with `TOOL_HANDLERS` in executor.ts (`Record<ToolName, …>`) so `tsc` fails if a tool is missing a handler.
 *
 * Tools:
 *   search_transactions      — merchant / category / account / date-range lookups
 *   get_monthly_breakdown    — month-by-month income, core expenses, savings
 *   rollup_categories        — total core spending per category over a month range
 *   rollup_merchants         — top merchants by core spending over a month range
 *   list_recurring_charges   — confirmed subscriptions + manual cash commitments
 *   get_debt_payment_trend   — monthly debt totals (installment vs card servicing)
 *
 * Tool execution lives in executor.ts — handlers delegate to shared `src/lib/**` (see `.cursor/rules/chat-thin-adapters.mdc`).
 */

import { SchemaType } from "@google/generative-ai";
import type { Tool } from "@google/generative-ai";

export const CHAT_TOOLS: Tool[] = [
  {
    functionDeclarations: [
      {
        name: "search_transactions",
        description:
          "Search expense and/or income transactions by merchant name, categories, account, " +
          "or date range. Use this for ANY question about specific spending, merchants, " +
          "categories, or time periods. Merchant matching is fuzzy. " +
          "Call this tool before answering any transaction-level question — never fabricate transaction lists.",
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            merchant: {
              type: SchemaType.STRING,
              description:
                "Specific merchant name (fuzzy, case-insensitive). Use only for named-merchant " +
                "queries (e.g. 'Costco', 'Amazon'). For spending-type queries use `categories`.",
            },
            categories: {
              type: SchemaType.ARRAY,
              items: { type: SchemaType.STRING },
              description:
                "One or more category/subtype values (OR logic — returns transactions matching ANY). " +
                "Always include the parent AND all relevant subtypes to catch every possible tag. " +
                "Example — barber/hair: [\"Personal Care\", \"Barber\", \"Salon & Haircare\"]. " +
                "Example — eating out: [\"Dining\", \"Restaurants\", \"Fast Food\", \"Food Delivery\"]. " +
                "Example — fitness: [\"Healthcare\", \"Fitness\"]. " +
                "Use the full taxonomy from the system context to pick the right values.",
            },
            account: {
              type: SchemaType.STRING,
              description:
                "Partial account name, bank name, or type (fuzzy). " +
                "E.g. 'TD', 'visa', 'checking', 'RBC savings'.",
            },
            from_date: {
              type: SchemaType.STRING,
              description: "Start date inclusive. Format YYYY-MM-DD or YYYY-MM.",
            },
            to_date: {
              type: SchemaType.STRING,
              description: "End date inclusive. Format YYYY-MM-DD or YYYY-MM.",
            },
            include_income: {
              type: SchemaType.BOOLEAN,
              description:
                "Set true to also search income deposits (e.g. paycheque, transfer in). " +
                "Default false (expenses only).",
            },
            limit: {
              type: SchemaType.NUMBER,
              description: "Max rows to return. Default 200, max 500.",
            },
          },
        },
      },
      {
        name: "get_monthly_breakdown",
        description:
          "Get month-by-month income, expenses, and savings figures. Use for trend analysis, " +
          "month-over-month comparisons, or savings rate questions. " +
          "Optionally include per-category expense breakdown per month.",
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            from_month: {
              type: SchemaType.STRING,
              description: "Start month YYYY-MM. Defaults to earliest available.",
            },
            to_month: {
              type: SchemaType.STRING,
              description: "End month YYYY-MM. Defaults to latest available.",
            },
            by_category: {
              type: SchemaType.BOOLEAN,
              description:
                "If true, include per-category expense totals for each month.",
            },
          },
        },
      },
      {
        name: "rollup_categories",
        description:
          "Roll up total CORE spending (excludes transfers, interest, card/LOC servicing) by expense category " +
          "across a calendar month range. Use when the user asks how much they spent on Dining, Groceries, " +
          "a whole parent category, or wants a category ranking for a quarter/year — without needing every transaction row.",
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            from_month: {
              type: SchemaType.STRING,
              description: "Start month YYYY-MM inclusive. Defaults to earliest transaction month.",
            },
            to_month: {
              type: SchemaType.STRING,
              description: "End month YYYY-MM inclusive. Defaults to latest transaction month.",
            },
            parent_category_only: {
              type: SchemaType.BOOLEAN,
              description:
                "If true, aggregate under parent taxonomy labels (e.g. all Dining subtypes → Dining). " +
                "If false, keep raw subtype labels. Default false.",
            },
          },
        },
      },
      {
        name: "rollup_merchants",
        description:
          "Rank merchants by total CORE spending over a month range (same exclusions as rollup_categories). " +
          "Use for “where did my money go”, top stores, or merchant concentration — not for listing individual transactions.",
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            from_month: {
              type: SchemaType.STRING,
              description: "Start month YYYY-MM inclusive.",
            },
            to_month: {
              type: SchemaType.STRING,
              description: "End month YYYY-MM inclusive.",
            },
            limit: {
              type: SchemaType.NUMBER,
              description: "Max merchants to return. Default 25, max 50.",
            },
          },
        },
      },
      {
        name: "list_recurring_charges",
        description:
          "Return confirmed subscription merchants (with amounts/frequency) plus manual recurring cash commitments. " +
          "Use for subscription audits, fixed-cost questions, or “what do I pay every month”.",
        parameters: {
          type: SchemaType.OBJECT,
          properties: {},
        },
      },
      {
        name: "get_debt_payment_trend",
        description:
          "Month-by-month debt cashflows from consolidated history: total debt payments, card/LOC servicing subset, " +
          "and minimum scheduled payments when available. Use for payoff pace, minimums vs extra, or debt burden questions.",
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            months: {
              type: SchemaType.NUMBER,
              description:
                "How many recent calendar months to include. Returned oldest→newest within that window. Default 12, max 36.",
            },
          },
        },
      },
      {
        name: "get_income_summary",
        description:
          "Get income summary using THE SAME calculation as the Income page (buildIncomeSummary). " +
          "Returns typical monthly income, breakdown by source, bonus transactions, and per-source totals. " +
          "Use for income questions, earnings analysis, or 'how much did I make from X' queries. " +
          "Fuzzy matches source names (e.g., 'MAM' will find 'MAM Construction'). " +
          "Supports time ranges: 3mo, 12mo, ytd, or custom month list.",
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            range: {
              type: SchemaType.STRING,
              description: "Time range: '3mo', '12mo', 'ytd', or comma-separated months 'YYYY-MM,YYYY-MM'. Default '3mo'.",
            },
          },
        },
      },
      {
        name: "get_spending_summary",
        description:
          "Get spending summary using THE SAME calculation as the Spending page (buildSpendingSummary). " +
          "Returns typical monthly spending, bucket breakdown (fixed/essentials/flexible), " +
          "category totals, and includes cash commitments. Use for spending analysis, " +
          "budget questions, or 'how much do I spend on X' queries.",
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            range: {
              type: SchemaType.STRING,
              description: "Time range: '3mo', '12mo', 'ytd', or comma-separated months. Default '3mo'.",
            },
          },
        },
      },
      {
        name: "list_cash_expenses",
        description:
          "List recurring cash expenses (manual expenses not in bank statements). " +
          "Shows name, amount, frequency (weekly/biweekly/monthly/quarterly/yearly), " +
          "monthly equivalent, next due date, and paused/skipped status. " +
          "Use for 'cash expenses', 'manual expenses', or 'recurring payments not in statements'.",
        parameters: {
          type: SchemaType.OBJECT,
          properties: {},
        },
      },
      {
        name: "get_savings_summary",
        description:
          "Get savings calculation using THE SAME method as the Savings drawer " +
          "(computeWindowSavings: cash change + debt paydown + investment contributions). " +
          "Returns typical monthly savings and breakdown. Use for savings rate, " +
          "savings questions, or 'how much am I saving' queries.",
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            range: {
              type: SchemaType.STRING,
              description: "Time range: '3mo', '12mo', 'ytd', or comma-separated months. Default '3mo'.",
            },
          },
        },
      },
      {
        name: "get_net_worth",
        description:
          "Get current net worth summary: total assets, total debts, net worth, " +
          "and monthly change. THE SAME calculation as the dashboard card. " +
          "Use for net worth questions, wealth tracking, or balance summaries.",
        parameters: {
          type: SchemaType.OBJECT,
          properties: {},
        },
      },
      {
        name: "list_accounts",
        description:
          "List all accounts (assets and debts) with current balances, account types, " +
          "and recent balance history. Use for 'what accounts do I have', " +
          "'show my accounts', or balance tracking questions.",
        parameters: {
          type: SchemaType.OBJECT,
          properties: {},
        },
      },
      {
        name: "list_subscriptions",
        description:
          "List ONLY confirmed subscriptions (recurring merchants detected in transactions). " +
          "Shows name, amount, frequency, and last seen date. " +
          "Use for subscription audits or 'what subscriptions do I have'.",
        parameters: {
          type: SchemaType.OBJECT,
          properties: {},
        },
      },
      {
        name: "list_plans",
        description:
          "List budget plans from the Planner tool. Shows plan name, budget, amount spent, " +
          "linked transactions, cash entries, and status (upcoming/active/completed). " +
          "Use for budget questions, plan tracking, or 'what plans do I have'.",
        parameters: {
          type: SchemaType.OBJECT,
          properties: {},
        },
      },
    ],
  },
];

export const TOOL_NAMES = [
  "search_transactions",
  "get_monthly_breakdown",
  "rollup_categories",
  "rollup_merchants",
  "list_recurring_charges",
  "get_debt_payment_trend",
  "get_income_summary",
  "get_spending_summary",
  "list_cash_expenses",
  "get_savings_summary",
  "get_net_worth",
  "list_accounts",
  "list_subscriptions",
  "list_plans",
] as const;
export type ToolName = (typeof TOOL_NAMES)[number];
