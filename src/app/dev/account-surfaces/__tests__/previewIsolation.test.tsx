/**
 * Preview harness must not be able to create real assets or obtain a token
 * for /api/user writes. The ordinary Assets Accounts Add asset path must
 * still POST with a Firebase bearer token.
 *
 * @vitest-environment jsdom
 */

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { CategoriesTab } from "@/app/account/assets/components/CategoriesTab";
import { AccountSurfacesPreview } from "../PreviewClient";
import { PreviewIsolationProvider } from "@/lib/previewIsolation";
import { buildPreviewAssetsSummary } from "@/lib/accountSectionPreviewFixture";
import type { AssetsSummary, AssetAccount, AssetGroup } from "@/lib/assetsSummary";

const firebaseMocks = vi.hoisted(() => ({
  getIdToken: vi.fn(),
  getFirebaseClient: vi.fn(),
}));

vi.mock("@/lib/firebase", () => ({
  getFirebaseClient: (...args: unknown[]) => firebaseMocks.getFirebaseClient(...args),
}));

vi.mock("@/lib/profileRefetch", () => ({
  triggerProfileRefetch: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/dev/account-surfaces",
  useSearchParams: () => ({
    get: (key: string) => {
      if (key === "tab") return "accounts";
      if (key === "side") return "assets";
      return null;
    },
  }),
}));

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...rest
  }: {
    children: React.ReactNode;
    href: string;
    title?: string;
    className?: string;
    "aria-label"?: string;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

function account(
  partial: Pick<AssetAccount, "slug" | "bankName" | "accountName" | "balance">
): AssetAccount {
  return {
    accountType: "checking",
    currency: "CAD",
    statementMonth: "2026-03",
    isStale: false,
    daysOld: 1,
    ...partial,
  };
}

function group(partial: Pick<AssetGroup, "type" | "label" | "total" | "accounts">): AssetGroup {
  return { manualAssets: [], ...partial };
}

function summary(groups: AssetGroup[]): AssetsSummary {
  return {
    totalAssets: groups.reduce((s, g) => s + g.total, 0),
    currency: "CAD",
    changeVsLastMonth: 0,
    changeVs12Months: 0,
    groups,
    monthlyHistory: [],
    staleAccounts: [],
    accountBalanceHistory: [],
    expenseTxns: [],
    incomeTxns: [],
  };
}

const cash = group({
  type: "cash",
  label: "Cash",
  total: 5000,
  accounts: [account({ slug: "checking-1", bankName: "Chase", accountName: "Checking", balance: 5000 })],
});

describe("preview isolation vs live Add asset", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    firebaseMocks.getIdToken.mockReset();
    firebaseMocks.getFirebaseClient.mockReset();
    firebaseMocks.getIdToken.mockResolvedValue("live-token");
    firebaseMocks.getFirebaseClient.mockReturnValue({
      auth: {
        currentUser: { getIdToken: firebaseMocks.getIdToken },
        onAuthStateChanged: vi.fn(() => () => {}),
      },
    });
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ id: "asset-1" }) });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("ordinary real-app Add asset still POSTs /api/user/assets with a Firebase token", async () => {
    render(<CategoriesTab summary={summary([cash])} />);

    fireEvent.click(screen.getByRole("button", { name: "+ Add asset" }));
    fireEvent.change(screen.getByPlaceholderText("e.g. House"), { target: { value: "Cabin" } });
    fireEvent.change(screen.getByPlaceholderText("0"), { target: { value: "50000" } });
    fireEvent.click(screen.getByRole("button", { name: "Add asset" }));

    await waitFor(() => {
      expect(firebaseMocks.getFirebaseClient).toHaveBeenCalled();
      expect(firebaseMocks.getIdToken).toHaveBeenCalled();
    });
    expect(fetchMock).toHaveBeenCalled();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/user/assets");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer live-token");
    const body = JSON.parse(String(init.body));
    expect(body.label).toBe("Cabin");
    expect(body.value).toBe(50000);
  });

  it("preview-isolated CategoriesTab hides Add asset and never touches token or POST", () => {
    render(
      <PreviewIsolationProvider>
        <CategoriesTab summary={summary([cash])} />
      </PreviewIsolationProvider>
    );

    expect(screen.queryByRole("button", { name: "+ Add asset" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add asset" })).toBeNull();
    expect(screen.queryByPlaceholderText("e.g. House")).toBeNull();
    expect(firebaseMocks.getFirebaseClient).not.toHaveBeenCalled();
    expect(firebaseMocks.getIdToken).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("full /dev/account-surfaces Accounts preview cannot invoke the real mutation path", async () => {
    const { container } = render(<AccountSurfacesPreview />);

    expect(container.querySelector("[data-preview-isolation='true']")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "+ Add asset" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add asset" })).toBeNull();
    expect(buildPreviewAssetsSummary("many").groups.length).toBeGreaterThan(0);

    await waitFor(async () => {
      await expect(fetch("/api/user/assets", { method: "POST", body: "{}" })).rejects.toThrow(
        /Preview isolation/
      );
    });
    expect(firebaseMocks.getIdToken).not.toHaveBeenCalled();
    const posted = fetchMock.mock.calls.some(
      (call) => call[0] === "/api/user/assets" && (call[1] as RequestInit | undefined)?.method === "POST"
    );
    expect(posted).toBe(false);
  });
});
