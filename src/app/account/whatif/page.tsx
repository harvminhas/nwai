"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { getFirebaseClient } from "@/lib/firebase";
import { usePlan } from "@/contexts/PlanContext";

// ── types ──────────────────────────────────────────────────────────────────────

interface FinancialSnapshot {
  netWorth: number;
  monthlyIncome: number;
  monthlyExpenses: number;
  monthlySavings: number;
  savingsRate: number;
  totalDebt: number;
  liquidAssets: number;
  emergencyFundTarget: number;
}

// ── helpers ────────────────────────────────────────────────────────────────────

function fmt(v: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD",
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(v);
}

function fmtDelta(v: number) {
  return `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;
}
function addMonthsLabel(months: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() + months);
  return d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

// ── primitive UI components ────────────────────────────────────────────────────

type Accent = "green" | "amber" | "red" | "default";
const accentColor: Record<Accent, string> = {
  green: "text-emerald-600",
  amber: "text-amber-600",
  red:   "text-red-600",
  default: "text-gray-900",
};

function OutcomeCard({ label, value, sub, accent = "default" }: {
  label: string; value: string; sub?: string; accent?: Accent;
}) {
  return (
    <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
      <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">{label}</p>
      <p className={`mt-1 text-xl font-bold leading-tight ${accentColor[accent]}`}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-gray-400">{sub}</p>}
    </div>
  );
}

function VerdictBanner({ color, text }: { color: "green" | "amber" | "red" | "blue"; text: string }) {
  const styles = {
    green: "bg-emerald-50 border-emerald-200 text-emerald-800",
    amber: "bg-amber-50 border-amber-200 text-amber-800",
    red:   "bg-red-50 border-red-200 text-red-800",
    blue:  "bg-blue-50 border-blue-200 text-blue-800",
  };
  const icons = { green: "✓", amber: "⚠", red: "✕", blue: "ℹ" };
  return (
    <div className={`flex items-start gap-3 rounded-xl border px-4 py-3 text-sm ${styles[color]}`}>
      <span className="mt-0.5 font-bold">{icons[color]}</span>
      <span>{text}</span>
    </div>
  );
}

function SliderRow({ label, value, min, max, step, onChange, format }: {
  label: string; value: number; min: number; max: number; step: number;
  onChange: (v: number) => void; format?: (v: number) => string;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm font-medium text-gray-700">{label}</span>
        <span className="text-sm font-semibold text-purple-700">{format ? format(value) : value}</span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-purple-600"
      />
      <div className="flex justify-between text-[10px] text-gray-300 mt-0.5">
        <span>{format ? format(min) : min}</span>
        <span>{format ? format(max) : max}</span>
      </div>
    </div>
  );
}

function NumInput({ label, value, onChange, prefix, suffix }: {
  label: string; value: string; onChange: (v: string) => void;
  prefix?: string; suffix?: string;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      <div className="flex items-center overflow-hidden rounded-lg border border-gray-200 bg-white focus-within:border-purple-400 focus-within:ring-1 focus-within:ring-purple-200">
        {prefix && <span className="shrink-0 border-r border-gray-200 bg-gray-50 px-2.5 py-2 text-xs text-gray-400">{prefix}</span>}
        <input
          type="number" value={value}
          onChange={(e) => onChange(e.target.value)}
          className="min-w-0 flex-1 px-3 py-2 text-sm outline-none"
        />
        {suffix && <span className="shrink-0 border-l border-gray-200 bg-gray-50 px-2.5 py-2 text-xs text-gray-400">{suffix}</span>}
      </div>
    </div>
  );
}

// ── MODE 1: New Purchase ───────────────────────────────────────────────────────

function Mode1NewPurchase({ snap }: { snap: FinancialSnapshot }) {
  const [name, setName]         = useState("iPhone 16 Pro");
  const [isOneTime, setIsOneTime] = useState(false);
  const [cost, setCost]         = useState(55);
  const [months, setMonths]     = useState(24);

  const monthlyCost        = isOneTime ? cost / Math.max(months, 1) : cost;
  const totalCost          = isOneTime ? cost : cost * months;
  const newMonthlySavings  = snap.monthlySavings - monthlyCost;
  const newSavingsRate     = snap.monthlyIncome > 0 ? (newMonthlySavings / snap.monthlyIncome) * 100 : 0;
  const savingsRateDelta   = newSavingsRate - snap.savingsRate;

  const efCurrent  = snap.liquidAssets;
  const efTarget   = snap.emergencyFundTarget;
  const baseEFMo   = snap.monthlySavings > 0 ? Math.max(0, Math.ceil((efTarget - efCurrent) / snap.monthlySavings)) : 999;
  const newEFMo    = newMonthlySavings  > 0 ? Math.max(0, Math.ceil((efTarget - efCurrent) / newMonthlySavings))  : 999;
  const efDelay    = newEFMo === 999 ? 99 : Math.max(0, newEFMo - baseEFMo);

  const baseNW12   = snap.netWorth + snap.monthlySavings * 12;
  const newNW12    = snap.netWorth + newMonthlySavings * 12;
  const nwDelta    = newNW12 - baseNW12;

  const verdictColor: Accent =
    efDelay === 0 && savingsRateDelta > -2 ? "green" :
    efDelay <= 3  || savingsRateDelta > -5 ? "amber" : "red";

  const verdictText =
    verdictColor === "green"
      ? `${name || "This purchase"} is comfortably within budget. It won't delay your emergency fund and has minimal savings rate impact.`
      : verdictColor === "amber"
      ? `${name || "This purchase"} is manageable but delays your emergency fund by ~${efDelay} month${efDelay !== 1 ? "s" : ""} and drops savings rate by ${Math.abs(savingsRateDelta).toFixed(1)}%.`
      : `${name || "This purchase"} puts real strain on your goals — pushing emergency fund back ${efDelay} months and dropping savings rate by ${Math.abs(savingsRateDelta).toFixed(1)}%. Consider a lower-cost alternative.`;

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-gray-100 bg-gray-50/50 p-5 space-y-5">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Item name</label>
          <input
            type="text" value={name} onChange={(e) => setName(e.target.value)}
            placeholder="e.g. iPhone 16 Pro"
            className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-purple-400 focus:ring-1 focus:ring-purple-200"
          />
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-gray-700">Cost type</span>
          <div className="flex overflow-hidden rounded-lg border border-gray-200 text-sm font-medium">
            {["Monthly", "One-time"].map((t) => (
              <button
                key={t}
                onClick={() => setIsOneTime(t === "One-time")}
                className={`px-3 py-1.5 transition ${(t === "One-time") === isOneTime ? "bg-purple-600 text-white" : "bg-white text-gray-600 hover:bg-gray-50"}`}
              >{t}</button>
            ))}
          </div>
        </div>
        <SliderRow
          label={isOneTime ? "Purchase price" : "Monthly cost"}
          value={cost} min={10} max={500} step={5} onChange={setCost} format={fmt}
        />
        <SliderRow
          label={isOneTime ? "Spread over" : "Contract length"}
          value={months} min={1} max={36} step={1} onChange={setMonths}
          format={(v) => `${v} mo`}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <OutcomeCard label="Total committed" value={fmt(totalCost)} sub={`Over ${months} months`} />
        <OutcomeCard
          label="Emergency fund delayed"
          value={efDelay === 99 ? "Cannot reach" : efDelay === 0 ? "No delay" : `${efDelay} mo`}
          sub="vs current timeline"
          accent={efDelay === 0 ? "green" : efDelay <= 3 ? "amber" : "red"}
        />
        <OutcomeCard
          label="Savings rate"
          value={`${Math.max(0, newSavingsRate).toFixed(1)}%`}
          sub={`${fmtDelta(savingsRateDelta)} from ${snap.savingsRate.toFixed(1)}%`}
          accent={savingsRateDelta >= -2 ? "green" : savingsRateDelta >= -5 ? "amber" : "red"}
        />
        <OutcomeCard
          label="Net worth in 12 months"
          value={fmt(newNW12)}
          sub={`${nwDelta >= 0 ? "+" : ""}${fmt(nwDelta)} vs baseline`}
          accent={nwDelta >= 0 ? "green" : nwDelta > -3000 ? "amber" : "red"}
        />
      </div>
      <VerdictBanner color={verdictColor} text={verdictText} />
    </div>
  );
}

