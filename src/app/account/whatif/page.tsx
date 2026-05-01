"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { getFirebaseClient } from "@/lib/firebase";
import { usePlan } from "@/contexts/PlanContext";
import { fmt } from "@/lib/currencyUtils";
import type {
  WhatIfScenario, FinancialSnapshot, TemplateId,
} from "@/lib/whatIf/types";
import { SCENARIO_COLORS } from "@/lib/whatIf/types";
import {
  TEMPLATES, getTemplate, computeCombinedImpact, buildSparklineData,
  getScenarioDescription, getCompactMetrics, getAiQuestion, num, bool,
} from "@/lib/whatIf/templates";

// ── Panel state ────────────────────────────────────────────────────────────────

type PanelState =
  | { mode: "empty" }
  | { mode: "new";  templateId: TemplateId; inputs: Record<string, number | string | boolean>; name: string }
  | { mode: "edit"; scenario: WhatIfScenario; inputs: Record<string, number | string | boolean>; name: string; templateId: TemplateId }
  | { mode: "fullAnalysis"; scenario: WhatIfScenario; inputs: Record<string, number | string | boolean>; name: string; templateId: TemplateId };

// ── Primitive helpers ─────────────────────────────────────────────────────────

function fmtDelta(v: number) { return `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`; }

function addMonthsLabel(months: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() + months);
  return d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
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
          type="number" value={value} onChange={(e) => onChange(e.target.value)}
          className="min-w-0 flex-1 px-3 py-2 text-sm outline-none"
        />
        {suffix && <span className="shrink-0 border-l border-gray-200 bg-gray-50 px-2.5 py-2 text-xs text-gray-400">{suffix}</span>}
      </div>
    </div>
  );
}

// ── Editor sub-components (inputs only, no outcome cards) ─────────────────────

type InputsProps = {
  inputs: Record<string, number | string | boolean>;
  onChange: (key: string, value: number | string | boolean) => void;
};

function InputsPurchase({ inputs, onChange }: InputsProps) {
  const isOneTime = bool(inputs.isOneTime ?? false);
  const cost      = num(inputs.cost, 55);
  const months    = num(inputs.months, 24);

  // One-time purchases (laptops, appliances, etc.) need a much wider range
  const costMax  = isOneTime ? 10000 : 500;
  const costStep = isOneTime ? (cost >= 1000 ? 50 : 25) : 5;

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Item name</label>
        <input
          type="text" value={String(inputs.name ?? "")}
          onChange={(e) => onChange("name", e.target.value)}
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
              onClick={() => {
                onChange("isOneTime", t === "One-time");
                // Reset cost to a sensible default when switching modes
                if (t === "One-time" && cost <= 100) onChange("cost", 500);
                if (t === "Monthly"  && cost > 500)  onChange("cost", 55);
              }}
              className={`px-3 py-1.5 transition ${(t === "One-time") === isOneTime ? "bg-purple-600 text-white" : "bg-white text-gray-600 hover:bg-gray-50"}`}
            >{t}</button>
          ))}
        </div>
      </div>
      <SliderRow
        label={isOneTime ? "Purchase price" : "Monthly cost"}
        value={Math.min(cost, costMax)}
        min={isOneTime ? 50 : 10}
        max={costMax}
        step={costStep}
        onChange={(v) => onChange("cost", v)}
        format={fmt}
      />
      <SliderRow
        label={isOneTime ? "Spread over" : "Duration"}
        value={months} min={1} max={60} step={1}
        onChange={(v) => onChange("months", v)} format={(v) => `${v} mo`}
      />
    </div>
  );
}

function InputsBuyRent({ inputs, onChange }: InputsProps) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-3">
          <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400">Buying</p>
          <NumInput label="Home price"    value={String(inputs.homePrice  ?? 650000)} onChange={(v) => onChange("homePrice",  v)} prefix="$" />
          <NumInput label="Down payment"  value={String(inputs.downPct    ?? 10)}     onChange={(v) => onChange("downPct",    v)} suffix="%" />
          <NumInput label="Mortgage rate" value={String(inputs.mortRate   ?? 5.5)}    onChange={(v) => onChange("mortRate",   v)} suffix="%" />
          <NumInput label="Amortization"  value={String(inputs.amortYears ?? 25)}     onChange={(v) => onChange("amortYears", v)} suffix="yrs" />
          <NumInput label="Property tax"  value={String(inputs.propTaxPct ?? 1.2)}    onChange={(v) => onChange("propTaxPct", v)} suffix="% /yr" />
          <NumInput label="Maintenance"   value={String(inputs.maintPct   ?? 0.8)}    onChange={(v) => onChange("maintPct",   v)} suffix="% /yr" />
        </div>
        <div className="space-y-3">
          <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400">Renting</p>
          <NumInput label="Monthly rent"         value={String(inputs.rent        ?? 2400)} onChange={(v) => onChange("rent",        v)} prefix="$" />
          <NumInput label="Annual rent increase"  value={String(inputs.rentIncrPct ?? 3)}   onChange={(v) => onChange("rentIncrPct", v)} suffix="%" />
          <NumInput label="Investment return"     value={String(inputs.investRet   ?? 6)}   onChange={(v) => onChange("investRet",   v)} suffix="%" />
        </div>
      </div>
    </div>
  );
}

function InputsCar({ inputs, onChange }: InputsProps) {
  return (
    <div className="space-y-4">
      <SliderRow label="Purchase price"      value={num(inputs.price,   35000)} min={10000} max={80000} step={1000} onChange={(v) => onChange("price",   v)} format={fmt} />
      <SliderRow label="Down payment"        value={num(inputs.down,    5000)}  min={0}     max={20000} step={500}  onChange={(v) => onChange("down",    v)} format={fmt} />
      <SliderRow label="Trade-in value"      value={num(inputs.tradeIn, 0)}     min={0}     max={15000} step={500}  onChange={(v) => onChange("tradeIn", v)} format={fmt} />
      <SliderRow label="Loan term"           value={num(inputs.termMo,  60)}    min={24}    max={84}    step={12}   onChange={(v) => onChange("termMo",  v)} format={(v) => `${v} months`} />
      <SliderRow label="Interest rate (APR)" value={num(inputs.apr,     6.5)}   min={3}     max={12}    step={0.5}  onChange={(v) => onChange("apr",     v)} format={(v) => `${v}%`} />
    </div>
  );
}

function InputsLevers({ inputs, onChange }: InputsProps) {
  return (
    <div className="space-y-4">
      <SliderRow label="Cut subscriptions"         value={num(inputs.cutSubs,      0)} min={0} max={200} step={10} onChange={(v) => onChange("cutSubs",      v)} format={fmt} />
      <SliderRow label="Reduce dining out"          value={num(inputs.cutDining,    0)} min={0} max={300} step={10} onChange={(v) => onChange("cutDining",    v)} format={fmt} />
      <SliderRow label="Increase savings transfer"  value={num(inputs.extraSavings, 0)} min={0} max={500} step={25} onChange={(v) => onChange("extraSavings", v)} format={fmt} />
      <SliderRow label="Extra debt payment"         value={num(inputs.extraDebt,    0)} min={0} max={400} step={25} onChange={(v) => onChange("extraDebt",    v)} format={fmt} />
    </div>
  );
}

