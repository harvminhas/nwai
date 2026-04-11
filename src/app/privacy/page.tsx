import type { Metadata } from "next";
import LegalLayout from "@/components/LegalLayout";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "How networth.online collects, uses, and protects your data. Your PDF files are discarded after parsing — we only retain the financial data needed to power your dashboard.",
};

export default function PrivacyPage() {
  return (
    <LegalLayout title="Privacy Policy" lastUpdated="April 2025">
      <p>
        Your financial data is sensitive, and we treat it that way. This policy explains exactly
        what we collect, what we do with it, and what we don&apos;t do with it.
      </p>

      <h2>The short version</h2>
      <ul>
        <li>We never ask for your bank login or credentials — ever.</li>
        <li>Your uploaded PDF is processed and then <strong>discarded</strong>. We don&apos;t store the raw file.</li>
        <li>We store the extracted transaction data so your dashboard works across sessions.</li>
        <li>We don&apos;t sell your data. We don&apos;t share it with advertisers. Full stop.</li>
      </ul>

      <h2>1. What we collect</h2>
      <h3>Information you provide</h3>
      <ul>
        <li><strong>Account information</strong> — your email address and name when you sign up.</li>
        <li>
          <strong>Statement data</strong> — when you upload a bank statement, our AI reads and
          extracts your transactions, account balances, income, and spending categories. This
          extracted data is stored so your dashboard can display it.
        </li>
      </ul>

      <h3>Information collected automatically</h3>
      <ul>
        <li>
          <strong>Usage data</strong> — basic information about how you use the app (pages visited,
          features used) to help us improve the product. This is not linked to your financial data.
        </li>
      </ul>

      <h2>2. What we don&apos;t collect</h2>
      <ul>
        <li>Your bank login credentials — we never ask for them, ever.</li>
        <li>Your raw PDF file — it is processed and immediately deleted from our servers.</li>
        <li>Payment card numbers — billing is handled entirely by our payment processor.</li>
      </ul>

      <h2>3. How we use your data</h2>
      <ul>
        <li>To power your financial dashboard (net worth, spending breakdown, savings rate, insights).</li>
        <li>To send you transactional emails (account confirmation, password reset).</li>
        <li>To improve our AI parsing accuracy over time using anonymised, aggregated patterns — never your personally identifiable information.</li>
        <li>To communicate product updates if you opt in.</li>
      </ul>

      <h2>4. Who we share data with</h2>
      <p>
        We use a small number of trusted third-party services to operate the product. Each receives
        only the minimum data necessary:
      </p>
      <ul>
        <li>
          <strong>Google Firebase / Firestore</strong> — stores your account and financial profile
          data securely in the cloud.
        </li>
        <li>
          <strong>AI processing provider</strong> — your statement text is sent to an AI model to
          extract and categorise transactions. The provider does not retain this data for training
          beyond the immediate request.
        </li>
        <li>
          <strong>Resend</strong> — used to send transactional emails (e.g. account confirmation).
          Your email address is shared for delivery purposes only.
        </li>
        <li>
          <strong>Stripe</strong> — handles billing for Pro plan subscribers. We never see or store
          your full card number.
        </li>
      </ul>
      <p>We do not sell, rent, or trade your personal information to any third party.</p>

      <h2>5. Data retention</h2>
      <p>
        Your financial data is retained for as long as your account is active. You can delete
        individual statements at any time from your dashboard, or request full account deletion
        by contacting us. We will permanently delete your data within 30 days of a deletion request.
      </p>

      <h2>6. Security</h2>
      <p>
        All data is encrypted in transit (HTTPS) and at rest. Access to your data is restricted
        to your account. We use Firebase Authentication for secure login and regularly review
        our security practices.
      </p>

      <h2>7. Your rights</h2>
      <p>Depending on where you live, you may have the right to:</p>
      <ul>
        <li>Access the personal data we hold about you.</li>
        <li>Request correction of inaccurate data.</li>
        <li>Request deletion of your data.</li>
        <li>Withdraw consent at any time.</li>
      </ul>
      <p>
        To exercise any of these rights, contact us at{" "}
        <a href="mailto:privacy@networth.online">privacy@networth.online</a>.
      </p>

      <h2>8. Changes to this policy</h2>
      <p>
        If we make material changes, we&apos;ll notify you by email or with a notice in the app
        before the changes take effect. Continued use after that date means you accept the
        updated policy.
      </p>

      <h2>9. Contact</h2>
      <p>
        Questions about this policy? Email us at{" "}
        <a href="mailto:privacy@networth.online">privacy@networth.online</a>.
      </p>
    </LegalLayout>
  );
}