// ── MODE 2: Buy vs Rent ────────────────────────────────────────────────────────

function Mode2BuyVsRent({ snap }: { snap: FinancialSnapshot }) {
  const [homePrice,   setHomePrice]   = useState("650000");
  const [downPct,     setDownPct]     = useState("10");
  const [mortRate,    setMortRate]    = useState("5.5");
  const [amortYears,  setAmortYears]  = useState("25");
  const [propTaxPct,  setPropTaxPct]  = useState("1.2");
  const [maintPct,    setMaintPct]    = useState("0.8");
  const [rent,        setRent]        = useState("2400");
  const [rentIncrPct, setRentIncrPct] = useState("3");
  const [investRet,   setInvestRet]   = useState("6");

  const price      = Math.max(0, parseFloat(homePrice)  || 650000);
  const down       = price * Math.max(0, parseFloat(downPct) || 10) / 100;
  const principal  = price - down;
  const r          = (parseFloat(mortRate) || 5.5) / 100 / 12;
  const n          = (parseFloat(amortYears) || 25) * 12;
  const monthlyMortgage = principal > 0 && r > 0
    ? principal * (r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1)
    : principal / n;
  const monthlyPropTax  = price * (parseFloat(propTaxPct) || 1.2) / 100 / 12;
  const monthlyMaint    = price * (parseFloat(maintPct)   || 0.8) / 100 / 12;
  const totalBuying     = monthlyMortgage + monthlyPropTax + monthlyMaint;

  const monthlyRent  = parseFloat(rent) || 2400;
  const rentIncr     = (parseFloat(rentIncrPct) || 3) / 100;
  const invRetPct    = (parseFloat(investRet)   || 6) / 100;

  // Year-by-year simulation
  let breakEvenYear: number | null = null;
  let buyNW10 = snap.netWorth, rentNW10 = snap.netWorth;
  let curRent = monthlyRent;
  let investedDown = down;
  for (let y = 1; y <= 30; y++) {
    const homeValue      = price * Math.pow(1.04, y);
    const remaining      = principal * (Math.pow(1 + r, n) - Math.pow(1 + r, y * 12)) / (Math.pow(1 + r, n) - 1);
    const equity         = homeValue - Math.max(0, remaining);
    const buyDelta       = snap.monthlySavings - totalBuying;
    buyNW10              = snap.netWorth + equity + buyDelta * 12 * y;

    investedDown         = down * Math.pow(1 + invRetPct, y);
    const extraFromRent  = (totalBuying - curRent) * 12 * y;
    rentNW10             = snap.netWorth + investedDown + extraFromRent;
    curRent             *= (1 + rentIncr);
    if (breakEvenYear === null && buyNW10 >= rentNW10) breakEvenYear = y;
  }

  const rentDelta  = totalBuying - monthlyRent;
  const buyingWins = breakEvenYear !== null && breakEvenYear <= 10;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-5 rounded-2xl border border-gray-100 bg-gray-50/50 p-5">
        <div className="space-y-3">
          <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400">Buying</p>
          <NumInput label="Home price"     value={homePrice}   onChange={setHomePrice}   prefix="$" />
          <NumInput label="Down payment"   value={downPct}     onChange={setDownPct}     suffix="%" />
          <NumInput label="Mortgage rate"  value={mortRate}    onChange={setMortRate}    suffix="%" />
          <NumInput label="Amortization"   value={amortYears}  onChange={setAmortYears}  suffix="yrs" />
          <NumInput label="Property tax"   value={propTaxPct}  onChange={setPropTaxPct}  suffix="% /yr" />
          <NumInput label="Maintenance"    value={maintPct}    onChange={setMaintPct}    suffix="% /yr" />
        </div>
        <div className="space-y-3">
          <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400">Renting</p>
          <NumInput label="Monthly rent"       value={rent}        onChange={setRent}        prefix="$" />
          <NumInput label="Annual rent increase" value={rentIncrPct} onChange={setRentIncrPct} suffix="%" />
          <NumInput label="Investment return"  value={investRet}   onChange={setInvestRet}   suffix="%" />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <OutcomeCard
          label="Monthly cost (buying)"
          value={fmt(totalBuying)}
          sub={`${rentDelta >= 0 ? "+" : ""}${fmt(rentDelta)} vs rent`}
          accent={rentDelta <= 0 ? "green" : rentDelta < 500 ? "amber" : "red"}
        />
        <OutcomeCard
          label="Break-even point"
          value={breakEvenYear !== null ? `Year ${breakEvenYear}` : "Never <30yr"}
          sub="When buying becomes cheaper"
          accent={breakEvenYear !== null && breakEvenYear <= 7 ? "green" : breakEvenYear !== null ? "amber" : "red"}
        />
        <OutcomeCard
          label="Net worth 10yr — buying"
          value={fmt(buyNW10)}
          sub="Equity + savings delta"
          accent={buyNW10 >= rentNW10 ? "green" : "amber"}
        />
        <OutcomeCard
          label="Net worth 10yr — renting"
          value={fmt(rentNW10)}
          sub="Invested down + savings delta"
          accent={rentNW10 > buyNW10 ? "green" : "amber"}
        />
      </div>
      <VerdictBanner
        color={buyingWins ? "green" : "blue"}
        text={buyingWins
          ? `Buying comes out ahead after ${breakEvenYear} year${breakEvenYear !== 1 ? "s" : ""}. Stay ${breakEvenYear}+ years and buying wins.`
          : `Renting and investing the difference comes out ahead over 10 years. Buying only wins if you stay ${breakEvenYear ?? "20"}+ years.`}
      />
    </div>
  );
}

