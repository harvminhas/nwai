"use client";

import { useCallback, useState } from "react";

const MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10MB
const ACCEPT =
  "application/pdf,text/csv,application/csv,image/png,image/jpeg,image/jpg,.csv";

export type UploadZoneProps = {
  /** Called for single-file mode (default). */
  onFileSelect?: (file: File) => void;
  /** Called for multi-file mode. Provide this instead of onFileSelect. */
  onFilesSelect?: (files: File[]) => void;
  /** When true, allows selecting/dropping multiple files. */
  multiple?: boolean;
  disabled?: boolean;
  /** Visual variant: "default" (single) or "premium" (multi, blue-tinted) */
  variant?: "default" | "premium";
};

type ErrorType = "size" | "type" | null;

function SingleFileIcon() {
  return (
    <svg width="40" height="48" viewBox="0 0 40 48" fill="none" className="text-gray-400">
      <rect x="1" y="1" width="30" height="38" rx="3" fill="white" stroke="#d1d5db" strokeWidth="1.5" />
      <path d="M8 14h16M8 20h16M8 26h10" stroke="#d1d5db" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function MultiFileIcon() {
  return (
    <svg width="52" height="52" viewBox="0 0 52 52" fill="none">
      <rect x="4" y="8" width="30" height="36" rx="3" fill="#e0e7ff" stroke="#c7d2fe" strokeWidth="1.5" />
      <rect x="9" y="4" width="30" height="36" rx="3" fill="#eef2ff" stroke="#c7d2fe" strokeWidth="1.5" />
      <rect x="14" y="0" width="30" height="40" rx="3" fill="white" stroke="#a5b4fc" strokeWidth="1.5" />
      <circle cx="29" cy="52" r="0" fill="none" />
      <path d="M29 18v14M22 25l7 7 7-7" stroke="#6366f1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function UploadZone({ onFileSelect, onFilesSelect, multiple = false, disabled, variant }: UploadZoneProps) {
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<ErrorType>(null);

  const isPremium = variant === "premium" || multiple;

  const validate = useCallback((file: File): ErrorType => {
    if (file.size > MAX_SIZE_BYTES) return "size";
    const type = file.type.toLowerCase();
    const allowed = [
      "application/pdf",
      "image/png",
      "image/jpeg",
      "image/jpg",
      "text/csv",
      "application/csv",
      "text/comma-separated-values",
    ];
    const name = file.name.toLowerCase();
    if (!allowed.some((t) => type === t) && !name.endsWith(".csv"))
      return "type";
    return null;
  }, []);

  const handleFiles = useCallback(
    (fileList: FileList | null) => {
      setError(null);
      if (!fileList || fileList.length === 0) return;

      if (multiple && onFilesSelect) {
        const valid: File[] = [];
        for (const file of Array.from(fileList)) {
          const err = validate(file);
          if (err) { setError(err); continue; }
          valid.push(file);
        }
        if (valid.length > 0) onFilesSelect(valid);
      } else {
        const file = fileList[0];
        const err = validate(file);
        if (err) { setError(err); return; }
        onFileSelect?.(file);
      }
    },
    [multiple, onFilesSelect, onFileSelect, validate]
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      if (disabled) return;
      handleFiles(e.dataTransfer.files);
    },
    [disabled, handleFiles]
  );

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(true);
  }, []);

  const onDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
  }, []);

  const onInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      handleFiles(e.target.files);
      e.target.value = "";
    },
    [handleFiles]
  );

  const errorMessage =
    error === "size"
      ? "One or more files exceed the 10MB limit"
      : error === "type"
        ? "Please upload PDF, CSV, PNG, or JPG files only"
        : null;

  const baseClasses = isPremium
    ? `flex min-h-[200px] cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed transition ${
        disabled
          ? "cursor-not-allowed border-indigo-200 bg-indigo-50/40"
          : dragging
            ? "border-indigo-500 bg-indigo-100/70"
            : "border-indigo-300 bg-indigo-50/60 hover:border-indigo-400 hover:bg-indigo-100/50"
      }`
    : `flex min-h-[180px] cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed transition ${
        disabled
          ? "cursor-not-allowed border-gray-200 bg-gray-50"
          : dragging
            ? "border-purple-400 bg-purple-50/40"
            : "border-gray-200 bg-white hover:border-gray-300"
      }`;

  return (
    <div className="w-full">
      <label onDrop={onDrop} onDragOver={onDragOver} onDragLeave={onDragLeave} className={baseClasses}>
        <input
          type="file"
          accept={ACCEPT}
          multiple={multiple}
          onChange={onInputChange}
          disabled={disabled}
          className="hidden"
        />
        <div className="mb-3">
          {isPremium ? <MultiFileIcon /> : <SingleFileIcon />}
        </div>
        <p className="font-semibold text-gray-800">
          {isPremium ? "Drop all your statements here" : "Drop your PDF here"}
        </p>
        <p className="mt-1 text-sm text-gray-400">
          {isPremium
            ? "PDF or CSV · up to 20 files · auto-sorted by account"
            : "or click to browse · PDF or CSV · 1 file"}
        </p>
      </label>
      {errorMessage && (
        <p className="mt-2 text-sm text-red-600" role="alert">
          {errorMessage}
        </p>
      )}
    </div>
  );
}
