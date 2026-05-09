/**
 * Gemini function-calling tool declarations for the AI chat.
 *
 * Two tools cover every query type:
 *   search_transactions  — merchant / category / account / date-range lookups
 *   get_monthly_breakdown — trend analysis and month comparisons
 *
 * Tool execution lives in executor.ts (pure in-memory, no extra DB reads).
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
    ],
  },
];

export const TOOL_NAMES = ["search_transactions", "get_monthly_breakdown"] as const;
export type ToolName = (typeof TOOL_NAMES)[number];