// ── MODE 3: New Car ────────────────────────────────────────────────────────────

function Mode3NewCar({ snap }: { snap: FinancialSnapshot }) {
  const [price,    setPrice]    = useState(35000);
  const [down,     setDown]     = useState(5000);
  const [tradeIn,  setTradeIn]  = useState(0);
  const [termMo,   setTermMo]   = useState(60);
  const [apr,      setApr]      = useState(6.5);

  const principal    = Math.max(0, price - down - tradeIn);
  const r            = apr / 100 / 12;
  const monthlyPmt   = principal > 0 && r > 0
    ? principal * (r * Math.pow(1 + r, termMo)) / (Math.pow(1 + r, termMo) - 1)
    : principal / termMo;
  const totalInterest  = Math.max(0, monthlyPmt * termMo - principal);
  const trueCost       = price - tradeIn + totalInterest;
  const newMonthlySav  = snap.monthlySavings - monthlyPmt;
  const newSavRate     = snap.monthlyIncome > 0 ? (newMonthlySav / snap.monthlyIncome) * 100 : 0;
  const savRateDelta   = newSavRate - snap.savingsRate;
  const incomeRatio    = snap.monthlyIncome > 0 ? (monthlyPmt / snap.monthlyIncome) * 100 : 20;

  const efCurrent  = snap.liquidAssets;
  const efTarget   = snap.emergencyFundTarget;
  const baseEFMo   = snap.monthlySavings > 0 ? Math.max(0, Math.ceil((efTarget - efCurrent) / snap.monthlySavings)) : 999;
  const newEFMo    = newMonthlySav  > 0 ? Math.max(0, Math.ceil((efTarget - efCurrent) / newMonthlySav))  : 999;
  const efDelay    = newEFMo === 999 ? 99 : Math.max(0, newEFMo - baseEFMo);

  const verdictColor: Accent = incomeRatio < 10 ? "green" : incomeRatio < 15 ? "amber" : "red";
  const verdictText =
    verdictColor === "green"
      ? `At ${fmt(monthlyPmt)}/mo (${incomeRatio.toFixed(1)}% of income), this car fits comfortably within your budget. Total cost including interest: ${fmt(trueCost)}.`
      : verdictColor === "amber"
      ? `At ${fmt(monthlyPmt)}/mo (${incomeRatio.toFixed(1)}% of income), this is manageable but watch your other goals. A larger down payment or trade-in would help.`
      : `${fmt(monthlyPmt)}/mo is ${incomeRatio.toFixed(1)}% of your income — above the 15% recommendation. Consider a cheaper vehicle, larger down payment, or longer term.`;

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-gray-100 bg-gray-50/50 p-5 space-y-5">
        <SliderRow label="Purchase price"     value={price}   min={10000} max={80000} step={1000} onChange={setPrice}   format={fmt} />
        <SliderRow label="Down payment"       value={down}    min={0}     max={20000} step={500}  onChange={setDown}    format={fmt} />
        <SliderRow label="Trade-in value"     value={tradeIn} min={0}     max={15000} step={500}  onChange={setTradeIn} format={fmt} />
        <SliderRow label="Loan term"          value={termMo}  min={24}    max={84}    step={12}   onChange={setTermMo}  format={(v) => `${v} months`} />
        <SliderRow label="Interest rate (APR)" value={apr}   min={3}     max={12}    step={0.5}  onChange={setApr}     format={(v) => `${v}%`} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <OutcomeCard
          label="Monthly payment"
          value={fmt(monthlyPmt)}
          sub={`${incomeRatio.toFixed(1)}% of monthly income`}
          accent={verdictColor}
        />
        <OutcomeCard
          label="True cost (incl. interest)"
          value={fmt(trueCost)}
          sub={`${fmt(totalInterest)} in interest`}
          accent={totalInterest > 5000 ? "amber" : "default"}
        />
        <OutcomeCard
          label="Savings rate"
          value={`${Math.max(0, newSavRate).toFixed(1)}%`}
          sub={`${fmtDelta(savRateDelta)} from ${snap.savingsRate.toFixed(1)}%`}
          accent={savRateDelta >= -2 ? "green" : savRateDelta >= -5 ? "amber" : "red"}
        />
        <OutcomeCard
          label="Emergency fund delayed"
          value={efDelay === 99 ? "Cannot reach" : efDelay === 0 ? "No delay" : `${efDelay} mo`}
          sub="vs current timeline"
          accent={efDelay === 0 ? "green" : efDelay <= 3 ? "amber" : "red"}
        />
      </div>
      <VerdictBanner color={verdictColor} text={verdictText} />
    </div>
  );
}

