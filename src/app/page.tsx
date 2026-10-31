import type { Metadata } from "next";
import Link from "next/link";
import AuthRedirect from "@/components/AuthRedirect";
import Hero from "@/components/Hero";
import LandingHeader from "@/components/LandingHeader";
import { HeroDemo } from "@/components/landing/HeroDemo";

// ── SEO metadata ─────────────────────────────────────────────────────────────
export const metadata: Metadata = {
  title: "networth.online – Know Where Your Money Actually Goes",
  description:
    "Upload your bank statement PDF and instantly see your net worth, spending breakdown, savings rate, and AI-powered insights. No bank login. Any major bank. Under 60 seconds.",
  keywords: [
    "personal finance tracker",
    "bank statement analyzer",
    "net worth calculator",
    "spending tracker no bank login",
    "savings rate calculator",
    "AI financial insights",
    "PDF bank statement analysis",
    "personal finance app no bank login",
  ],
  openGraph: {
    title: "networth.online – Know Where Your Money Actually Goes",
    description:
      "Upload a bank statement PDF and get your net worth, spending breakdown, savings rate, and AI insights in under 60 seconds. No bank login required.",
    url: "https://networth.online",
    siteName: "networth.online",
    type: "website",
    locale: "en",
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
  inLanguage: "en",
  description:
    "Upload a PDF bank statement and instantly get your net worth, spending breakdown, savings rate, and AI-powered financial insights. No bank login required.",
  featureList:
    "Net worth tracking, AI financial insights, Spending analysis, Savings rate calculator, Subscription detection, PDF bank statement analysis, Income breakdown, Recurring payment detection",
  audience: {
    "@type": "Audience",
    audienceType: "People seeking personal finance insights without sharing bank credentials",
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
    q: "Which banks are supported?",
    a: "We support PDF statements from major banks in North America. This includes TD, RBC, Scotiabank, CIBC, BMO, Chase, Wells Fargo, Bank of America, Citi, Capital One, and most credit unions. If your bank produces a readable PDF statement, it will work.",
  },
  {
    q: "Is my data private and secure?",
    a: "Yes. We never ask for your bank login. Your PDF is deleted from our servers as soon as it has been read; we keep only the extracted figures, with account numbers masked, encrypted and private to your account. Your data is never sold or shared.",
  },
  {
    q: "How much does it cost?",
    a: "Uploading your first statement is completely free. You can explore your net worth, spending breakdown, and savings rate at no cost. Pro is $9.99/month and unlocks unlimited uploads, full history, AI insights, forecasting, goals, and the debt payoff planner. Cancel any time.",
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
  "Your PDF is deleted right after it's read",
  "Data never sold or shared",
];

// ── Testimonials ──────────────────────────────────────────────────────────────
const testimonials = [
  {
    quote: "I knew I was spending too much on food but seeing $847/month in one place made it real. Changed my habits in a week.",
    name: "Priya S.",
    role: "Marketing manager, Toronto",
    initials: "PS",
    color: "bg-purple-100 text-purple-700",
  },
  {
    quote: "Finally a finance app that doesn't want my banking password. I've been burned before. Uploading a PDF is the right way to do this.",
    name: "Marcus T.",
    role: "Software engineer, Seattle",
    initials: "MT",
    color: "bg-blue-100 text-blue-700",
  },
  {
    quote: "Found 3 streaming services I completely forgot about. Cancelled two within the hour. Already paid for itself.",
    name: "Jessica L.",
    role: "Freelance designer, Vancouver",
    initials: "JL",
    color: "bg-green-100 text-green-700",
  },
];

// ── Security badges ───────────────────────────────────────────────────────────
const securityBadges = [
  {
    icon: (
      <svg className="h-6 w-6 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
      </svg>
    ),
    title: "Encrypted in transit & at rest",
    body: "All data is transmitted over HTTPS and stored encrypted on Google Cloud (Firebase). Same infrastructure used by Fortune 500 companies.",
  },
  {
    icon: (
      <svg className="h-6 w-6 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
      </svg>
    ),
    title: "We don't keep your statement",
    body: "Your PDF is deleted as soon as it has been read. Only the extracted figures are kept, with account numbers masked, private to your account.",
  },
  {
    icon: (
      <svg className="h-6 w-6 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
      </svg>
    ),
    title: "No bank login. Ever.",
    body: "Your banking username and password never touch our systems. You download a PDF from your bank directly and upload it here. We have zero access to your bank account.",
  },
  {
    icon: (
      <svg className="h-6 w-6 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
      </svg>
    ),
    title: "Your data is never sold",
    body: "We don't sell, share, or monetise your financial data. Our business model is a simple subscription — your data is the product we protect, not the product we sell.",
  },
];

// ── Social proof stats ────────────────────────────────────────────────────────
const socialStats = [
  { value: "10,000+", label: "statements analyzed" },
  { value: "15+",     label: "banks & credit unions" },
  { value: "< 60 s",  label: "average analysis time" },
  { value: "Free",    label: "to upload your first statement" },
];

// ── Pricing plans ─────────────────────────────────────────────────────────────
const pricingFeatures = [
  { label: "Upload statements",            free: "Up to 5 / month",  pro: "Unlimited" },
  { label: "Statement history",            free: "Full (unlimited)",    pro: "Unlimited" },
  { label: "Net worth & spending summary", free: true,               pro: true },
  { label: "Subscription detection",       free: true,               pro: true },
  { label: "AI-powered insights",          free: false,              pro: true },
  { label: "Spending forecast",            free: false,              pro: true },
  { label: "Goals tracker",               free: false,              pro: true },
  { label: "Debt payoff planner",          free: false,              pro: true },
  { label: "Scenario planner",     free: false,              pro: true },
  { label: "Market & inflation signals",   free: false,              pro: true },
  { label: "Data export (CSV)",            free: false,              pro: true },
];

// ── "What you'll discover" insight examples ───────────────────────────────────
const insightExamples = [
  {
    badge: "High Priority",
    badgeColor: "bg-red-100 text-red-600",
    title: "$340/mo in subscriptions you may have forgotten",
    body: "We found 11 recurring charges across 3 accounts. 4 haven't been used in over 60 days based on your patterns.",
  },
  {
    badge: "Worth Reviewing",
    badgeColor: "bg-amber-100 text-amber-700",
    title: "April has 3 paydays — $3,600 more than usual",
    body: "Bi-weekly salary sometimes produces an extra payday. We flag these in advance so you can plan around the windfall.",
  },
  {
    badge: "Opportunity",
    badgeColor: "bg-purple-100 text-purple-700",
    title: "You're saving 36% of income without realising it",
    body: "After all expenses and debt payments your net savings rate is well above the average of under 5%.",
  },
];

// ── How it works steps ────────────────────────────────────────────────────────
const steps = [
  {
    n: "1",
    title: "Download a PDF from your bank",
    body: "Log into your bank's website, go to statements, and export last month as a PDF. Works with TD, RBC, CIBC, BMO, Chase, Wells Fargo, Bank of America, Citi, and most other major banks.",
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

// ── V2 Landing Page ───────────────────────────────────────────────────────────

function LandingV2() {
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

          {/* ── Hero (Clear Value Prop) ──────────────────────────────────────────── */}
          <section className="relative overflow-hidden bg-gradient-to-b from-purple-50 to-white py-16 md:py-24" aria-label="Hero">
            <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
              <div className="grid gap-12 lg:grid-cols-2 lg:gap-16 items-center">
                {/* Left: Headline & CTA */}
                <div>
                  <h1 className="font-extrabold text-4xl md:text-5xl text-gray-900 leading-tight">
                    Your bank statement knows<br />
                    everything. <span className="text-purple-600">Now you do too.</span>
                  </h1>
                  <p className="mt-6 text-lg text-gray-600 leading-relaxed">
                  Upload a PDF statement and instantly see: <span className="font-semibold text-gray-900">net worth</span>, spending in{" "}
                  <span className="font-semibold text-purple-600">Fixed</span> /{" "}
                  <span className="font-semibold text-blue-600">Essentials</span> /{" "}
                  <span className="font-semibold text-green-600">Flexible</span> groups,{" "}
                  <span className="font-semibold text-gray-900">forgotten subscriptions</span>, and{" "}
                    <span className="font-semibold text-gray-900">debt payoff plans</span>.
                  </p>
                  <ul className="mt-5 flex flex-wrap gap-3">
                    <li className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-semibold text-gray-900 shadow-sm ring-1 ring-gray-200">
                      <svg className="h-4 w-4 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                      No bank login required
                    </li>
                    <li className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-semibold text-gray-900 shadow-sm ring-1 ring-gray-200">
                      <svg className="h-4 w-4 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                      Your PDF is deleted right after it&apos;s read
                    </li>
                  </ul>
                  <div className="mt-8 flex flex-col sm:flex-row gap-4 items-start">
                    <Link
                      href="/upload"
                      className="inline-flex items-center justify-center gap-2 rounded-lg bg-purple-600 px-8 py-4 font-semibold text-white shadow-lg transition hover:bg-purple-700 hover:shadow-xl text-lg"
                    >
                      Try it free — Upload a statement
                      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                      </svg>
                    </Link>
                  </div>
                  <p className="mt-4 text-sm text-gray-500">
                    PDF · Any major bank · Results in under 60 seconds
                  </p>
                </div>

                {/* Right: Animated Demo */}
                <div>
                  <HeroDemo />
                </div>
              </div>
            </div>
          </section>

          {/* ── How It Works ────────────────────────────────────────────────────── */}
          <section className="py-16 md:py-24 bg-white" aria-labelledby="how-heading">
            <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
              <div className="text-center max-w-2xl mx-auto mb-12">
                <h2 id="how-heading" className="text-3xl font-bold text-gray-900 md:text-4xl">
                  Three steps. Under a minute.
                </h2>
                <p className="mt-3 text-lg text-gray-600">
                  No account linking. No waiting. Just a PDF and your complete financial picture.
                </p>
              </div>
              <ol className="grid gap-8 md:grid-cols-3 list-none">
                {steps.map((step) => (
                  <li key={step.n} className="bg-gray-50 rounded-xl border border-gray-200 p-8">
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-purple-600 font-bold text-white text-xl" aria-hidden="true">
                      {step.n}
                    </div>
                    <h3 className="mt-4 text-lg font-semibold text-gray-900">{step.title}</h3>
                    <p className="mt-2 text-sm text-gray-600 leading-relaxed">{step.body}</p>
                  </li>
                ))}
              </ol>
            </div>
          </section>

          {/* ── Key Features ─────────────────────────────────────────────────────── */}
          <section className="py-16 md:py-24 bg-gray-50" aria-labelledby="features-heading">
            <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
              <div className="text-center max-w-2xl mx-auto mb-12">
                <h2 id="features-heading" className="text-3xl font-bold text-gray-900 md:text-4xl">
                  Everything you need to understand your money
                </h2>
              </div>
              <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3">
                {/* Net Worth Tracking */}
                <div className="bg-white rounded-xl border border-gray-200 p-8 flex flex-col">
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-purple-100 mb-4">
                    <svg className="h-6 w-6 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                    </svg>
                  </div>
                  <h3 className="text-lg font-semibold text-gray-900">Net Worth Tracking</h3>
                  <p className="mt-2 text-sm text-gray-600 leading-relaxed flex-1">
                    See all your accounts in one place. Track assets, liabilities, and monthly changes automatically.
                  </p>
                </div>

                {/* Smart Spending Groups */}
                <div className="bg-white rounded-xl border border-gray-200 p-8 flex flex-col">
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-100 mb-4">
                    <svg className="h-6 w-6 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <h3 className="text-lg font-semibold text-gray-900">Smart Spending Groups</h3>
                  <p className="mt-2 text-sm text-gray-600 leading-relaxed flex-1">
                    Spending organized into Fixed (loans, insurance), Essentials (groceries, utilities), and Flexible (dining, shopping) groups.
                  </p>
                </div>

                {/* Subscription Detection */}
                <div className="bg-white rounded-xl border border-gray-200 p-8 flex flex-col">
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-green-100 mb-4">
                    <svg className="h-6 w-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                  </div>
                  <h3 className="text-lg font-semibold text-gray-900">Subscription Detection</h3>
                  <p className="mt-2 text-sm text-gray-600 leading-relaxed flex-1">
                    Automatically find recurring charges across all accounts. Get alerts when subscriptions stop charging or renewals are coming.
                  </p>
                </div>

                {/* Debt Payoff Planner */}
                <div className="bg-white rounded-xl border border-gray-200 p-8 flex flex-col relative">
                  <span className="absolute top-4 right-4 bg-purple-100 text-purple-700 text-xs font-bold px-2 py-1 rounded">PRO</span>
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-red-100 mb-4">
                    <svg className="h-6 w-6 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                    </svg>
                  </div>
                  <h3 className="text-lg font-semibold text-gray-900">Debt Payoff Planner</h3>
                  <p className="mt-2 text-sm text-gray-600 leading-relaxed flex-1">
                    Calculate payoff strategies for credit cards and loans. See how extra payments save interest and time.
                  </p>
                </div>

                {/* Ask AI */}
                <div className="bg-white rounded-xl border border-gray-200 p-8 flex flex-col">
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-purple-100 mb-4">
                    <svg className="h-6 w-6 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                    </svg>
                  </div>
                  <h3 className="text-lg font-semibold text-gray-900">Ask AI</h3>
                  <p className="mt-2 text-sm text-gray-600 leading-relaxed flex-1">
                    Chat about your finances. Ask questions like "Where can I cut spending?" or "Am I saving enough?" 50 free answers per month.
                  </p>
                </div>

                {/* Spending Forecast */}
                <div className="bg-white rounded-xl border border-gray-200 p-8 flex flex-col relative">
                  <span className="absolute top-4 right-4 bg-purple-100 text-purple-700 text-xs font-bold px-2 py-1 rounded">PRO</span>
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-amber-100 mb-4">
                    <svg className="h-6 w-6 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                    </svg>
                  </div>
                  <h3 className="text-lg font-semibold text-gray-900">Spending Forecast</h3>
                  <p className="mt-2 text-sm text-gray-600 leading-relaxed flex-1">
                    See upcoming bills and income. Plan around paydays with extra paychecks or seasonal expenses.
                  </p>
                </div>
              </div>
            </div>
          </section>

          {/* ── Security (ONE Section) ────────────────────────────────────────────── */}
          <section className="py-16 md:py-24 bg-white" aria-labelledby="security-heading">
            <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8 text-center">
              <div className="inline-flex items-center gap-2 rounded-full border border-green-200 bg-green-50 px-4 py-2 text-sm font-semibold text-green-700 mb-6">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
                Your data stays yours
              </div>
              <h2 id="security-heading" className="text-3xl font-bold text-gray-900 md:text-4xl mb-4">
                Safer than connecting your bank
              </h2>
              <p className="text-lg text-gray-600 max-w-2xl mx-auto mb-12">
                Upload a PDF directly from your bank. We never see your login credentials or have access to your account.
              </p>
              <div className="grid gap-6 md:grid-cols-2 text-left">
                <div className="flex gap-4">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-purple-100">
                    <svg className="h-5 w-5 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-900">No bank login required</h3>
                    <p className="mt-1 text-sm text-gray-600">
                      Your banking credentials never touch our systems. Upload a PDF, not your password.
                    </p>
                  </div>
                </div>
                <div className="flex gap-4">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-purple-100">
                    <svg className="h-5 w-5 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-900">Statements aren&apos;t stored</h3>
                    <p className="mt-1 text-sm text-gray-600">
                      Your PDF is deleted right after it&apos;s read. We keep only the numbers, with account numbers masked, encrypted and private to you.
                    </p>
                  </div>
                </div>
                <div className="flex gap-4">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-purple-100">
                    <svg className="h-5 w-5 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-900">Never sold or shared</h3>
                    <p className="mt-1 text-sm text-gray-600">
                      We don't sell your data. Our business model is simple: you pay for the service, not with your data.
                    </p>
                  </div>
                </div>
                <div className="flex gap-4">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-purple-100">
                    <svg className="h-5 w-5 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-900">Works with any bank</h3>
                    <p className="mt-1 text-sm text-gray-600">
                      TD, RBC, Chase, Wells Fargo, Bank of America, and most major banks. If it's a PDF, it works.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* ── Pricing ──────────────────────────────────────────────────────────── */}
          <section className="py-16 md:py-24 bg-gray-50" aria-labelledby="pricing-heading">
            <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
              <div className="text-center max-w-2xl mx-auto mb-12">
                <h2 id="pricing-heading" className="text-3xl font-bold text-gray-900 md:text-4xl">
                  Simple, transparent pricing
                </h2>
                <p className="mt-3 text-lg text-gray-600">
                  Start free. Upgrade when you need more.
                </p>
              </div>

              <div className="grid gap-8 lg:grid-cols-2">
                {/* Free plan */}
                <div className="rounded-2xl border-2 border-gray-200 bg-white p-8 flex flex-col">
                  <div>
                    <p className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Free</p>
                    <p className="mt-4 text-5xl font-extrabold text-gray-900">$0</p>
                    <p className="mt-2 text-base text-gray-500">Forever free</p>
                  </div>
                  <ul className="mt-8 space-y-4 flex-1">
                    <li className="flex items-start gap-3">
                      <svg className="h-5 w-5 shrink-0 text-green-500 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                      <span className="text-gray-700">8 uploads per month</span>
                    </li>
                    <li className="flex items-start gap-3">
                      <svg className="h-5 w-5 shrink-0 text-green-500 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                      <span className="text-gray-700">Full history (unlimited)</span>
                    </li>
                    <li className="flex items-start gap-3">
                      <svg className="h-5 w-5 shrink-0 text-green-500 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                      <span className="text-gray-700">Net worth & spending breakdown</span>
                    </li>
                    <li className="flex items-start gap-3">
                      <svg className="h-5 w-5 shrink-0 text-green-500 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                      <span className="text-gray-700">Subscription detection</span>
                    </li>
                    <li className="flex items-start gap-3">
                      <svg className="h-5 w-5 shrink-0 text-green-500 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                      <span className="text-gray-700">Ask AI (50 answers/month)</span>
                    </li>
                    <li className="flex items-start gap-3">
                      <svg className="h-5 w-5 shrink-0 text-gray-300 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                      <span className="text-gray-400">Debt payoff planner</span>
                    </li>
                    <li className="flex items-start gap-3">
                      <svg className="h-5 w-5 shrink-0 text-gray-300 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                      <span className="text-gray-400">AI insights & forecast</span>
                    </li>
                  </ul>
                  <div className="mt-8">
                    <Link
                      href="/upload"
                      className="block w-full rounded-lg border-2 border-gray-300 bg-white px-6 py-3 text-center font-semibold text-gray-700 hover:bg-gray-50 transition"
                    >
                      Start free
                    </Link>
                  </div>
                </div>

                {/* Pro plan */}
                <div className="rounded-2xl border-2 border-purple-600 bg-white p-8 flex flex-col relative shadow-lg">
                  <div className="absolute -top-4 left-1/2 -translate-x-1/2">
                    <span className="rounded-full bg-purple-600 px-4 py-1 text-xs font-bold text-white tracking-wide shadow-md">
                      Most popular
                    </span>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-purple-600 uppercase tracking-wide">Pro</p>
                    <p className="mt-4 text-5xl font-extrabold text-gray-900">$9.99</p>
                    <p className="mt-2 text-base text-gray-500">per month</p>
                  </div>
                  <ul className="mt-8 space-y-4 flex-1">
                    <li className="flex items-start gap-3">
                      <svg className="h-5 w-5 shrink-0 text-purple-600 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                      <span className="text-gray-700 font-medium">Unlimited uploads</span>
                    </li>
                    <li className="flex items-start gap-3">
                      <svg className="h-5 w-5 shrink-0 text-purple-600 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                      <span className="text-gray-700">Everything in Free, plus:</span>
                    </li>
                    <li className="flex items-start gap-3">
                      <svg className="h-5 w-5 shrink-0 text-purple-600 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                      <span className="text-gray-700">Debt payoff planner</span>
                    </li>
                    <li className="flex items-start gap-3">
                      <svg className="h-5 w-5 shrink-0 text-purple-600 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                      <span className="text-gray-700">AI-powered insights & forecast</span>
                    </li>
                    <li className="flex items-start gap-3">
                      <svg className="h-5 w-5 shrink-0 text-purple-600 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                      <span className="text-gray-700">What-if scenarios</span>
                    </li>
                    <li className="flex items-start gap-3">
                      <svg className="h-5 w-5 shrink-0 text-purple-600 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                      <span className="text-gray-700">Data export (CSV)</span>
                    </li>
                    <li className="flex items-start gap-3">
                      <svg className="h-5 w-5 shrink-0 text-purple-600 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                      <span className="text-gray-700">Unlimited AI chat</span>
                    </li>
                  </ul>
                  <div className="mt-8">
                    <Link
                      href="/signup"
                      className="block w-full rounded-lg bg-purple-600 px-6 py-3 text-center font-semibold text-white hover:bg-purple-700 transition shadow-md"
                    >
                      Start with Pro
                    </Link>
                    <p className="mt-3 text-center text-sm text-gray-500">
                      Cancel anytime
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* ── FAQ ──────────────────────────────────────────────────────────────── */}
          <section className="py-16 md:py-24 bg-white" aria-labelledby="faq-heading">
            <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8">
              <h2 id="faq-heading" className="text-3xl font-bold text-gray-900 md:text-4xl text-center mb-12">
                Frequently asked questions
              </h2>
              <dl className="space-y-6">
                {faqs.slice(0, 5).map(({ q, a }) => (
                  <div key={q} className="bg-gray-50 rounded-xl border border-gray-200 p-6">
                    <dt className="font-semibold text-gray-900">{q}</dt>
                    <dd className="mt-3 text-sm text-gray-600 leading-relaxed">{a}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </section>

          {/* ── Final CTA ────────────────────────────────────────────────────────── */}
          <section className="py-16 md:py-24 bg-gradient-to-b from-purple-50 to-white" aria-labelledby="final-cta-heading">
            <div className="mx-auto max-w-3xl px-4 text-center sm:px-6 lg:px-8">
              <h2 id="final-cta-heading" className="text-3xl font-bold text-gray-900 md:text-4xl">
                Ready to understand your money?
              </h2>
              <p className="mt-4 text-lg text-gray-600">
                Upload your first statement for free. No bank login. No credit card. See results in under 60 seconds.
              </p>
              <div className="mt-8">
                <Link
                  href="/upload"
                  className="inline-flex items-center gap-2 rounded-lg bg-purple-600 px-8 py-4 font-semibold text-white shadow-lg transition hover:bg-purple-700 hover:shadow-xl text-lg"
                >
                  Try it free now
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                </Link>
              </div>
            </div>
          </section>

        </main>

        {/* ── Footer ──────────────────────────────────────────────────────────── */}
        <footer className="border-t border-gray-100 bg-white">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-6 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-gray-400">
            <span>
              <span className="font-semibold text-purple-600">networth.online</span>
              {" "}— Upload bank statements. See everything.
            </span>
            <div className="flex gap-5">
              <Link href="/login" className="hover:text-gray-600 transition">Log in</Link>
              <Link href="/upload" className="hover:text-gray-600 transition">Upload</Link>
              <Link href="/privacy" className="hover:text-gray-600 transition">Privacy</Link>
              <Link href="/terms" className="hover:text-gray-600 transition">Terms</Link>
            </div>
          </div>
        </footer>
      </div>
    </>
  );
}

// ── V1 Landing Page (Original) ───────────────────────────────────────────────

export default async function Home({ searchParams }: { searchParams?: Promise<{ v?: string }> }) {
  const params = (await searchParams) ?? {};
  // Check for v=2 query parameter
  if (params.v === "2") {
    return <LandingV2 />;
  }

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

          {/* ── Social proof stats ────────────────────────────────────────── */}
          <div className="bg-white py-10 border-b border-gray-100">
            <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
              <dl className="grid grid-cols-2 gap-6 sm:grid-cols-4">
                {socialStats.map((s) => (
                  <div key={s.label} className="text-center">
                    <dt className="text-2xl font-extrabold text-purple-600 tracking-tight">{s.value}</dt>
                    <dd className="mt-1 text-xs text-gray-500">{s.label}</dd>
                  </div>
                ))}
              </dl>
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

          {/* ── Testimonials ─────────────────────────────────────────────── */}
          <section className="py-16 md:py-24 bg-gray-50" aria-labelledby="testimonials-heading">
            <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
              <div className="text-center max-w-xl mx-auto">
                <h2 id="testimonials-heading" className="text-2xl font-bold text-gray-900 md:text-3xl">
                  What people discovered
                </h2>
                <p className="mt-3 text-sm text-gray-500">
                  Real reactions from people who uploaded their first statement.
                </p>
              </div>
              <div className="mt-10 grid gap-6 md:grid-cols-3">
                {testimonials.map((t) => (
                  <figure
                    key={t.name}
                    className="rounded-xl border border-gray-100 bg-white p-6 shadow-sm flex flex-col gap-4"
                  >
                    <blockquote className="flex-1">
                      <p className="text-sm text-gray-700 leading-relaxed">&ldquo;{t.quote}&rdquo;</p>
                    </blockquote>
                    <figcaption className="flex items-center gap-3">
                      <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold ${t.color}`}>
                        {t.initials}
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-gray-900">{t.name}</p>
                        <p className="text-xs text-gray-400">{t.role}</p>
                      </div>
                    </figcaption>
                  </figure>
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

          {/* ── How we protect your data ─────────────────────────────────── */}
          <section className="py-16 md:py-24 bg-white" aria-labelledby="security-heading">
            <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
              <div className="text-center max-w-xl mx-auto">
                <div className="inline-flex items-center gap-2 rounded-full border border-green-200 bg-green-50 px-3 py-1 text-xs font-semibold text-green-700 mb-4">
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                  </svg>
                  Bank-level privacy by design
                </div>
                <h2 id="security-heading" className="text-2xl font-bold text-gray-900 md:text-3xl">
                  Uploading a statement is safer than you think
                </h2>
                <p className="mt-3 text-sm text-gray-500">
                  We built this app specifically so you&apos;d never have to hand over your banking credentials.
                  Here&apos;s exactly how your data is handled.
                </p>
              </div>
              <div className="mt-10 grid gap-6 md:grid-cols-2">
                {securityBadges.map((badge) => (
                  <div
                    key={badge.title}
                    className="flex gap-4 rounded-xl border border-gray-100 bg-gray-50 p-6"
                  >
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-purple-50">
                      {badge.icon}
                    </div>
                    <div>
                      <h3 className="font-semibold text-gray-900 text-sm">{badge.title}</h3>
                      <p className="mt-1.5 text-sm text-gray-500 leading-relaxed">{badge.body}</p>
                    </div>
                  </div>
                ))}
              </div>
              {/* Visual trust badges */}
              <div className="mt-8 flex flex-wrap justify-center gap-3">
                {[
                  { label: "Hosted on Google Cloud", icon: "☁️" },
                  { label: "Firebase / Firestore",    icon: "🔥" },
                  { label: "SSL / TLS Encrypted",     icon: "🔒" },
                  { label: "No bank credentials",     icon: "🚫" },
                  { label: "No ads. No data selling", icon: "🛡️" },
                ].map((b) => (
                  <span
                    key={b.label}
                    className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-4 py-1.5 text-xs font-medium text-gray-600 shadow-sm"
                  >
                    <span aria-hidden="true">{b.icon}</span>
                    {b.label}
                  </span>
                ))}
              </div>

              <div className="mt-6 rounded-xl border border-purple-100 bg-purple-50 px-6 py-5 text-center">
                <p className="text-sm text-purple-900">
                  <span className="font-semibold">Compare this to bank aggregators:</span>{" "}
                  Apps like Mint or Credit Karma require your banking username and password. 
                  We don&apos;t — and we never will. A PDF is all we need.
                </p>
              </div>
            </div>
          </section>

          {/* ── Pricing ──────────────────────────────────────────────────── */}
          <section className="py-16 md:py-24 bg-gray-50" aria-labelledby="pricing-heading">
            <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
              <div className="text-center max-w-xl mx-auto">
                <h2 id="pricing-heading" className="text-2xl font-bold text-gray-900 md:text-3xl">
                  Simple, honest pricing
                </h2>
                <p className="mt-3 text-sm text-gray-500">
                  Start free. Upgrade when you want trend analysis and AI-powered planning.
                </p>
              </div>

              <div className="mt-10 grid gap-6 md:grid-cols-2">
                {/* Free plan */}
                <div className="rounded-2xl border border-gray-200 bg-white p-8 flex flex-col">
                  <div>
                    <p className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Free</p>
                    <p className="mt-2 text-4xl font-extrabold text-gray-900">$0</p>
                    <p className="mt-1 text-sm text-gray-400">forever</p>
                    <p className="mt-4 text-sm text-gray-600">
                      Upload your first statement and instantly see your net worth, spending breakdown, and subscription detection.
                    </p>
                  </div>
                  <ul className="mt-6 space-y-3 flex-1">
                    {pricingFeatures.map((f) => (
                      <li key={f.label} className="flex items-center gap-2.5 text-sm">
                        {f.free === false ? (
                          <svg className="h-4 w-4 shrink-0 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        ) : (
                          <svg className="h-4 w-4 shrink-0 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                        <span className={f.free === false ? "text-gray-400" : "text-gray-700"}>
                          {f.free === true ? f.label : f.free === false ? f.label : `${f.label} — ${f.free}`}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <div className="mt-8">
                    <Link
                      href="/upload"
                      className="block w-full rounded-lg border border-gray-300 bg-white px-4 py-3 text-center text-sm font-semibold text-gray-700 hover:bg-gray-50 transition"
                    >
                      Upload your first statement →
                    </Link>
                  </div>
                </div>

                {/* Pro plan */}
                <div className="rounded-2xl border-2 border-purple-500 bg-white p-8 flex flex-col relative">
                  <div className="absolute -top-3.5 left-1/2 -translate-x-1/2">
                    <span className="rounded-full bg-purple-600 px-4 py-1 text-xs font-bold text-white tracking-wide shadow">
                      Most popular
                    </span>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-purple-600 uppercase tracking-wide">Pro</p>
                    <p className="mt-2 text-4xl font-extrabold text-gray-900">$9.99</p>
                    <p className="mt-1 text-sm text-gray-400">per month, cancel any time</p>
                    <p className="mt-4 text-sm text-gray-600">
                      Unlimited uploads, full history, AI insights, and every planning tool — for users who want the complete picture.
                    </p>
                  </div>
                  <ul className="mt-6 space-y-3 flex-1">
                    {pricingFeatures.map((f) => (
                      <li key={f.label} className="flex items-center gap-2.5 text-sm">
                        <svg className="h-4 w-4 shrink-0 text-purple-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                        <span className="text-gray-700">
                          {f.pro === true ? f.label : `${f.label} — ${f.pro}`}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <div className="mt-8">
                    <Link
                      href="/signup"
                      className="block w-full rounded-lg bg-purple-600 px-4 py-3 text-center text-sm font-semibold text-white hover:bg-purple-700 transition shadow-md"
                    >
                      Get started with Pro →
                    </Link>
                    <p className="mt-2 text-center text-xs text-gray-400">No credit card required to try for free first</p>
                  </div>
                </div>
              </div>
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
                  PDF &nbsp;·&nbsp; Any major bank &nbsp;·&nbsp; Results in under 60 seconds
                </p>
              </div>
            </div>
          </section>

        </main>

        {/* ── Footer ──────────────────────────────────────────────────────── */}
        <footer className="border-t border-gray-100 bg-white">
          {/* AI accuracy note */}
          <div className="border-b border-gray-100 bg-gray-50 py-3">
            <p className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 text-center text-xs text-gray-400">
              AI-powered insights are a helpful guide, not guaranteed to be 100% accurate.
              Always verify important figures with your bank.{" "}
              <Link href="/terms#ai-accuracy" className="underline hover:text-gray-600 transition">
                Learn more
              </Link>
            </p>
          </div>
          {/* Footer links */}
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-6 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-gray-400">
            <span>
              <span className="font-semibold text-purple-600">networth.online</span>
              &nbsp;— No bank login. No credentials. No ads.
            </span>
            <div className="flex gap-5">
              <Link href="/login" className="hover:text-gray-600 transition">Log in</Link>
              <Link href="/upload" className="hover:text-gray-600 transition">Upload statement</Link>
              <Link href="/privacy" className="hover:text-gray-600 transition">Privacy</Link>
              <Link href="/terms" className="hover:text-gray-600 transition">Terms</Link>
            </div>
          </div>
        </footer>
      </div>
    </>
  );
}