function InputsSalary({ inputs, onChange, snap }: InputsProps & { snap: FinancialSnapshot }) {
  const currentAnnual = Math.round(snap.monthlyIncome * 12 / 1000) * 1000 || 60000;
  const newAnnual     = num(inputs.newAnnual, currentAnnual);
  const sliderMin     = Math.max(20000, Math.round(currentAnnual * 0.5 / 1000) * 1000);
  const sliderMax     = Math.round(currentAnnual * 2 / 1000) * 1000 + 20000;
  return (
    <div className="space-y-4">
      <div className="rounded-xl bg-purple-50 px-4 py-3 flex items-center justify-between">
        <div>
          <p className="text-xs font-medium text-purple-500">Current annual income</p>
          <p className="text-base font-bold text-purple-800">{fmt(currentAnnual)}</p>
        </div>
        <p className="text-xs text-gray-400">{fmt(snap.monthlyIncome)} / mo</p>
      </div>
      <SliderRow
        label="New annual salary" value={newAnnual}
        min={sliderMin} max={sliderMax} step={1000}
        onChange={(v) => onChange("newAnnual", v)} format={fmt}
      />
      <SliderRow
        label="Effective in" value={num(inputs.effectiveInMo, 0)}
        min={0} max={11} step={1}
        onChange={(v) => onChange("effectiveInMo", v)}
        format={(v) => v === 0 ? "Immediately" : `${v} month${v !== 1 ? "s" : ""}`}
      />
    </div>
  );
}

function InputsPayoff({ inputs, onChange, snap }: InputsProps & { snap: FinancialSnapshot }) {
  const lumpSum       = num(inputs.lumpSum, 5000);
  const debtBal       = Math.max(snap.totalDebt, 0);
  const lumpSafeLimit = snap.liquidAssets - snap.emergencyFundTarget;
  return (
    <div className="space-y-4">
      <div className="rounded-xl bg-red-50 px-4 py-3 flex items-center justify-between">
        <div>
          <p className="text-xs font-medium text-red-400">Current total debt</p>
          <p className="text-base font-bold text-red-700">{fmt(debtBal)}</p>
        </div>
        <div className="text-right">
          <p className="text-xs text-gray-400">Safe to deploy</p>
          <p className="text-sm font-semibold text-gray-700">{lumpSafeLimit > 0 ? fmt(lumpSafeLimit) : "—"}</p>
        </div>
      </div>
      <SliderRow
        label="Lump sum payment" value={lumpSum}
        min={0} max={Math.max(debtBal, 20000)} step={500}
        onChange={(v) => onChange("lumpSum", v)} format={fmt}
      />
      <SliderRow
        label="Debt APR" value={num(inputs.apr, 8)}
        min={3} max={25} step={0.5}
        onChange={(v) => onChange("apr", v)} format={(v) => `${v}%`}
      />
    </div>
  );
}

function TemplateInputs({
  templateId, inputs, onChange, snap,
}: {
  templateId: TemplateId;
  inputs: Record<string, number | string | boolean>;
  onChange: (k: string, v: number | string | boolean) => void;
  snap: FinancialSnapshot;
}) {
  switch (templateId) {
    case "purchase": return <InputsPurchase inputs={inputs} onChange={onChange} />;
    case "buyrent":  return <InputsBuyRent  inputs={inputs} onChange={onChange} />;
    case "car":      return <InputsCar      inputs={inputs} onChange={onChange} />;
    case "levers":   return <InputsLevers   inputs={inputs} onChange={onChange} />;
    case "salary":   return <InputsSalary   inputs={inputs} onChange={onChange} snap={snap} />;
    case "payoff":   return <InputsPayoff   inputs={inputs} onChange={onChange} snap={snap} />;
  }
}

// ── Projected Impact (compact, in editor) ─────────────────────────────────────