// ── MODE 4: Savings Levers ─────────────────────────────────────────────────────

function Mode4SavingsLevers({ snap }: { snap: FinancialSnapshot }) {
  const [cutSubs,      setCutSubs]      = useState(0);
  const [cutDining,    setCutDining]    = useState(0);
  const [extraSavings, setExtraSavings] = useState(0);
  const [extraDebt,    setExtraDebt]    = useState(0);

  const totalReclaimed  = cutSubs + cutDining + extraSavings + extraDebt;
  const newMonthlySav   = snap.monthlySavings + cutSubs + cutDining + extraSavings;

  const efTarget   = snap.emergencyFundTarget;
  const efCurrent  = snap.liquidAssets;
  const efMo       = newMonthlySav > 0 ? Math.max(0, Math.ceil((efTarget - efCurrent) / newMonthlySav)) : 999;

  // Debt payoff simulation (8% APR default)
  const debtBal        = Math.max(snap.totalDebt, 0);
  const debtRate       = 0.08 / 12;
  const minDebtPayment = Math.max(25, debtBal * 0.02);
  const totalDebtPmt   = minDebtPayment + extraDebt;
  let debtMonths = 0;
  if (debtBal > 0) {
    let bal = debtBal;
    while (bal > 0 && debtMonths < 600) {
      bal = bal * (1 + debtRate) - totalDebtPmt;
      debtMonths++;
    }
  }

  const vacGoal  = 3000;
  const vacMo    = newMonthlySav > 0 ? Math.ceil(vacGoal / newMonthlySav) : 999;
  const nw12     = snap.netWorth + newMonthlySav * 12;

  return (
    <div className="space-y-5">
      {totalReclaimed > 0 && (
        <div className="flex justify-center">
          <div className="inline-flex items-center gap-2 rounded-full bg-purple-600 px-4 py-2 text-sm font-semibold text-white shadow-sm">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
            </svg>
            {fmt(totalReclaimed)} / month reclaimed
          </div>
        </div>
      )}

      <div className="rounded-2xl border border-gray-100 bg-gray-50/50 p-5 space-y-5">
        <SliderRow label="Cut subscriptions"       value={cutSubs}      min={0} max={200} step={10} onChange={setCutSubs}      format={fmt} />
        <SliderRow label="Reduce dining out"       value={cutDining}    min={0} max={300} step={10} onChange={setCutDining}    format={fmt} />
        <SliderRow label="Increase savings transfer" value={extraSavings} min={0} max={500} step={25} onChange={setExtraSavings} format={fmt} />
        <SliderRow label="Extra debt payment"      value={extraDebt}    min={0} max={400} step={25} onChange={setExtraDebt}    format={fmt} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <OutcomeCard
          label={`Emergency fund (${fmt(efTarget)} goal)`}
          value={efMo === 0 ? "Achieved" : efMo === 999 ? "—" : addMonthsLabel(efMo)}
          sub={efMo === 999 ? "Increase savings to reach" : efMo === 0 ? "Already funded" : `~${efMo} months away`}
          accent={efMo <= 6 ? "green" : efMo <= 18 ? "amber" : "red"}
        />
        <OutcomeCard
          label="Debt-free date"
          value={debtBal <= 0 ? "No debt" : debtMonths >= 600 ? "100+ yrs" : addMonthsLabel(debtMonths)}
          sub={debtBal <= 0 ? "" : `Based on ${fmt(debtBal)} balance`}
          accent={debtMonths <= 24 ? "green" : debtMonths <= 60 ? "amber" : "red"}
        />
        <OutcomeCard
          label="Vacation fund ($3,000)"
          value={vacMo === 999 ? "—" : `${vacMo} months`}
          sub={vacMo === 999 ? "Increase savings" : `By ${addMonthsLabel(vacMo)}`}
          accent={vacMo <= 6 ? "green" : vacMo <= 12 ? "amber" : "red"}
        />
        <OutcomeCard
          label="Net worth in 12 months"
          value={fmt(nw12)}
          sub={`${nw12 >= snap.netWorth ? "+" : ""}${fmt(nw12 - snap.netWorth)} from today`}
          accent={nw12 > snap.netWorth ? "green" : "red"}
        />
      </div>
    </div>
  );
}

