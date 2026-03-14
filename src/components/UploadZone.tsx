"use client";

import { useCallback, useState } from "react";

const MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10MB
const ACCEPT =
  "application/pdf,text/csv,application/csv,image/png,image/jpeg,image/jpg,.csv";

export type UploadZoneProps = {
  onFileSelect: (file: File) => void;
  disabled?: boolean;
};

type ErrorType = "size" | "type" | null;

export default function UploadZone({ onFileSelect, disabled }: UploadZoneProps) {
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<ErrorType>(null);

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

  const handleFile = useCallback(
    (file: File | null) => {
      setError(null);
      if (!file) return;
      const err = validate(file);
      if (err) {
        setError(err);
        return;
      }
      onFileSelect(file);
    },
    [onFileSelect, validate]
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      if (disabled) return;
      const file = e.dataTransfer.files?.[0];
      handleFile(file || null);
    },
    [disabled, handleFile]
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
      const file = e.target.files?.[0];
      handleFile(file || null);
      e.target.value = "";
    },
    [handleFile]
  );

  const errorMessage =
    error === "size"
      ? "Please upload a file under 10MB"
      : error === "type"
        ? "Please upload PDF, CSV, PNG, or JPG"
        : null;

  return (
    <div className="w-full">
      <label
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        className={`flex min-h-[220px] cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed transition ${
          disabled
            ? "cursor-not-allowed border-gray-200 bg-gray-50"
            : dragging
              ? "border-purple-500 bg-purple-50/50"
              : "border-gray-300 bg-gray-50/50 hover:border-purple-400 hover:bg-purple-50/30"
        }`}
      >
        <input
          type="file"
          accept={ACCEPT}
          onChange={onInputChange}
          disabled={disabled}
          className="hidden"
        />
        <span className="text-4xl text-gray-400">📄</span>
        <p className="mt-2 font-medium text-gray-700">
          Drag and drop your statement here, or click to browse
        </p>
        <p className="mt-1 text-sm text-gray-500">PDF, CSV, PNG or JPG — max 10MB</p>
      </label>
      {errorMessage && (
        <p className="mt-2 text-sm text-red-600" role="alert">
          {errorMessage}
        </p>
      )}
    </div>
  );
}
