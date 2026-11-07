/**
 * Shared Stripe client — server-side only.
 * Import only from API routes, never from client components.
 */
import Stripe from "stripe";

if (!process.env.STRIPE_SECRET_KEY) {
  throw new Error("Missing STRIPE_SECRET_KEY environment variable");
}

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

/** Stripe Price ID for the Pro monthly plan. Set in .env */
export const PRO_PRICE_ID = process.env.STRIPE_PRO_PRICE_ID ?? "";

/** Secret used to verify incoming webhook signatures. Set in .env */
export const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET ?? "";