// ── MODE 5: Salary Change ──────────────────────────────────────────────────────

function Mode5SalaryChange({ snap }: { snap: FinancialSnapshot }) {
  const currentAnnual = Math.round(snap.monthlyIncome * 12 / 1000) * 1000 || 60000;
  const [newAnnual,      setNewAnnual]      = useState(currentAnnual);
  const [effectiveInMo,  setEffectiveInMo]  = useState(0);

  const newMonthlyIncome  = newAnnual / 12;
  const incomeChange      = newMonthlyIncome - snap.monthlyIncome;
  const newMonthlySav     = snap.monthlySavings + incomeChange;
  const newSavRate        = newMonthlyIncome > 0 ? (newMonthlySav / newMonthlyIncome) * 100 : 0;
  const savRateDelta      = newSavRate - snap.savingsRate;
  const isRaise           = incomeChange >= 0;

  const efCurrent  = snap.liquidAssets;
  const efTarget   = snap.emergencyFundTarget;
  const baseEFMo   = snap.monthlySavings > 0 ? Math.max(0, Math.ceil((efTarget - efCurrent) / snap.monthlySavings)) : 999;
  const newEFMo    = newMonthlySav  > 0 ? Math.max(0, Math.ceil((efTarget - efCurrent) / newMonthlySav))  : 999;
  const efChange   = baseEFMo === 999 ? -99 : newEFMo === 999 ? 99 : newEFMo - baseEFMo;

  const nw12Baseline = snap.netWorth + snap.monthlySavings * 12;
  const nw12New      = snap.netWorth
    + snap.monthlySavings * effectiveInMo
    + newMonthlySav * (12 - effectiveInMo);
  const nwDelta = nw12New - nw12Baseline;

  const verdictColor: Accent = isRaise ? "green" : incomeChange > -snap.monthlyIncome * 0.2 ? "amber" : "red";
  const verdictText = isRaise
    ? `A ${fmt(incomeChange)}/mo raise boosts your savings rate to ${Math.max(0, newSavRate).toFixed(1)}% and adds ${fmt(Math.abs(nwDelta))} to your net worth over 12 months.`
    : `This ${fmt(Math.abs(incomeChange))}/mo reduction drops your savings rate to ${Math.max(0, newSavRate).toFixed(1)}% and your emergency fund timeline extends by ${Math.abs(efChange)} months.`;

  const sliderMin = Math.max(20000, Math.round(currentAnnual * 0.5 / 1000) * 1000);
  const sliderMax = Math.round(currentAnnual * 2 / 1000) * 1000 + 20000;

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-gray-100 bg-gray-50/50 p-5 space-y-5">
        <div className="rounded-xl bg-purple-50 px-4 py-3 flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-purple-500">Current annual income</p>
            <p className="text-lg font-bold text-purple-800">{fmt(currentAnnual)}</p>
          </div>
          <div className="text-right text-xs text-gray-400">
            <p>{fmt(snap.monthlyIncome)} / mo</p>
          </div>
        </div>
        <SliderRow
          label="New annual salary"
          value={newAnnual}
          min={sliderMin} max={sliderMax} step={1000}
          onChange={setNewAnnual} format={fmt}
        />
        <SliderRow
          label="Effective in"
          value={effectiveInMo} min={0} max={11} step={1}
          onChange={setEffectiveInMo}
          format={(v) => v === 0 ? "Immediately" : `${v} month${v !== 1 ? "s" : ""}`}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <OutcomeCard
          label="Monthly income change"
          value={`${incomeChange >= 0 ? "+" : ""}${fmt(incomeChange)}`}
          sub={`${fmt(newMonthlyIncome)}/mo new income`}
          accent={isRaise ? "green" : "red"}
        />
        <OutcomeCard
          label="New savings rate"
          value={`${Math.max(0, newSavRate).toFixed(1)}%`}
          sub={`${fmtDelta(savRateDelta)} from ${snap.savingsRate.toFixed(1)}%`}
          accent={newSavRate >= 20 ? "green" : newSavRate >= 10 ? "amber" : "red"}
        />
        <OutcomeCard
          label="Emergency fund"
          value={Math.abs(efChange) === 0 ? "Unchanged" : `${Math.abs(efChange)} mo ${efChange < 0 ? "faster" : "slower"}`}
          sub={efChange < 0 ? "Accelerated" : efChange === 0 ? "" : "Delayed"}
          accent={efChange < 0 ? "green" : efChange === 0 ? "default" : "amber"}
        />
        <OutcomeCard
          label="Net worth in 12 months"
          value={fmt(nw12New)}
          sub={`${nwDelta >= 0 ? "+" : ""}${fmt(nwDelta)} vs baseline`}
          accent={nwDelta >= 0 ? "green" : "red"}
        />
      </div>
      <VerdictBanner color={verdictColor} text={verdictText} />
    </div>
  );
}

