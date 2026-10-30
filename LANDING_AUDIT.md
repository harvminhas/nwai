# Landing Page Audit & Redesign Plan

## Current Landing Page Audit (`src/app/page.tsx`)

### Sections in Order (620 lines total)

1. **Hero** (lines 269-270, Hero component 1-107)
   - Headline: "Finally know where your money actually goes."
   - Subhead: Generic description about uploading PDFs
   - CTA: "Upload a statement — it's free"
   - Mock preview card on right side (small, not prominent)
   - **Issue**: Doesn't explain WHAT the app does in 5 seconds. Generic headline.

2. **Trust Bar** (lines 272-284)
   - 3 items: "No bank login", "Statement encrypted", "Data never sold"
   - **Issue**: First of 4 security-related sections

3. **Social Proof Stats** (lines 287-299)
   - "10,000+ statements analyzed"
   - "15+ banks & credit unions"
   - "< 60 s average analysis time"
   - "Free to upload your first statement"
   - **FAKE DATA**: These are invented numbers, not real metrics

4. **"What you'll discover"** (lines 302-331)
   - 3 insight examples with badges
   - Shows example insights the app generates
   - **Good section** - demonstrates value

5. **Testimonials** (lines 334-365)
   - 3 testimonials: Priya S., Marcus T., Jessica L.
   - **FAKE DATA**: Generic invented quotes, not real users

6. **"How it works"** (lines 369-391)
   - 3 steps: Download PDF, Drop it here, Get your picture
   - **Good section** - clear process

7. **Security Section** (lines 394-453)
   - Header: "Uploading a statement is safer than you think"
   - 4 security badges (encrypted, private, no login, not sold)
   - 5 visual trust badges (Google Cloud, Firebase, SSL, etc.)
   - Comparison box: "Compare this to bank aggregators"
   - **MASSIVE DUPLICATION**: This is the 2nd, 3rd, and 4th security messaging

8. **Pricing** (lines 456-545)
   - Shows Free ($0) and Pro ($9.99/month) plans
   - Feature comparison list
   - **Pricing is REAL** (matches plans.ts)
   - **Issue**: Buried at line 456, should be higher

9. **FAQ** (lines 549-563)
   - 6 questions covering basics
   - **Good section** - addresses common concerns

10. **Bottom CTA** (lines 566-586)
    - Repeat of "Upload your first statement"
    - **Redundant** with hero CTA

11. **Footer** (lines 590-620)
    - AI accuracy disclaimer
    - Links to login, upload, privacy, terms

---

## Critical Issues

### 1. Weak Hero (Doesn't Explain What NWAI Does)
- **Current**: "Finally know where your money actually goes"
- **Problem**: Generic tagline. First-time visitor has NO IDEA what the app does.
- **Missing**: Upload statements → see net worth, spending in Fixed/Essentials/Flexible, subscriptions, debt payoff, ask AI

### 2. Security Messaging Repeated 4+ Times
1. Trust bar (line 272): 3 items
2. Security section badges (line 411): 4 cards
3. Visual trust badges (line 429): 5 mini badges
4. Comparison box (line 446): "Compare to Mint/Credit Karma"

**All say the same thing**: No bank login, data encrypted, not sold.

### 3. Fake Social Proof
- "10,000+ statements analyzed" - INVENTED
- Testimonials from Priya S., Marcus T., Jessica L. - INVENTED

### 4. Pricing Buried
- Appears at line 456, after security section
- Most visitors will never scroll that far

### 5. No Real Product Visual
- Mock preview card in hero is tiny (380 lines of rendering code)
- Doesn't show the ACTUAL app features (Fixed/Essentials/Flexible, subscriptions, debt payoff)

### 6. Generic Testimonials
- "I knew I was spending too much on food" - vague
- "Finally a finance app that doesn't want my password" - just repeats security messaging
- "Found 3 streaming services I forgot about" - only real detail

---

