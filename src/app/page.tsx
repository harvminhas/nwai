import type { Metadata } from "next";
import Link from "next/link";
import AuthRedirect from "@/components/AuthRedirect";
import Hero from "@/components/Hero";
import LandingHeader from "@/components/LandingHeader";

// ── SEO metadata ─────────────────────────────────────────────────────────────
export const metadata: Metadata = {
  title: "networth.online – Know Where Your Money Actually Goes",
  description:
    "Upload your bank statement PDF and instantly see your net worth, spending breakdown, savings rate, and AI-powered insights. No bank login. Any Canadian bank. Under 60 seconds.",
  keywords: [
    "personal finance tracker",
    "bank statement analyzer",
    "net worth calculator Canada",
    "spending tracker no bank login",
    "savings rate calculator",
    "AI financial insights",
    "PDF bank statement analysis",
    "Canadian personal finance",
  ],
  openGraph: {
    title: "networth.online – Know Where Your Money Actually Goes",
    description:
      "Upload a bank statement PDF and get your net worth, spending breakdown, savings rate, and AI insights in under 60 seconds. No bank login required.",
    url: "https://networth.online",
    siteName: "networth.online",
    type: "website",
    locale: "en_CA",
    images: [
      {
        url: "https://networth.online/opengraph-image",
        width: 1200,
        height: 630,
        alt: "networth.online – Know Where Your Money Actually Goes",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "networth.online – Know Where Your Money Actually Goes",
    description:
      "Upload a bank statement PDF and get AI-powered financial insights in under 60 seconds. No bank login required.",
    images: ["https://networth.online/opengraph-image"],
  },
  alternates: {
    canonical: "https://networth.online",
  },
};

// ── JSON-LD structured data ───────────────────────────────────────────────────
const appJsonLd = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "networth.online",
  url: "https://networth.online",
  applicationCategory: "FinanceApplication",
  operatingSystem: "Web",
  inLanguage: "en-CA",
  description:
    "Upload a PDF bank statement and instantly get your net worth, spending breakdown, savings rate, and AI-powered financial insights. No bank login required.",
  featureList:
    "Net worth tracking, AI financial insights, Spending analysis, Savings rate calculator, Subscription detection, PDF bank statement analysis, Income breakdown, Recurring payment detection",
  audience: {
    "@type": "Audience",
    geographicArea: "Canada",
    audienceType: "Canadians seeking personal finance insights without sharing bank credentials",
  },
  offers: {
    "@type": "Offer",
    price: "0",
    priceCurrency: "CAD",
    description: "Free to start — upload your first statement at no cost",
  },
};

// ── FAQ data (also used for FAQPage JSON-LD rich results) ────────────────────
const faqs = [
  {
    q: "Do I need to connect my bank account?",
    a: "No. You never connect your bank account or share your login credentials. You simply download a PDF statement from your bank's website and upload it here. Your banking login is never involved.",
  },
  {
    q: "Which Canadian banks are supported?",
    a: "We support PDF statements from all major Canadian banks including TD, RBC, Scotiabank, CIBC, BMO, Tangerine, and most credit unions. If your bank produces a readable PDF statement, it will work.",
  },
  {
    q: "Is my data private and secure?",
    a: "Yes. Your raw PDF file is discarded immediately after parsing — we only retain the extracted transaction data associated with your account. Your data is never sold or shared with third parties.",
  },
  {
    q: "How much does it cost?",
    a: "Uploading your first statement is completely free. You can explore your net worth, spending breakdown, savings rate, and AI insights at no cost. A Pro plan is available for users who want to upload multiple months and unlock trend analysis.",
  },
  {
    q: "How long does the analysis take?",
    a: "Under 60 seconds. Our AI reads and categorises every transaction in your statement, computes your net worth and savings rate, and generates personalised insights — all within about a minute of uploading.",
  },
  {
    q: "Can I upload statements for multiple accounts?",
    a: "Yes. You can upload statements from multiple accounts (chequing, savings, credit card, mortgage) and we consolidate them into a single financial picture including combined net worth and cross-account spending patterns.",
  },
];

const faqJsonLd = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: faqs.map(({ q, a }) => ({
    "@type": "Question",
    name: q,
    acceptedAnswer: { "@type": "Answer", text: a },
  })),
};
const trustItems = [
  "No bank login or credentials",
  "Raw files discarded after parsing",
  "Data never sold or shared",
];