// ── MODE 6: Pay Off Debt Lump Sum ──────────────────────────────────────────────

function Mode6PayoffLump({ snap }: { snap: FinancialSnapshot }) {
  const [lumpSum, setLumpSum] = useState(5000);
  const [apr,     setApr]     = useState(8);

  const debtBal    = Math.max(snap.totalDebt, 0);
  const r          = apr / 100 / 12;
  const minPayment = Math.max(25, debtBal * 0.02);

  // Simulate baseline
  let baseMo = 0, baseInterest = 0;
  if (debtBal > 0) {
    let bal = debtBal;
    while (bal > 0 && baseMo < 600) {
      baseInterest += bal * r;
      bal = bal * (1 + r) - minPayment;
      baseMo++;
    }
  }

  // Simulate with lump sum
  const newBal   = Math.max(0, debtBal - lumpSum);
  let newMo = 0, newInterest = 0;
  if (newBal > 0) {
    let bal = newBal;
    while (bal > 0 && newMo < 600) {
      newInterest += bal * r;
      bal = bal * (1 + r) - minPayment;
      newMo++;
    }
  }

  const monthsSaved    = Math.max(0, baseMo - newMo);
  const interestSaved  = Math.max(0, baseInterest - newInterest);
  const lumpSafeLimit  = snap.liquidAssets - snap.emergencyFundTarget;
  const isLargeChunk   = lumpSum > snap.liquidAssets * 0.5;

  const verdictColor: Accent =
    debtBal <= 0  ? "green" :
    lumpSum <= 0  ? "default" :
    isLargeChunk  ? "amber" : "green";

  const verdictText =
    debtBal <= 0
      ? "Great news — you have no tracked debt. Use this to model a future scenario."
      : lumpSum <= 0
      ? "Adjust the lump sum to see the impact."
      : isLargeChunk
      ? `Paying ${fmt(lumpSum)} saves ${fmt(interestSaved)} in interest and gets you debt-free ${monthsSaved} months sooner. This uses a large portion of liquid assets — keep at least ${fmt(snap.emergencyFundTarget)} in your emergency fund.`
      : `Paying ${fmt(lumpSum)} now saves ${fmt(interestSaved)} in interest and gets you debt-free by ${addMonthsLabel(newMo)} — ${monthsSaved} months sooner.`;

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-gray-100 bg-gray-50/50 p-5 space-y-5">
        <div className="rounded-xl bg-red-50 px-4 py-3 flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-red-400">Current total debt</p>
            <p className="text-lg font-bold text-red-700">{fmt(debtBal)}</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-gray-400">Safe to deploy</p>
            <p className="text-sm font-semibold text-gray-700">{lumpSafeLimit > 0 ? fmt(lumpSafeLimit) : "—"}</p>
          </div>
        </div>
        <SliderRow
          label="Lump sum payment"
          value={lumpSum}
          min={0}
          max={Math.max(debtBal, 20000)}
          step={500}
          onChange={setLumpSum}
          format={fmt}
        />
        <SliderRow
          label="Debt APR"
          value={apr} min={3} max={25} step={0.5}
          onChange={setApr}
          format={(v) => `${v}%`}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <OutcomeCard
          label="Months saved"
          value={debtBal <= 0 ? "No debt" : `${monthsSaved} mo`}
          sub={debtBal <= 0 ? "" : `Debt-free by ${addMonthsLabel(newMo)}`}
          accent={monthsSaved >= 12 ? "green" : monthsSaved >= 3 ? "amber" : "default"}
        />
        <OutcomeCard
          label="Interest saved"
          value={fmt(interestSaved)}
          sub="Pure wealth gain"
          accent={interestSaved >= 1000 ? "green" : interestSaved >= 100 ? "amber" : "default"}
        />
        <OutcomeCard
          label="Remaining debt"
          value={fmt(newBal)}
          sub={`Down from ${fmt(debtBal)}`}
          accent={newBal === 0 ? "green" : newBal < debtBal * 0.5 ? "amber" : "default"}
        />
        <OutcomeCard
          label="Net worth impact"
          value={`+${fmt(interestSaved)}`}
          sub="Interest savings = wealth"
          accent={interestSaved >= 1000 ? "green" : "default"}
        />
      </div>
      <VerdictBanner color={verdictColor} text={verdictText} />
    </div>
  );
}