## Actual Pricing (from `src/lib/plans.ts`)

### Free Plan
- **Price**: $0 forever
- **Uploads**: 8 per month
- **History**: Full (unlimited)
- **Features**:
  - ✅ Net worth & spending summary
  - ✅ Subscription detection
  - ✅ Goals tracker
  - ✅ Multi-upload
  - ✅ AI chat (50 answers/month)
  - ❌ AI insights
  - ❌ Spending forecast
  - ❌ Debt payoff planner
  - ❌ What-if scenarios
  - ❌ Data export (CSV)

### Pro Plan
- **Price**: $9.99/month
- **Uploads**: Unlimited
- **History**: Unlimited
- **Features**: Everything (forecast, payoff planner, AI insights, export, what-if, unlimited AI)

---

## Redesign Plan

### Goal
First-time visitor should understand within **5 seconds**:
1. **What it does**: Upload bank statements → see net worth, spending breakdown, subscriptions, debt payoff, ask AI
2. **Why it's safe**: One concise privacy/security section (not 4)
3. **How to start**: Sign up for free

### Proposed Flow

#### 1. Hero (Strong, Clear)
- **Headline**: "Your bank statement knows everything. Now you do too."
- **Subhead**: "Upload a PDF statement and see: net worth, spending in Fixed/Essentials/Flexible groups, forgotten subscriptions, and debt payoff plans. No bank login required."
- **Primary CTA**: "Try it free" or "Upload your first statement"
- **Visual**: Real product screenshot or diagram showing Fixed/Essentials/Flexible breakdown

#### 2. How It Works (3 Steps)
- Download PDF from your bank
- Upload it here (no bank login)
- Get instant insights (< 60 seconds)

#### 3. Feature Blocks (3-5 Real Features)
Draw from actual app features:
- **Net Worth Tracking**: See all accounts in one place
- **Smart Spending Groups**: Fixed (loans), Essentials (groceries), Flexible (dining)
- **Subscription Detection**: Find forgotten recurring charges
- **Debt Payoff Planner**: Calculate payoff strategies (Pro feature)
- **Ask AI**: Chat about your finances (50 free answers/month)

#### 4. Security Section (ONE Section, Concise)
- **Title**: "Your data stays yours"
- **3-4 key points**: No bank login, encrypted storage, never sold, private to your account
- No repetition elsewhere on the page

#### 5. Pricing (Higher Up)
- Place after features, before FAQ
- Show Free ($0) and Pro ($9.99/month) with accurate feature lists
- Match plans.ts exactly

#### 6. FAQ (Short)
- 4-6 questions covering the essentials
- Keep it brief

#### 7. Final CTA
- Repeat primary CTA at bottom
- Clear next step

### What NOT to Include
- ❌ Fake social proof stats ("10,000+ statements")
- ❌ Fake testimonials (Priya S., Marcus T., Jessica L.)
- ❌ Repeated security messaging (say it once, clearly)
- ❌ Generic insight examples (use real feature descriptions instead)

If testimonials are needed, mark them as **clear placeholders** with disclaimer.

---

## Implementation Plan

1. **Check query param** `?v=2` to render new version
2. **Build new hero** with clear headline + real visual
3. **Build feature blocks** from actual app features
4. **ONE security section** (concise, no duplication)
5. **Pricing section** with accurate plans.ts data
6. **Short FAQ** (4-6 questions)
7. **Remove fake stats** and fake testimonials
8. **Keep responsive** with existing Tailwind styles
9. **tsc**: 0 non-test errors
10. **Push** and open draft PR

---

## Expected Outcome

A landing page where a first-time visitor:
1. **Understands in 5 seconds** what NWAI does (upload statements, see net worth/spending/subscriptions/debt)
2. **Trusts it** (one clear security section, not 4)
3. **Signs up for free** (clear CTA, pricing visible)
4. **Sees real value** (actual feature descriptions, not fake testimonials)