// ── "What you'll discover" insight examples ───────────────────────────────────
const insightExamples = [
  {
    badge: "High Priority",
    badgeColor: "bg-red-100 text-red-600",
    title: "CA$340/mo in subscriptions you may have forgotten",
    body: "We found 11 recurring charges across 3 accounts. 4 haven't been used in over 60 days based on your patterns.",
  },
  {
    badge: "Worth Reviewing",
    badgeColor: "bg-amber-100 text-amber-700",
    title: "April has 3 paydays — CA$3,600 more than usual",
    body: "Bi-weekly salary sometimes produces an extra payday. We flag these in advance so you can plan around the windfall.",
  },
  {
    badge: "Opportunity",
    badgeColor: "bg-purple-100 text-purple-700",
    title: "You're saving 36% of income without realising it",
    body: "After all expenses and debt payments your net savings rate is well above the Canadian average of under 5%.",
  },
];

// ── How it works steps ────────────────────────────────────────────────────────
const steps = [
  {
    n: "1",
    title: "Download a PDF from your bank",
    body: "Log into your bank's website, go to statements, and export last month as a PDF. Works with CIBC, TD, RBC, Scotiabank, BMO, and most credit unions.",
  },
  {
    n: "2",
    title: "Drop it here — we do the rest",
    body: "We parse every transaction, categorise your spending automatically, and detect recurring patterns. No manual tagging. No setup.",
  },
  {
    n: "3",
    title: "Get your financial picture in seconds",
    body: "Net worth, savings rate, spending breakdown, upcoming bills, and AI insights — all from one statement. Upload more months to unlock trends.",
  },
];