// ── mode config ────────────────────────────────────────────────────────────────

const MODES = [
  { id: "purchase", label: "New purchase",   free: true  },
  { id: "buyrent",  label: "Buy vs rent",    free: false },
  { id: "car",      label: "New car",        free: false },
  { id: "levers",   label: "Savings levers", free: false },
  { id: "salary",   label: "Salary change",  free: false },
  { id: "payoff",   label: "Pay off debt",   free: false },
];

// ── locked overlay ─────────────────────────────────────────────────────────────

function LockedOverlay({ onUpgrade }: { onUpgrade: () => void }) {
  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center rounded-2xl backdrop-blur-[3px] bg-white/70">
      <div className="flex flex-col items-center gap-3 text-center px-6">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-purple-100">
          <svg className="h-6 w-6 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
        </div>
        <div>
          <p className="font-semibold text-gray-900">Pro feature</p>
          <p className="mt-1 text-sm text-gray-500 max-w-[220px]">Upgrade to model this scenario against your real financial data.</p>
        </div>
        <button
          onClick={onUpgrade}
          className="rounded-lg bg-purple-600 px-5 py-2 text-sm font-semibold text-white hover:bg-purple-700 transition"
        >
          Upgrade to Pro
        </button>
      </div>
    </div>
  );
}

// ── main inner component (uses useSearchParams) ────────────────────────────────

