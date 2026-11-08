"use client";

import type { TimeRange } from "@/lib/rangeUtils";

interface RangeSwitchProps {
  value: TimeRange;
  onChange: (range: TimeRange) => void;
}

export function RangeSwitch({ value, onChange }: RangeSwitchProps) {
  const options: { value: TimeRange; label: string }[] = [
    { value: "3mo", label: "3mo" },
    { value: "12mo", label: "12mo" },
    { value: "ytd", label: "This year" },
  ];

  return (
    <div className="inline-flex items-center bg-gray-100 rounded-lg p-1">
      {options.map((option) => (
        <button
          key={option.value}
          onClick={() => onChange(option.value)}
          className={`
            px-2.5 py-1.5 text-[13px] font-medium rounded-md transition-colors lg:px-3 lg:text-sm
            ${
              value === option.value
                ? "bg-white text-gray-900 shadow-sm"
                : "text-gray-600 hover:text-gray-900"
            }
          `}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