function ProjectedImpact({
  templateId, inputs, snap,
}: {
  templateId: TemplateId;
  inputs: Record<string, number | string | boolean>;
  snap: FinancialSnapshot;
}) {
  const metrics = getCompactMetrics(templateId, inputs, snap);
  if (metrics.length === 0) return null;
  return (
    <div className="rounded-xl border border-gray-100 bg-gray-50 p-4">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-3">Projected impact</p>
      <div className="space-y-2">
        {metrics.map((m) => (
          <div key={m.label} className="flex items-center justify-between">
            <span className="text-sm text-gray-600">{m.label}</span>
            <span className={`text-sm font-semibold ${
              m.positive === true  ? "text-emerald-600" :
              m.positive === false ? "text-red-500" :
              "text-gray-700"
            }`}>{m.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Combined Impact Card ──────────────────────────────────────────────────────

function CombinedImpactCard({
  snap, combined, enabledCount,
}: {
  snap: FinancialSnapshot;
  combined: ReturnType<typeof computeCombinedImpact>;
  enabledCount: number;
}) {
  if (enabledCount === 0) return null;

  const baseNW12   = snap.netWorth + snap.monthlySavings * 12;
  const newNW12    = combined.newNetWorth12;
  const nwDelta    = newNW12 - baseNW12;

  // Emergency fund months: how many months of savings to reach target
  const efTarget = snap.emergencyFundTarget;
  const baseEFMo = snap.monthlySavings > 0
    ? Math.max(0, Math.ceil((efTarget - snap.liquidAssets) / snap.monthlySavings))
    : 0;
  const newEFMo  = combined.newMonthlySavings > 0
    ? Math.max(0, Math.ceil((efTarget - snap.liquidAssets) / combined.newMonthlySavings))
    : 0;

  const tiles = [
    {
      label:    "Monthly cash flow",
      baseline: `baseline ${fmt(snap.monthlySavings)}`,
      hero:     fmt(combined.newMonthlySavings),
      delta:    `${combined.newMonthlySavings - snap.monthlySavings >= 0 ? "+" : ""}${fmt(combined.newMonthlySavings - snap.monthlySavings)}/mo with active scenarios`,
      negative: combined.newMonthlySavings < snap.monthlySavings,
    },
    {
      label:    "Savings rate",
      baseline: `baseline ${snap.savingsRate.toFixed(0)}%`,
      hero:     `${Math.max(0, combined.newSavingsRate).toFixed(0)}%`,
      delta:    `${combined.savingsRateDelta >= 0 ? "+" : ""}${combined.savingsRateDelta.toFixed(0)} pts`,
      negative: combined.savingsRateDelta < 0,
    },
    {
      label:    "Emergency fund target",
      baseline: `baseline ${baseEFMo} mo`,
      hero:     `${newEFMo} mo`,
      delta:    "at current pace",
      negative: newEFMo > baseEFMo,
    },
    {
      label:    "Net worth in 12 mo",
      baseline: `baseline ${baseNW12 >= 0 ? "+" : ""}${fmt(Math.round(baseNW12 - snap.netWorth))}`,
      hero:     `${newNW12 - snap.netWorth >= 0 ? "+" : ""}${fmt(Math.round(newNW12 - snap.netWorth))}`,
      delta:    `${nwDelta >= 0 ? "+" : ""}${fmt(Math.round(nwDelta))} vs baseline`,
      negative: nwDelta < 0,
    },
  ];

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm mb-6">
      <div className="flex items-center gap-3 mb-4">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-gray-400">Combined impact</p>
        <span className="rounded-full bg-purple-100 px-2.5 py-0.5 text-[11px] font-bold text-purple-700">
          {enabledCount} active
        </span>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {tiles.map((tile) => (
          <div key={tile.label} className="rounded-xl border border-gray-100 bg-gray-50 p-3">
            <p className="text-[11px] font-medium text-gray-400 mb-1">{tile.label}</p>
            <p className="text-[11px] text-gray-400">{tile.baseline}</p>
            <p className={`text-xl font-bold leading-tight mt-0.5 ${tile.negative ? "text-red-600" : "text-gray-900"}`}>
              {tile.hero}
            </p>
            <p className={`text-[11px] mt-0.5 font-medium ${tile.negative ? "text-red-500" : "text-emerald-600"}`}>
              {tile.delta}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Scenario card (left column) ───────────────────────────────────────────────

function ScenarioCard({
  scenario, snap, isActive, onToggle, onDelete, onEdit, onViewFullAnalysis,
}: {
  scenario: WhatIfScenario;
  snap: FinancialSnapshot;
  isActive: boolean;
  onToggle: () => void;
  onDelete: () => void;
  onEdit: () => void;
  onViewFullAnalysis: () => void;
}) {
  const tmpl      = getTemplate(scenario.templateId);
  const impact    = tmpl ? tmpl.impact(scenario.inputs, snap) : null;
  const colorDef  = SCENARIO_COLORS.find((c) => c.id === scenario.color) ?? SCENARIO_COLORS[0];
  const description = getScenarioDescription(scenario.templateId, scenario.inputs, snap);

  const netMonthly = impact
    ? impact.monthlyIncomeDelta - impact.monthlyExpenseDelta
    : 0;
  const newSavRate = (snap.monthlyIncome + (impact?.monthlyIncomeDelta ?? 0)) > 0
    ? ((snap.monthlySavings + netMonthly) / (snap.monthlyIncome + (impact?.monthlyIncomeDelta ?? 0))) * 100
    : 0;
  const savRateDelta = newSavRate - snap.savingsRate;

  return (
    <div
      className={`group cursor-pointer rounded-xl border p-4 transition ${
        isActive
          ? "border-purple-300 bg-purple-50 shadow-sm"
          : "border-gray-200 bg-white hover:border-gray-300 hover:shadow-sm"
      }`}
      onClick={onViewFullAnalysis}
    >
      {/* Top row */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`h-2 w-2 shrink-0 rounded-full ${colorDef.dot} ${!scenario.enabled ? "opacity-30" : ""}`} />
          <span className="text-sm font-bold text-gray-900 truncate">{scenario.name}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${colorDef.bg} ${colorDef.text}`}>
            {tmpl?.label ?? scenario.templateId}
          </span>
          {impact && (
            <span className={`text-xs font-bold ${netMonthly >= 0 ? "text-emerald-600" : "text-red-500"}`}>
              {netMonthly >= 0 ? "+" : ""}{fmt(netMonthly)}/mo
            </span>
          )}
        </div>
      </div>

      {/* Description */}
      {description && (
        <p className="text-xs text-gray-500 leading-relaxed mb-3 line-clamp-2">{description}</p>
      )}

      {/* Metrics row + Stack toggle */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-3 text-[11px] text-gray-500">
          {impact && (
            <span>
              Savings rate{" "}
              <span className={`font-semibold ${savRateDelta >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                {savRateDelta >= 0 ? "+" : ""}{savRateDelta.toFixed(0)}%
              </span>
            </span>
          )}
          {impact?.oneTimeCost ? (
            <span>
              Down payment{" "}
              <span className="font-semibold text-gray-700">{fmt(impact.oneTimeCost)}</span>
            </span>
          ) : impact && (
            <span>
              Duration{" "}
              <span className="font-semibold text-gray-700">
                {scenario.templateId === "purchase" ? `${num(scenario.inputs.months, 24)} mo` : "ongoing"}
              </span>
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-gray-400">Stack</span>
          <button
            onClick={(e) => { e.stopPropagation(); onToggle(); }}
            className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
              scenario.enabled ? "bg-purple-600" : "bg-gray-200"
            }`}
            title={scenario.enabled ? "Remove from combined" : "Add to combined"}
          >
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform ${
              scenario.enabled ? "translate-x-4" : "translate-x-0"
            }`} />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            className="rounded p-1 text-gray-300 hover:text-red-400 transition opacity-0 group-hover:opacity-100"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-2 mt-3 pt-3 border-t border-gray-100" onClick={(e) => e.stopPropagation()}>
        <button
          onClick={onViewFullAnalysis}
          className="flex-1 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 hover:border-purple-300 hover:text-purple-700 transition text-left"
        >
          View full analysis →
        </button>
        <button
          onClick={onEdit}
          className="rounded-lg px-3 py-1.5 text-xs font-medium text-gray-400 hover:text-gray-700 transition"
        >
          Edit
        </button>
      </div>
    </div>
  );
}

// ── Template switcher pills ───────────────────────────────────────────────────

const TEMPLATE_LABEL_SHORT: Record<TemplateId, string> = {
  purchase: "New purchase",
  payoff:   "Pay off debt",
  salary:   "Salary change",
  buyrent:  "Buy vs rent",
  car:      "New car",
  levers:   "Savings levers",
};

function TemplateSwitcher({
  activeId, isPro, onSelect,
}: {
  activeId: TemplateId;
  isPro: boolean;
  onSelect: (id: TemplateId) => void;
}) {
  const order: TemplateId[] = ["purchase", "payoff", "salary", "buyrent", "car", "levers"];
  return (
    <div>
      <p className="text-sm font-medium text-gray-700 mb-2">Template</p>
      <div className="grid grid-cols-2 gap-2">
        {order.map((id) => {
          const locked  = !isPro && !TEMPLATES.find((t) => t.id === id)?.free;
          const isActive = id === activeId;
          return (
            <button
              key={id}
              onClick={() => onSelect(id)}
              className={`relative rounded-lg px-3 py-2 text-sm font-medium text-left transition ${
                isActive
                  ? "border border-purple-400 bg-purple-50 text-purple-700"
                  : locked
                  ? "border border-gray-100 bg-gray-50 text-gray-400 cursor-default"
                  : "border border-gray-200 bg-white text-gray-700 hover:border-gray-300"
              }`}
            >
              {TEMPLATE_LABEL_SHORT[id]}
              {locked && !isActive && (
                <span className="absolute top-1.5 right-1.5 rounded-full bg-amber-100 px-1 py-0.5 text-[9px] font-bold text-amber-600">Pro</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Editor panel (right column) ───────────────────────────────────────────────

function EditorPanel({
  panel, snap, isPro, saving, hasUnsaved,
  onInputChange, onNameChange, onTemplateChange, onSave, onDelete, onClose, onViewFullAnalysis,
}: {
  panel: Exclude<PanelState, { mode: "empty" } | { mode: "fullAnalysis" }>;
  snap: FinancialSnapshot;
  isPro: boolean;
  saving: boolean;
  hasUnsaved: boolean;
  onInputChange: (k: string, v: number | string | boolean) => void;
  onNameChange: (name: string) => void;
  onTemplateChange: (id: TemplateId) => void;
  onSave: () => void;
  onDelete?: () => void;
  onClose: () => void;
  onViewFullAnalysis?: () => void;
}) {
  const templateId = panel.templateId;
  const aiQuestion = getAiQuestion(templateId);
  const isNew      = panel.mode === "new";

  // Key changes whenever the user switches between scenarios so the slide-in
  // animation re-triggers on each new edit session.
  const animKey = panel.mode === "edit" ? panel.scenario.id : "new";

  return (
    <>
      {/* Keyframe for the slide-in entrance */}
      <style>{`
        @keyframes editorSlideIn {
          from { opacity: 0; transform: translateY(12px) scale(0.98); }
          to   { opacity: 1; transform: translateY(0)    scale(1);    }
        }
        .editor-slide-in { animation: editorSlideIn 0.22s ease-out; }
      `}</style>

      <div
        key={animKey}
        className="editor-slide-in rounded-2xl border border-gray-200 bg-white shadow-xl overflow-hidden"
      >
        {/* ── Dark header ── */}
        <div className="bg-gradient-to-r from-gray-800 to-gray-900 px-5 py-4">
          <div className="flex items-center justify-between">
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 mb-0.5">
                {isNew ? "New scenario" : "Editing scenario"}
              </p>
              <h3 className="text-base font-bold text-white leading-tight truncate">
                {panel.name || (isNew ? "Untitled" : "Scenario")}
              </h3>
            </div>
            <div className="flex items-center gap-2 shrink-0 ml-3">
              {!isNew && onDelete && (
                <button
                  onClick={onDelete}
                  className="rounded-lg px-2.5 py-1 text-[11px] font-semibold text-gray-300 hover:bg-gray-700 hover:text-white transition"
                >
                  Delete
                </button>
              )}
              <button
                onClick={onClose}
                className="flex h-7 w-7 items-center justify-center rounded-full text-gray-400 hover:bg-gray-700 hover:text-white transition"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
          {/* Edit / Full analysis tabs — only shown when editing an existing scenario */}
          {!isNew && onViewFullAnalysis && (
            <div className="flex items-center gap-1 mt-3">
              <button className="rounded-lg px-3 py-1.5 text-[11px] font-semibold text-white bg-white/20 border border-white/30 cursor-default">
                Edit
              </button>
              <button
                onClick={onViewFullAnalysis}
                className="rounded-lg px-3 py-1.5 text-[11px] font-semibold text-gray-300 hover:bg-gray-700 hover:text-white transition"
              >
                Full analysis
              </button>
            </div>
          )}
        </div>

        <div className="p-5 space-y-5">
          {/* Scenario name */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Scenario name</label>
            <input
              type="text"
              value={panel.name}
              onChange={(e) => onNameChange(e.target.value)}
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-purple-400 focus:ring-1 focus:ring-purple-200"
            />
          </div>

          {/* Template switcher */}
          <TemplateSwitcher activeId={templateId} isPro={isPro} onSelect={onTemplateChange} />

          {/* Template inputs */}
          <TemplateInputs templateId={templateId} inputs={panel.inputs} onChange={onInputChange} snap={snap} />

          {/* Projected impact */}
          <ProjectedImpact templateId={templateId} inputs={panel.inputs} snap={snap} />

          {/* Save button */}
          <button
            onClick={onSave}
            disabled={saving}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-purple-600 px-5 py-3 text-sm font-bold text-white hover:bg-purple-700 transition disabled:opacity-50 shadow-md"
          >
            {saving ? (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
            ) : null}
            {isNew ? "Save scenario" : (hasUnsaved ? "Save changes" : "Saved")}
          </button>

          {/* View full analysis — only for existing scenarios */}
          {!isNew && onViewFullAnalysis && (
            <button
              onClick={onViewFullAnalysis}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-5 py-3 text-sm font-medium text-gray-600 hover:border-purple-300 hover:text-purple-700 transition"
            >
              View full analysis with opportunity cost →
            </button>
          )}

          {/* Ask AI */}
          <div className="rounded-xl border border-purple-100 bg-purple-50/60 p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-purple-400 mb-2">Ask AI about this scenario</p>
            <button
              className="flex w-full items-center gap-2 rounded-lg border border-purple-200 bg-white px-3 py-2 text-xs text-purple-700 hover:bg-purple-50 transition text-left"
              title="AI analysis — coming soon"
            >
              <svg className="h-3.5 w-3.5 shrink-0 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
              </svg>
              Ask AI: {aiQuestion} ↗
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

// ── Sparkline ─────────────────────────────────────────────────────────────────

function Sparkline({ snap, combined }: {
  snap: FinancialSnapshot;
  combined: ReturnType<typeof computeCombinedImpact>;
}) {
  const W = 440, H = 100;
  const padL = 56, padR = 10, padT = 8, padB = 24;

  const data    = buildSparklineData(snap, combined);
  const allVals = data.flatMap((d) => [d.baseline, d.scenario]);
  const minY    = Math.min(...allVals);
  const maxY    = Math.max(...allVals);
  const range   = maxY - minY || 1;

  const toX = (i: number) => padL + (i / 12) * (W - padL - padR);
  const toY = (v: number) => padT + (1 - (v - minY) / range) * (H - padT - padB);

  const basePath = data.map((d, i) => `${i === 0 ? "M" : "L"} ${toX(i).toFixed(1)} ${toY(d.baseline).toFixed(1)}`).join(" ");
  const scenPath = data.map((d, i) => `${i === 0 ? "M" : "L"} ${toX(i).toFixed(1)} ${toY(d.scenario).toFixed(1)}`).join(" ");

  const ticks = [minY, (minY + maxY) / 2, maxY].map((v) => ({
    v, label: Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(0)}k` : v.toFixed(0),
  }));

  return (
    <div className="rounded-xl border border-gray-100 bg-white p-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-gray-400">12-month net worth projection</p>
        <div className="flex items-center gap-3 text-[11px] text-gray-400">
          <span className="flex items-center gap-1.5"><span className="inline-block h-1.5 w-5 rounded-full bg-emerald-400" /> Baseline</span>
          <span className="flex items-center gap-1.5"><span className="inline-block h-1.5 w-5 rounded-full bg-purple-500" /> With scenarios</span>
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: H }}>
        {ticks.map(({ v, label }, i) => (
          <g key={i}>
            <line x1={padL} y1={toY(v)} x2={W - padR} y2={toY(v)} stroke="#f3f4f6" strokeWidth={1} />
            <text x={padL - 4} y={toY(v) + 3.5} textAnchor="end" fontSize={8} fill="#9ca3af">{label}</text>
          </g>
        ))}
        <path d={basePath} fill="none" stroke="#34d399" strokeWidth={2} strokeLinecap="round" />
        {combined.hasImpact && (
          <path d={scenPath} fill="none" stroke="#7c3aed" strokeWidth={2} strokeLinecap="round" strokeDasharray="5 2" />
        )}
        {[0, 3, 6, 9, 12].map((i) => (
          <text key={i} x={toX(i)} y={H - 5} textAnchor="middle" fontSize={8} fill="#9ca3af">
            {i === 0 ? "Now" : `+${i}mo`}
          </text>
        ))}
      </svg>
    </div>
  );
}

// ── Full Analysis — Purchase template ─────────────────────────────────────────

function FullAnalysisPurchase({
  inputs, snap,
}: {
  inputs: Record<string, number | string | boolean>;
  snap: FinancialSnapshot;
}) {
  const [returnRate, setReturnRate] = useState(7);
  const [horizonYr,  setHorizonYr]  = useState(5);

  const isOneTime     = bool(inputs.isOneTime ?? false);
  const cost          = num(inputs.cost, 55);
  const months        = Math.max(1, num(inputs.months, 24));
  const monthlyCost   = isOneTime ? cost / months : cost;
  const contractTotal = isOneTime ? cost : cost * months;
  const annualCost    = monthlyCost * 12;

  const horizonMonths = horizonYr * 12;
  const r             = returnRate / 100 / 12;
  const fvMonthly     = r > 0 ? monthlyCost * (Math.pow(1 + r, horizonMonths) - 1) / r : monthlyCost * horizonMonths;
  const paidOut       = monthlyCost * horizonMonths;
  const foregone      = Math.max(0, fvMonthly - paidOut);
  const trueCostWithOpp = contractTotal + foregone;

  const pctOfIncome  = snap.monthlyIncome  > 0 ? (monthlyCost / snap.monthlyIncome)  * 100 : 0;
  const pctOfSurplus = snap.monthlySavings > 0 ? (monthlyCost / snap.monthlySavings) * 100 : 0;

  const riskLevel = pctOfSurplus < 5 ? "low" : pctOfSurplus < 20 ? "moderate" : "high";
  const riskColor = riskLevel === "low" ? "bg-emerald-500" : riskLevel === "moderate" ? "bg-amber-500" : "bg-red-500";
  const fv10yr    = r > 0 ? monthlyCost * (Math.pow(1 + r, 120) - 1) / r : monthlyCost * 120;
  const maxBar    = Math.max(paidOut, fvMonthly, 1);

  const insights: { color: string; text: React.ReactNode }[] = [
    {
      color: riskColor,
      text: (
        <>
          <strong>{riskLevel === "low" ? "Low risk" : riskLevel === "moderate" ? "Moderate impact" : "High impact"} at your savings rate.</strong>
          {" "}{fmt(Math.round(monthlyCost))}/mo is {pctOfSurplus.toFixed(1)}% of your monthly surplus —
          {riskLevel === "low" ? " well within discretionary range." :
           riskLevel === "moderate" ? " monitor the effect on your other goals." :
           " consider a cheaper alternative or delaying the purchase."}
        </>
      ),
    },
    {
      color: "bg-amber-400",
      text: (
        <>
          <strong>The 10-year habit cost</strong> is {fmt(Math.round(fv10yr))} in opportunity cost at {returnRate}%.
          {" "}If this is a recurring upgrade cycle, the compounding effect is the real decision.
        </>
      ),
    },
  ];

  if (pctOfIncome < 2) {
    insights.push({
      color: "bg-blue-400",
      text: <>At {pctOfIncome.toFixed(2)}% of income, this purchase won&apos;t meaningfully shift your financial picture. Focus on bigger levers if optimizing.</>,
    });
  }

  return (
    <div className="space-y-6">
      {/* True Cost Anatomy */}
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-widest text-gray-400 mb-3">True cost anatomy</p>
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl border border-gray-100 bg-gray-50 p-3.5">
            <p className="text-xs text-gray-400 mb-1">Monthly</p>
            <p className="text-xl font-bold text-gray-900">{fmt(Math.round(monthlyCost))}</p>
            <p className="text-[11px] text-gray-400 mt-0.5">{pctOfIncome.toFixed(2)}% of income</p>
          </div>
          <div className="rounded-xl border border-gray-100 bg-gray-50 p-3.5">
            <p className="text-xs text-gray-400 mb-1">Annual</p>
            <p className="text-xl font-bold text-gray-900">{fmt(Math.round(annualCost))}</p>
            <p className="text-[11px] text-gray-400 mt-0.5">12 × {fmt(Math.round(monthlyCost))}</p>
          </div>
          <div className="rounded-xl border border-gray-100 bg-gray-50 p-3.5">
            <p className="text-xs text-gray-400 mb-1">Contract total</p>
            <p className="text-xl font-bold text-gray-900">{fmt(contractTotal)}</p>
            <p className="text-[11px] text-gray-400 mt-0.5">{months} × {fmt(Math.round(monthlyCost))}</p>
          </div>
          <div className="rounded-xl border border-purple-100 bg-purple-50 p-3.5">
            <p className="text-xs text-purple-500 mb-1">True cost incl. opp.</p>
            <p className="text-xl font-bold text-purple-700">{fmt(Math.round(trueCostWithOpp))}</p>
            <p className="text-[11px] text-purple-400 mt-0.5">at {returnRate}% over {horizonYr}yr</p>
          </div>
        </div>
      </div>

      {/* Opportunity Cost Engine */}
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-widest text-gray-400 mb-3">Opportunity cost engine</p>
        <div className="rounded-xl border border-gray-100 bg-gray-50 p-4 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <SliderRow label="Return rate" value={returnRate} min={2} max={15} step={0.5} onChange={setReturnRate} format={(v) => `${v}%`} />
            <SliderRow label="Horizon"     value={horizonYr}  min={1} max={20} step={1}   onChange={setHorizonYr}  format={(v) => `${v} yr`} />
          </div>
          <p className="text-sm text-gray-600 leading-relaxed">
            If invested at{" "}
            <span className="font-semibold text-gray-900">{returnRate}%</span> over{" "}
            <span className="font-semibold text-gray-900">{horizonYr} years</span>,{" "}
            {fmt(Math.round(monthlyCost))}/mo grows to{" "}
            <span className="font-semibold text-emerald-600">{fmt(Math.round(fvMonthly))}</span>.
            {" "}You pay {fmt(Math.round(paidOut))} — foregone returns:{" "}
            <span className="font-semibold text-amber-600">{fmt(Math.round(foregone))}</span>.
          </p>
          <div className="space-y-2">
            {[
              { label: "Paid out",    value: paidOut,   color: "bg-red-400"   },
              { label: "If invested", value: fvMonthly, color: "bg-blue-400"  },
              { label: "Foregone",    value: foregone,  color: "bg-amber-400" },
            ].map((bar) => (
              <div key={bar.label} className="flex items-center gap-3">
                <span className="w-20 shrink-0 text-xs text-gray-500">{bar.label}</span>
                <div className="flex-1 h-3 rounded-full bg-gray-200 overflow-hidden">
                  <div className={`h-full rounded-full transition-all duration-300 ${bar.color}`} style={{ width: `${(bar.value / maxBar) * 100}%` }} />
                </div>
                <span className="w-20 shrink-0 text-right text-xs font-semibold text-gray-700">{fmt(Math.round(bar.value))}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Key Insights */}
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-widest text-gray-400 mb-3">Key insights</p>
        <div className="space-y-3">
          {insights.map((insight, i) => (
            <div key={i} className="flex items-start gap-3">
              <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${insight.color}`} />
              <p className="text-sm text-gray-600 leading-relaxed">{insight.text}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Full Analysis — Generic (all other templates) ─────────────────────────────

function FullAnalysisGeneric({
  scenario, inputs, snap,
}: {
  scenario: WhatIfScenario;
  inputs: Record<string, number | string | boolean>;
  snap: FinancialSnapshot;
}) {
  const tmpl       = getTemplate(scenario.templateId);
  const impact     = tmpl ? tmpl.impact(inputs, snap) : null;
  const metrics    = tmpl ? getCompactMetrics(scenario.templateId, inputs, snap) : [];
  const netMonthly = impact ? impact.monthlyIncomeDelta - impact.monthlyExpenseDelta : 0;
  const newIncome  = snap.monthlyIncome + (impact?.monthlyIncomeDelta ?? 0);
  const newSavings = snap.monthlySavings + netMonthly;
  const newSavRate = newIncome > 0 ? (newSavings / newIncome) * 100 : 0;

  return (
    <div className="space-y-6">
      {/* Overview tiles */}
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-widest text-gray-400 mb-3">Scenario impact</p>
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl border border-gray-100 bg-gray-50 p-3.5">
            <p className="text-xs text-gray-400 mb-1">Monthly cash flow</p>
            <p className={`text-xl font-bold ${netMonthly >= 0 ? "text-emerald-600" : "text-red-600"}`}>
              {netMonthly >= 0 ? "+" : ""}{fmt(netMonthly)}/mo
            </p>
            <p className="text-[11px] text-gray-400 mt-0.5">vs baseline {fmt(snap.monthlySavings)}/mo</p>
          </div>
          <div className="rounded-xl border border-gray-100 bg-gray-50 p-3.5">
            <p className="text-xs text-gray-400 mb-1">Savings rate</p>
            <p className={`text-xl font-bold ${newSavRate >= snap.savingsRate ? "text-emerald-600" : "text-red-600"}`}>
              {Math.max(0, newSavRate).toFixed(0)}%
            </p>
            <p className="text-[11px] text-gray-400 mt-0.5">vs baseline {snap.savingsRate.toFixed(0)}%</p>
          </div>
          <div className="rounded-xl border border-gray-100 bg-gray-50 p-3.5">
            <p className="text-xs text-gray-400 mb-1">12-mo net worth</p>
            <p className={`text-xl font-bold ${newSavings * 12 >= 0 ? "text-emerald-600" : "text-red-600"}`}>
              {newSavings >= 0 ? "+" : ""}{fmt(Math.round(newSavings * 12))}
            </p>
            <p className="text-[11px] text-gray-400 mt-0.5">projected change</p>
          </div>
          {impact?.oneTimeCost ? (
            <div className="rounded-xl border border-amber-100 bg-amber-50 p-3.5">
              <p className="text-xs text-amber-500 mb-1">One-time cost</p>
              <p className="text-xl font-bold text-amber-700">{fmt(impact.oneTimeCost)}</p>
              <p className="text-[11px] text-amber-400 mt-0.5">upfront payment</p>
            </div>
          ) : (
            <div className="rounded-xl border border-gray-100 bg-gray-50 p-3.5">
              <p className="text-xs text-gray-400 mb-1">Annualized impact</p>
              <p className={`text-xl font-bold ${netMonthly * 12 >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                {netMonthly >= 0 ? "+" : ""}{fmt(Math.round(netMonthly * 12))}/yr
              </p>
              <p className="text-[11px] text-gray-400 mt-0.5">vs baseline</p>
            </div>
          )}
        </div>
      </div>

      {/* Detailed metrics */}
      {metrics.length > 0 && (
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-widest text-gray-400 mb-3">Breakdown</p>
          <div className="rounded-xl border border-gray-100 bg-gray-50 p-4 space-y-3">
            {metrics.map((m) => (
              <div key={m.label} className="flex items-center justify-between">
                <span className="text-sm text-gray-600">{m.label}</span>
                <span className={`text-sm font-semibold ${
                  m.positive === true  ? "text-emerald-600" :
                  m.positive === false ? "text-red-500" :
                  "text-gray-700"
                }`}>{m.value}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {impact?.summaryLine && (
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-widest text-gray-400 mb-3">Key insight</p>
          <div className="rounded-xl border border-blue-100 bg-blue-50/60 p-4">
            <p className="text-sm text-blue-700 leading-relaxed">{impact.summaryLine}</p>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Full Analysis Panel (wrapper with header) ─────────────────────────────────

function FullAnalysisPanel({
  panel, snap, onSwitchToEdit, onClose, onDelete,
}: {
  panel: { scenario: WhatIfScenario; inputs: Record<string, number | string | boolean>; name: string; templateId: TemplateId };
  snap: FinancialSnapshot;
  onSwitchToEdit: () => void;
  onClose: () => void;
  onDelete: () => void;
}) {
  const tmpl         = getTemplate(panel.templateId);
  const aiQuestion   = getAiQuestion(panel.templateId);
  const description  = getScenarioDescription(panel.templateId, panel.inputs, snap);

  return (
    <>
      <style>{`
        @keyframes faSlideIn {
          from { opacity: 0; transform: translateY(12px) scale(0.98); }
          to   { opacity: 1; transform: translateY(0)    scale(1);    }
        }
        .fa-slide-in { animation: faSlideIn 0.22s ease-out; }
      `}</style>

      <div key={panel.scenario.id + "-fa"} className="fa-slide-in rounded-2xl border border-purple-200 bg-white shadow-xl ring-1 ring-purple-100 overflow-hidden">
        {/* Purple header */}
        <div className="bg-gradient-to-r from-purple-600 to-purple-700 px-5 py-4">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              {/* Breadcrumb */}
              <div className="flex items-center gap-1.5 mb-1.5">
                <button onClick={onClose} className="text-[11px] text-purple-300 hover:text-white transition flex items-center gap-1">
                  <svg className="h-2.5 w-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
                  </svg>
                  Scenarios
                </button>
                <span className="text-purple-400 text-[11px]">/</span>
                <span className="text-[11px] text-purple-200 truncate max-w-[140px]">{panel.name}</span>
              </div>
              <h3 className="text-base font-bold text-white leading-tight truncate">{panel.name}</h3>
              <p className="text-[11px] text-purple-300 mt-0.5 truncate">
                {tmpl?.label} · {description}
              </p>
            </div>
            <div className="flex items-center gap-1.5 shrink-0 ml-2 flex-wrap justify-end">
              <button
                onClick={onSwitchToEdit}
                className="rounded-lg px-3 py-1.5 text-[11px] font-semibold text-purple-200 border border-purple-400 hover:bg-purple-500 hover:text-white transition"
              >
                Edit
              </button>
              <button className="rounded-lg px-3 py-1.5 text-[11px] font-semibold text-white bg-white/20 border border-white/30 cursor-default">
                Full analysis
              </button>
              <button
                onClick={onClose}
                className="flex h-7 w-7 items-center justify-center rounded-full text-purple-200 hover:bg-purple-500 hover:text-white transition"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
        </div>

        {/* Scrollable content */}
        <div className="p-5 max-h-[80vh] overflow-y-auto space-y-2">
          {panel.templateId === "purchase" ? (
            <FullAnalysisPurchase inputs={panel.inputs} snap={snap} />
          ) : (
            <FullAnalysisGeneric scenario={panel.scenario} inputs={panel.inputs} snap={snap} />
          )}

          {/* Delete */}
          <div className="pt-2 border-t border-gray-100">
            <button onClick={onDelete} className="text-xs text-red-400 hover:text-red-600 transition">
              Delete this scenario
            </button>
          </div>

          {/* Ask AI */}
          <button className="flex w-full items-center gap-2 rounded-xl border border-purple-100 bg-purple-50/60 px-4 py-3 text-sm text-purple-700 hover:bg-purple-100 transition text-left">
            <svg className="h-4 w-4 shrink-0 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 003.09 3.09z" />
            </svg>
            Ask AI: {aiQuestion} ↗
          </button>
        </div>
      </div>
    </>
  );
}

// ── API helper ────────────────────────────────────────────────────────────────

async function apiFetch(path: string, token: string, options?: RequestInit) {
  return fetch(path, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(options?.headers ?? {}) },
  });
}

// ── Main workspace ────────────────────────────────────────────────────────────

function WhatIfWorkspace() {
  const { can, setTestPlan } = usePlan();
  const isPro = can("whatIf");

  const [snap,      setSnap]      = useState<FinancialSnapshot | null>(null);
  const [scenarios, setScenarios] = useState<WhatIfScenario[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [saving,    setSaving]    = useState(false);
  const [panel,     setPanel]     = useState<PanelState>({ mode: "empty" });

  const tokenRef = useRef<string>("");

  // ── Load data ──

  useEffect(() => {
    const { auth } = getFirebaseClient();
    return onAuthStateChanged(auth, async (user) => {
      if (!user) { setLoading(false); return; }
      try {
        const token = await user.getIdToken();
        tokenRef.current = token;

        const [consRes, scenRes] = await Promise.all([
          apiFetch("/api/user/statements/consolidated", token),
          apiFetch("/api/user/whatif-scenarios", token),
        ]);

        if (consRes.ok) {
          const json            = await consRes.json();
          const d               = json.data ?? {};
          const monthlyIncome   = json.typicalMonthlyIncome  ?? json.txMonthlyIncome   ?? d.income?.total   ?? 0;
          const monthlyExpenses = json.typicalMonthlyExpenses ?? json.txMonthlyExpenses ?? d.expenses?.total ?? 0;
          const assets          = d.assets  ?? Math.max(0, d.netWorth ?? 0);
          const debts           = d.debts   ?? 0;
          const monthlySavings  = monthlyIncome - monthlyExpenses;
          const savingsRate     = monthlyIncome > 0 ? (monthlySavings / monthlyIncome) * 100 : 0;
          const liquidAssets    = json.liquidAssets ?? assets * 0.3;
          setSnap({
            netWorth: assets - debts, monthlyIncome, monthlyExpenses, monthlySavings,
            savingsRate, totalDebt: debts,
            liquidAssets, emergencyFundTarget: monthlyExpenses * 6,
          });
        } else {
          setSnap({ netWorth: 47210, monthlyIncome: 5800, monthlyExpenses: 4700,
            monthlySavings: 1100, savingsRate: 19, totalDebt: 4800,
            liquidAssets: 8000, emergencyFundTarget: 28200 });
        }

        if (scenRes.ok) {
          const json = await scenRes.json();
          const loaded: WhatIfScenario[] = json.scenarios ?? [];
          setScenarios(loaded);
          // Auto-open first scenario in full analysis so the page doesn't feel empty
          if (loaded.length > 0) {
            const first = loaded[0];
            setPanel({ mode: "fullAnalysis", scenario: first, inputs: { ...first.inputs }, name: first.name, templateId: first.templateId });
          }
        }
      } catch {
        setSnap({ netWorth: 47210, monthlyIncome: 5800, monthlyExpenses: 4700,
          monthlySavings: 1100, savingsRate: 19, totalDebt: 4800,
          liquidAssets: 8000, emergencyFundTarget: 28200 });
      }
      setLoading(false);
    });
  }, []);

  const freshToken = useCallback(async () => {
    const { auth } = getFirebaseClient();
    if (auth.currentUser) {
      const t = await auth.currentUser.getIdToken();
      tokenRef.current = t;
      return t;
    }
    return tokenRef.current;
  }, []);

  // ── Panel actions ──

  function openNewScenario(templateId: TemplateId = "purchase") {
    if (!isPro && !TEMPLATES.find((t) => t.id === templateId)?.free) {
      setTestPlan("pro"); return;
    }
    const tmpl = getTemplate(templateId)!;
    const inputs = snap ? tmpl.defaultInputs(snap) : {};
    setPanel({
      mode: "new", templateId, inputs,
      name: snap ? tmpl.defaultName(inputs) : tmpl.label,
    });
  }

  function openScenario(scenario: WhatIfScenario) {
    setPanel({ mode: "edit", scenario, inputs: { ...scenario.inputs }, name: scenario.name, templateId: scenario.templateId });
  }

  function openFullAnalysis(scenario: WhatIfScenario) {
    setPanel({ mode: "fullAnalysis", scenario, inputs: { ...scenario.inputs }, name: scenario.name, templateId: scenario.templateId });
  }

  function closePanel() { setPanel({ mode: "empty" }); }

  const handleInputChange = useCallback((key: string, value: number | string | boolean) => {
    setPanel((prev) => {
      if (prev.mode === "empty") return prev;
      const newInputs = { ...prev.inputs, [key]: value };
      const tmpl      = getTemplate(prev.templateId);
      const autoName  = tmpl ? tmpl.defaultName(newInputs) : prev.name;
      return { ...prev, inputs: newInputs, name: key === "name" ? String(value) : autoName };
    });
  }, []);

  function handleNameChange(name: string) {
    setPanel((prev) => prev.mode === "empty" ? prev : { ...prev, name });
  }

  function handleTemplateChange(newTemplateId: TemplateId) {
    if (!isPro && !TEMPLATES.find((t) => t.id === newTemplateId)?.free) {
      setTestPlan("pro"); return;
    }
    const tmpl = getTemplate(newTemplateId)!;
    const inputs = snap ? tmpl.defaultInputs(snap) : {};
    setPanel((prev) => {
      if (prev.mode === "empty") return prev;
      return { ...prev, templateId: newTemplateId, inputs, name: snap ? tmpl.defaultName(inputs) : tmpl.label };
    });
  }

  // ── Save ──

  async function saveScenario() {
    if (panel.mode === "empty" || !snap) return;
    setSaving(true);
    try {
      const token = await freshToken();
      if (panel.mode === "new") {
        const res = await apiFetch("/api/user/whatif-scenarios", token, {
          method: "POST",
          body:   JSON.stringify({ name: panel.name, templateId: panel.templateId, inputs: panel.inputs }),
        });
        if (res.ok) {
          const json = await res.json();
          setScenarios((prev) => [...prev, json.scenario]);
          setPanel({ mode: "edit", scenario: json.scenario, inputs: { ...panel.inputs }, name: panel.name, templateId: panel.templateId });
        }
      } else {
        const id  = panel.scenario.id;
        const res = await apiFetch(`/api/user/whatif-scenarios/${id}`, token, {
          method: "PUT",
          body:   JSON.stringify({ name: panel.name, inputs: panel.inputs }),
        });
        if (res.ok) {
          const updated = { ...panel.scenario, name: panel.name, inputs: panel.inputs, updatedAt: new Date().toISOString() };
          setScenarios((prev) => prev.map((s) => s.id === id ? updated : s));
          setPanel((prev) => prev.mode === "edit" ? { ...prev, scenario: updated } : prev);
        }
      }
    } finally {
      setSaving(false);
    }
  }

  // ── Toggle + delete ──

  async function toggleScenario(id: string) {
    const s = scenarios.find((x) => x.id === id);
    if (!s) return;
    const newEnabled = !s.enabled;
    setScenarios((prev) => prev.map((x) => x.id === id ? { ...x, enabled: newEnabled } : x));
    const token = await freshToken();
    await apiFetch(`/api/user/whatif-scenarios/${id}`, token, { method: "PUT", body: JSON.stringify({ enabled: newEnabled }) });
  }

  async function deleteScenario(id: string) {
    setScenarios((prev) => prev.filter((x) => x.id !== id));
    if ((panel.mode === "edit" || panel.mode === "fullAnalysis") && panel.scenario.id === id) closePanel();
    const token = await freshToken();
    await apiFetch(`/api/user/whatif-scenarios/${id}`, token, { method: "DELETE" });
  }

  // ── Derived ──

  const combined      = snap ? computeCombinedImpact(scenarios, snap) : null;
  const enabledCount  = scenarios.filter((s) => s.enabled).length;
  const activeId      = (panel.mode === "edit" || panel.mode === "fullAnalysis") ? panel.scenario.id : null;

  const hasUnsaved = panel.mode === "new" || (
    panel.mode === "edit" && (
      panel.name !== panel.scenario.name ||
      JSON.stringify(panel.inputs) !== JSON.stringify(panel.scenario.inputs)
    )
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-purple-200 border-t-purple-600" />
      </div>
    );
  }
  if (!snap) return null;

  return (
    <div className="mx-auto max-w-5xl px-4 pt-4 pb-12 sm:px-6">
      {/* Page header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-bold text-gray-900">Scenarios</h1>
            <span className="rounded-full bg-purple-100 px-2.5 py-0.5 text-xs font-semibold text-purple-700">AI</span>
          </div>
          <p className="mt-1 text-sm text-gray-400">
            Build scenarios · stack them · see combined impact against your real numbers
          </p>
        </div>
        <button
          onClick={() => openNewScenario("purchase")}
          className="shrink-0 flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 hover:border-purple-300 hover:text-purple-700 hover:bg-purple-50 shadow-sm transition"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          New scenario
        </button>
      </div>

      {/* Combined impact card */}
      {combined && <CombinedImpactCard snap={snap} combined={combined} enabledCount={enabledCount} />}

      {/* Two-column body */}
      <div className={`flex flex-col gap-6 ${panel.mode !== "empty" ? "lg:grid lg:grid-cols-[1fr_420px]" : ""}`}>

        {/* ── Left: scenario list ──────────────────────────────────────── */}
        <div className="space-y-3">
          {scenarios.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-gray-200 px-6 py-12 text-center">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-purple-50">
                <svg className="h-6 w-6 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
                </svg>
              </div>
              <p className="text-sm font-semibold text-gray-700 mb-1">No scenarios yet</p>
              <p className="text-xs text-gray-400 max-w-xs mx-auto">Click <span className="font-medium text-gray-500">New scenario</span> above to model decisions — buy a car, get a raise, pay off debt — and see how they stack up.</p>
            </div>
          ) : (
            <>
              <p className="text-[11px] font-semibold uppercase tracking-widest text-gray-400 px-1">Saved scenarios</p>
              {scenarios.map((s) => (
                <ScenarioCard
                  key={s.id}
                  scenario={s}
                  snap={snap}
                  isActive={s.id === activeId}
                  onToggle={() => toggleScenario(s.id)}
                  onDelete={() => deleteScenario(s.id)}
                  onEdit={() => openScenario(s)}
                  onViewFullAnalysis={() => openFullAnalysis(s)}
                />
              ))}
            </>
          )}

          {/* Add scenario prompt */}
          <button
            onClick={() => openNewScenario("purchase")}
            className="flex w-full flex-col items-center gap-1 rounded-xl border border-dashed border-gray-200 px-4 py-5 text-center hover:border-purple-300 hover:bg-purple-50/50 transition"
          >
            <span className="text-sm font-semibold text-gray-600">+ Add scenario</span>
            <span className="text-xs text-gray-400">Model a new financial decision</span>
          </button>

          {/* Sparkline */}
          {combined && snap && (
            <Sparkline snap={snap} combined={combined} />
          )}
        </div>

        {/* ── Right: editor / full analysis ───────────────────────────── */}
        {panel.mode !== "empty" && (
          <div className="lg:sticky lg:top-4 lg:self-start">
            {panel.mode !== "fullAnalysis" && (
              <div className="flex items-center gap-2 px-1 mb-3">
                <span className="hidden lg:flex h-5 w-5 items-center justify-center rounded-full bg-gray-700 text-white">
                  <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
                  </svg>
                </span>
                <p className="text-[11px] font-bold uppercase tracking-widest text-gray-500">Your turn — configure this scenario</p>
              </div>
            )}
            {panel.mode === "fullAnalysis" ? (
              <FullAnalysisPanel
                panel={panel}
                snap={snap}
                onSwitchToEdit={() => openScenario(panel.scenario)}
                onClose={closePanel}
                onDelete={() => deleteScenario(panel.scenario.id)}
              />
            ) : (
              <EditorPanel
                panel={panel}
                snap={snap}
                isPro={isPro}
                saving={saving}
                hasUnsaved={hasUnsaved}
                onInputChange={handleInputChange}
                onNameChange={handleNameChange}
                onTemplateChange={handleTemplateChange}
                onSave={saveScenario}
                onDelete={panel.mode === "edit" ? () => deleteScenario(panel.scenario.id) : undefined}
                onClose={closePanel}
                onViewFullAnalysis={panel.mode === "edit" ? () => openFullAnalysis(panel.scenario) : undefined}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Page export ────────────────────────────────────────────────────────────────

export default function WhatIfPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center py-24">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-purple-200 border-t-purple-600" />
      </div>
    }>
      <WhatIfWorkspace />
    </Suspense>
  );
}
