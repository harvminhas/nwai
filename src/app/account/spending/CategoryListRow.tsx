"use client";
import Link from "next/link";
import React from "react";

/**
 * Reusable row shell for both the Overview "By Category" section and the
 * "By Category" tab's "All Categories" list.
 *
 * Interaction model (consistent everywhere):
 *   - Click anywhere on the row  → expand / collapse
 *   - Click the category name    → navigate to category page (stopPropagation)
 *   - Chevron icon               → purely visual, animates on open
 */
interface CategoryListRowProps {
  isOpen: boolean;
  onToggle: () => void;
  /** The main row content (left + right, NOT including the chevron). */
  rowContent: React.ReactNode;
  /** Panel rendered below the row when open. */
  children?: React.ReactNode;
  className?: string;
}

export function CategoryListRow({
  isOpen,
  onToggle,
  rowContent,
  children,
  className = "",
}: CategoryListRowProps) {
  return (
    <div>
      <div
        className={`flex items-center hover:bg-gray-50 transition cursor-pointer ${className}`}
        onClick={onToggle}
      >
        <div className="flex flex-1 items-center min-w-0">{rowContent}</div>
        {/* Chevron — visual only */}
        <div className="shrink-0 flex items-center justify-center w-8 self-stretch text-gray-300 transition-colors">
          <svg
            className={`h-4 w-4 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </div>
      {isOpen && children}
    </div>
  );
}

/** Category name that navigates on click without triggering the row expand. */
interface CategoryNameLinkProps {
  href: string;
  name: string;
  className?: string;
}

export function CategoryNameLink({ href, name, className = "" }: CategoryNameLinkProps) {
  return (
    <Link
      href={href}
      onClick={(e) => e.stopPropagation()}
      className={`group/name inline-flex items-center gap-1 hover:text-purple-600 transition-colors ${className}`}
    >
      {name}
      <svg
        className="h-3 w-3 opacity-30 group-hover/name:opacity-70 transition-opacity shrink-0"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
        />
      </svg>
    </Link>
  );
}
