/**
 * Account switcher uses the shared display-name resolver.
 * @vitest-environment jsdom
 */

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import AccountSwitcher from "../AccountSwitcher";

const pathname = vi.fn(() => "/account/assets");

vi.mock("next/navigation", () => ({
  usePathname: () => pathname(),
}));

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...rest
  }: {
    children: React.ReactNode;
    href: string;
    className?: string;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("firebase/auth", () => ({
  onAuthStateChanged: (_auth: unknown, cb: (user: { getIdToken: () => Promise<string> }) => void) => {
    cb({ getIdToken: async () => "token" });
    return () => {};
  },
}));

vi.mock("@/lib/firebase", () => ({
  getFirebaseClient: () => ({ auth: {} }),
}));

function jsonResponse(body: unknown) {
  return Promise.resolve({
    ok: true,
    json: async () => body,
  });
}

describe("AccountSwitcher display names", () => {
  beforeEach(() => {
    pathname.mockReturnValue("/account/assets");
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (String(url).includes("assets-summary")) {
          return jsonResponse({
            currency: "CAD",
            accountBalanceHistory: [
              { slug: "1001", label: "Everyday Chequing" },
            ],
            groups: [
              {
                label: "Cash & Savings",
                accounts: [
                  {
                    slug: "1001",
                    bankName: "Example Credit Union",
                    accountName: "Example Credit Union",
                    balance: 1200,
                  },
                  {
                    slug: "ex-chequing-2002",
                    bankName: "Example Bank",
                    accountName: "Chequing",
                    balance: 3400,
                  },
                  {
                    slug: "broker-6006",
                    bankName: "Unknown Bank",
                    accountName: "Real Estate Co",
                    balance: 50000,
                  },
                ],
                manualAssets: [],
              },
            ],
          });
        }
        return jsonResponse({ currency: "CAD", groups: [], accountBalanceHistory: [] });
      })
    );
  });

  async function openSwitcher() {
    render(<AccountSwitcher />);
    fireEvent.click(screen.getByRole("button", { name: /Accounts/i }));
    await waitFor(() => {
      expect(screen.getByPlaceholderText("Find an account")).toBeTruthy();
    });
  }

  it("shows the resolved product name, not institution · last4", async () => {
    await openSwitcher();
    const everyday = screen.getByText("Everyday Chequing");
    expect(everyday.className).toContain("text-gray-800");
    expect(screen.getByText("Chequing").className).toContain("text-gray-800");
    expect(screen.getByText("Real Estate Co").className).toContain("text-gray-800");
    expect(screen.getByText(/Example Credit Union/).className).toContain("text-gray-400");
    expect(screen.queryByText(/Unknown Bank/)).toBeNull();
  });

  it("matches search on display name, institution, and last4", async () => {
    await openSwitcher();
    const input = screen.getByPlaceholderText("Find an account");

    fireEvent.change(input, { target: { value: "everyday" } });
    expect(screen.getByText("Everyday Chequing")).toBeTruthy();
    expect(screen.queryByText("Real Estate Co")).toBeNull();

    fireEvent.change(input, { target: { value: "example bank" } });
    expect(screen.getByText("Chequing")).toBeTruthy();
    expect(screen.queryByText("Everyday Chequing")).toBeNull();

    fireEvent.change(input, { target: { value: "6006" } });
    expect(screen.getByText("Real Estate Co")).toBeTruthy();
    expect(screen.queryByText("Chequing")).toBeNull();
  });
});