function WhatIfInner() {
  const searchParams  = useSearchParams();
  const router        = useRouter();
  const pathname      = usePathname();
  const { can, setTestPlan } = usePlan();
  const isPro         = can("whatIf");

  const [snap,    setSnap]    = useState<FinancialSnapshot | null>(null);
  const [loading, setLoading] = useState(true);

  const activeMode = searchParams.get("mode") ?? "purchase";

  useEffect(() => {
    const { auth } = getFirebaseClient();
    return onAuthStateChanged(auth, async (user) => {
      if (!user) { setLoading(false); return; }
      try {
        const token = await user.getIdToken();
        const res   = await fetch("/api/user/statements/consolidated", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error();
        const json = await res.json();
        // Financial data lives under json.data; top-level has liquidAssets etc.
        const d               = json.data ?? {};
        const monthlyIncome   = d.income?.total      ?? 0;
        const monthlyExpenses = d.expenses?.total    ?? 0;
        const assets          = d.assets             ?? Math.max(0, d.netWorth ?? 0);
        const debts           = d.debts              ?? 0;
        const netWorth        = assets - debts;
        const monthlySavings  = monthlyIncome - monthlyExpenses;
        const savingsRate     = monthlyIncome > 0 ? (monthlySavings / monthlyIncome) * 100 : 0;
        const liquidAssets    = json.liquidAssets    ?? assets * 0.3;
        setSnap({
          netWorth, monthlyIncome, monthlyExpenses, monthlySavings,
          savingsRate, totalDebt: debts,
          liquidAssets, emergencyFundTarget: monthlyExpenses * 6,
        });
      } catch {
        // Fallback demo snapshot so page is always usable
        setSnap({ netWorth: 47210, monthlyIncome: 5800, monthlyExpenses: 4700,
          monthlySavings: 1100, savingsRate: 19, totalDebt: 4800,
          liquidAssets: 8000, emergencyFundTarget: 28200 });
      }
      setLoading(false);
    });
  }, []);

  function setMode(id: string) {
    const p = new URLSearchParams(searchParams.toString());
    p.set("mode", id);
    router.push(`${pathname}?${p.toString()}`);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-purple-200 border-t-purple-600" />
      </div>
    );
  }

  if (!snap) return null;

  const modeConfig = MODES.find((m) => m.id === activeMode);
  const canRunMode = isPro || (modeConfig?.free ?? false);

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-2.5">
          <h1 className="text-2xl font-bold text-gray-900">What If</h1>
          <span className="rounded-full bg-purple-100 px-2.5 py-0.5 text-xs font-semibold text-purple-700">AI</span>
          {!isPro && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700">Pro</span>
          )}
        </div>
        <p className="mt-1 text-sm text-gray-400">Model financial decisions against your real numbers.</p>
      </div>

      {/* Mode pills */}
      <div className="mb-6 flex flex-wrap gap-2">
        {MODES.map((mode) => {
          const isLocked = !isPro && !mode.free;
          const isActive = activeMode === mode.id;
          return (
            <button
              key={mode.id}
              onClick={() => setMode(mode.id)}
              className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-medium transition ${
                isActive
                  ? "bg-purple-600 text-white shadow-sm"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              {mode.label}
              {isLocked && !isActive && (
                <svg className="h-3 w-3 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
              )}
            </button>
          );
        })}
      </div>

      {/* Free-user hint for mode 1 */}
      {!isPro && activeMode === "purchase" && (
        <div className="mb-5 flex items-start gap-3 rounded-xl border border-indigo-100 bg-indigo-50 px-4 py-3">
          <svg className="mt-0.5 h-4 w-4 shrink-0 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-xs text-indigo-700">
            <strong>New Purchase</strong> is free. Upgrade to Pro to unlock Buy vs Rent, New Car, Savings Levers, Salary Change, and Pay Off Debt scenarios.
          </p>
        </div>
      )}

      {/* Mode content */}
      <div className={`relative ${!canRunMode ? "overflow-hidden rounded-2xl" : ""}`}>
        {!canRunMode && <LockedOverlay onUpgrade={() => setTestPlan("pro")} />}
        <div className={!canRunMode ? "pointer-events-none select-none opacity-40" : ""}>
          {activeMode === "purchase" && <Mode1NewPurchase snap={snap} />}
          {activeMode === "buyrent"  && <Mode2BuyVsRent   snap={snap} />}
          {activeMode === "car"      && <Mode3NewCar       snap={snap} />}
          {activeMode === "levers"   && <Mode4SavingsLevers snap={snap} />}
          {activeMode === "salary"   && <Mode5SalaryChange snap={snap} />}
          {activeMode === "payoff"   && <Mode6PayoffLump   snap={snap} />}
        </div>
      </div>
    </div>
  );
}

// ── page export ────────────────────────────────────────────────────────────────

export default function WhatIfPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center py-24">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-purple-200 border-t-purple-600" />
      </div>
    }>
      <WhatIfInner />
    </Suspense>
  );
}
