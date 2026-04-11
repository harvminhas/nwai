import type { Metadata } from "next";
import LegalLayout from "@/components/LegalLayout";

export const metadata: Metadata = {
  title: "Terms of Service",
  description:
    "Terms of Service for networth.online. AI-powered insights are a helpful guide, not guaranteed accurate. Not a substitute for professional financial advice.",
};

export default function TermsPage() {
  return (
    <LegalLayout title="Terms of Service" lastUpdated="April 2025">
      <p>
        By using networth.online, you agree to these terms. We&apos;ve tried to write them in plain
        language — if something isn&apos;t clear, just ask us.
      </p>

      <h2>1. What networth.online does</h2>
      <p>
        networth.online lets you upload a bank statement PDF and get an AI-powered breakdown of
        your finances — net worth, spending by category, savings rate, subscriptions, and
        personalised insights. The goal is to give you a clearer picture of your money, quickly,
        without connecting your bank account.
      </p>

      {/* ── AI ACCURACY — the most important section for this app ── */}
      <h2>2. About our AI — honest expectations</h2>
      <p>
        We want to be upfront about something important: <strong>our AI is genuinely useful,
        but it&apos;s not perfect.</strong>
      </p>
      <p>
        Here&apos;s what that means in practice:
      </p>
      <ul>
        <li>
          <strong>Transaction categorisation may occasionally be wrong.</strong> The AI reads your
          statement and automatically sorts transactions into categories like Groceries, Dining,
          Subscriptions, and so on. It&apos;s right the vast majority of the time, but it can
          misread an unusual merchant name or put something in the wrong bucket. You can correct
          categories manually.
        </li>
        <li>
          <strong>Totals may differ slightly from your official bank statement.</strong> This can
          happen if the AI misses a transaction, rounds differently, or encounters a statement
          format it hasn&apos;t seen before.
        </li>
        <li>
          <strong>Insights are observations, not guarantees.</strong> When the app says
          &ldquo;you could save $X by consolidating debt&rdquo; or flags a recurring charge, it&apos;s
          drawing on patterns in your data — not professional financial analysis.
        </li>
      </ul>
      <p>
        The flip side: <strong>the AI gets smarter over time.</strong> We&apos;re continuously
        improving the model — better at reading more bank formats, better at categorising
        edge cases, better at surfacing insights that are actually useful to you. Think of it
        as a smart assistant that&apos;s already helpful today and keeps improving every month.
      </p>
      <p>
        <strong>The bottom line:</strong> use the dashboard as a helpful guide to understand
        your finances. Always verify anything important — especially exact figures — directly
        with your bank.
      </p>

      <h2>3. Not financial advice</h2>
      <p>
        networth.online is a personal finance tool, not a financial advisory service.
        Nothing in the app — including AI-generated insights, spending summaries, savings
        rate calculations, or debt observations — constitutes professional financial, investment,
        tax, or legal advice.
      </p>
      <p>
        For decisions that materially affect your finances (taking on debt, investing, major
        purchases, tax planning), please consult a qualified financial professional.
      </p>

      <h2>4. Your account</h2>
      <ul>
        <li>You must be 18 or older to use this service.</li>
        <li>You are responsible for keeping your account credentials secure.</li>
        <li>
          You are responsible for the accuracy of the statements you upload. Uploading documents
          that don&apos;t belong to you is not permitted.
        </li>
        <li>One account per person — shared accounts are not currently supported.</li>
      </ul>

      <h2>5. Acceptable use</h2>
      <p>You agree not to:</p>
      <ul>
        <li>Use the service for any unlawful purpose.</li>
        <li>Attempt to reverse-engineer, scrape, or access the service through automated means.</li>
        <li>Upload statements belonging to another person without their consent.</li>
        <li>Attempt to circumvent usage limits or access controls.</li>
      </ul>

      <h2>6. Pro plan and billing</h2>
      <p>
        Some features require a paid Pro subscription. Billing is processed securely through
        Stripe. Subscriptions renew automatically each month unless cancelled. You can cancel
        at any time from your account settings — your access continues until the end of the
        current billing period.
      </p>
      <p>
        We don&apos;t offer refunds for partial months, but if you believe you were charged in
        error, contact us and we&apos;ll make it right.
      </p>

      <h2>7. Termination</h2>
      <p>
        You can delete your account at any time. We may suspend or terminate accounts that
        violate these terms. If we terminate your account for reasons other than a terms
        violation, we&apos;ll give you reasonable notice and a way to export your data.
      </p>

      <h2>8. Limitation of liability</h2>
      <p>
        networth.online is provided &ldquo;as is.&rdquo; To the fullest extent permitted by law,
        we are not liable for:
      </p>
      <ul>
        <li>Financial decisions made based on information displayed in the app.</li>
        <li>Inaccuracies in AI-generated data or insights.</li>
        <li>Data loss due to circumstances outside our reasonable control.</li>
        <li>
          Indirect, incidental, or consequential damages arising from your use of the service.
        </li>
      </ul>

      <h2>9. Changes to these terms</h2>
      <p>
        We may update these terms from time to time. For material changes, we&apos;ll notify you
        by email at least 14 days before they take effect. Continued use after that date
        constitutes acceptance.
      </p>

      <h2>10. Contact</h2>
      <p>
        Questions? Email us at{" "}
        <a href="mailto:hello@networth.online">hello@networth.online</a>.
      </p>
    </LegalLayout>
  );
}