export default function Home() {
  return (
    <>
      {/* JSON-LD — invisible to users, visible to search engines */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(appJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />

      {/* Invisible client component: redirects logged-in users to dashboard */}
      <AuthRedirect />

      <div className="min-h-screen bg-white">
        <LandingHeader />
        <main>

          {/* ── Hero ──────────────────────────────────────────────────────── */}
          <Hero />

          {/* ── Trust bar ─────────────────────────────────────────────────── */}
          <div className="border-y border-gray-100 bg-gray-50 py-4">
            <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
              <ul className="flex flex-col sm:flex-row items-center justify-center gap-4 sm:gap-10">
                {trustItems.map((item) => (
                  <li key={item} className="flex items-center gap-2 text-sm text-gray-500">
                    <svg className="h-4 w-4 shrink-0 text-green-500" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* ── What you'll discover ──────────────────────────────────────── */}
          <section className="py-16 md:py-24 bg-white" aria-labelledby="discover-heading">
            <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
              <div className="text-center max-w-2xl mx-auto">
                <h2 id="discover-heading" className="text-2xl font-bold text-gray-900 md:text-3xl">
                  Your statement already has the answers
                </h2>
                <p className="mt-3 text-base text-gray-500">
                  Most people are surprised by what one month of transactions reveals.
                  Here&apos;s the kind of thing we find.
                </p>
              </div>
              <div className="mt-10 grid gap-6 md:grid-cols-3">
                {insightExamples.map((ex) => (
                  <article
                    key={ex.badge}
                    className="rounded-xl border border-gray-100 bg-gray-50 p-5 flex flex-col gap-3"
                  >
                    <div className="flex items-center gap-2">
                      <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded ${ex.badgeColor}`}>
                        {ex.badge}
                      </span>
                      <span className="text-[10px] text-gray-400">example</span>
                    </div>
                    <h3 className="text-sm font-semibold text-gray-900 leading-snug">{ex.title}</h3>
                    <p className="text-sm text-gray-500 leading-relaxed">{ex.body}</p>
                  </article>
                ))}
              </div>
            </div>
          </section>

          {/* ── How it works ──────────────────────────────────────────────── */}
          <section className="py-16 md:py-24 bg-gray-50" aria-labelledby="how-heading">
            <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
              <div className="text-center max-w-xl mx-auto">
                <h2 id="how-heading" className="text-2xl font-bold text-gray-900 md:text-3xl">
                  Three steps. Under a minute.
                </h2>
                <p className="mt-3 text-sm text-gray-500">
                  No account linking. No waiting. Just a PDF from your bank and your complete financial picture.
                </p>
              </div>
              <ol className="mt-12 grid gap-8 md:grid-cols-3 list-none">
                {steps.map((step) => (
                  <li key={step.n} className="bg-white rounded-xl border border-gray-100 p-6 shadow-sm">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-purple-100 font-bold text-purple-600 text-lg" aria-hidden="true">
                      {step.n}
                    </div>
                    <h3 className="mt-4 font-semibold text-gray-900">{step.title}</h3>
                    <p className="mt-2 text-sm text-gray-500 leading-relaxed">{step.body}</p>
                  </li>
                ))}
              </ol>
            </div>
          </section>

          {/* ── FAQ ──────────────────────────────────────────────────────── */}
          <section className="py-16 md:py-24 bg-gray-50" aria-labelledby="faq-heading">
            <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8">
              <h2 id="faq-heading" className="text-2xl font-bold text-gray-900 md:text-3xl text-center mb-10">
                Frequently asked questions
              </h2>
              <dl className="space-y-6">
                {faqs.map(({ q, a }) => (
                  <div key={q} className="bg-white rounded-xl border border-gray-100 p-6 shadow-sm">
                    <dt className="font-semibold text-gray-900 text-sm md:text-base">{q}</dt>
                    <dd className="mt-2 text-sm text-gray-500 leading-relaxed">{a}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </section>

          {/* ── Bottom CTA ────────────────────────────────────────────────── */}
          <section className="py-16 md:py-24 bg-white" aria-labelledby="cta-heading">
            <div className="mx-auto max-w-2xl px-4 text-center sm:px-6 lg:px-8">
              <h2 id="cta-heading" className="text-2xl font-bold text-gray-900 md:text-3xl">
                Ready to see what your statement reveals?
              </h2>
              <p className="mt-3 text-sm text-gray-500">
                Free to start. No bank login. No credit card.<br />
                Just upload a PDF and see your finances clearly.
              </p>
              <div className="mt-8">
                <Link
                  href="/upload"
                  className="inline-flex items-center gap-2 rounded-lg bg-purple-600 px-8 py-4 font-semibold text-white shadow-md transition hover:bg-purple-700 hover:shadow-lg text-base"
                >
                  Upload your first statement →
                </Link>
                <p className="mt-3 text-xs text-gray-400">
                  PDF &nbsp;·&nbsp; Any Canadian bank &nbsp;·&nbsp; Results in under 60 seconds
                </p>
              </div>
            </div>
          </section>

        </main>

        {/* ── Footer ──────────────────────────────────────────────────────── */}
        <footer className="border-t border-gray-100 py-6 bg-white">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-gray-400">
            <span>
              <span className="font-semibold text-purple-600">networth.online</span>
              &nbsp;— No bank login. No credentials. No ads.
            </span>
            <div className="flex gap-5">
              <Link href="/login" className="hover:text-gray-600 transition">Log in</Link>
              <Link href="/upload" className="hover:text-gray-600 transition">Upload statement</Link>
            </div>
          </div>
        </footer>
      </div>
    </>
  );
}
