/**
 * Unit tests for account slug stability across masking changes.
 * 
 * Critical requirement: The same account uploaded before and after implementing
 * account masking must resolve to the same slug to prevent duplicate accounts.
 */

import { buildAccountSlug, normalizeAccountId, getAccountSlug } from "../accountSlug";
import { maskAccountNumber } from "../accountMasking";

describe("Account slug stability with masking", () => {
  describe("Numeric account IDs", () => {
    it("should generate stable slug for 573156 using getAccountSlug", () => {
      const bankName = "TD Canada Trust";
      const accountType = "Chequing";
      
      // Before masking: compute slug from full ID
      const slugBefore = buildAccountSlug(bankName, "573156", undefined, accountType);
      expect(slugBefore).toBe("3156"); // last 4 digits
      
      // After masking: stored slug is preserved
      const masked = maskAccountNumber("573156");
      expect(masked).toBe("3156");
      
      // Simulate stored parsedData with accountSlug from pre-masking
      const parsedData = {
        bankName,
        accountId: masked, // now only "3156"
        accountSlug: slugBefore, // stored from original computation
        accountType,
      };
      
      const slugAfter = getAccountSlug(parsedData);
      expect(slugAfter).toBe(slugBefore);
      expect(slugAfter).toBe("3156");
    });

    it("should generate stable slug for 1185-4190085 using getAccountSlug", () => {
      const bankName = "BMO";
      const accountType = "Savings";
      
      const slugBefore = buildAccountSlug(bankName, "1185-4190085", undefined, accountType);
      expect(slugBefore).toBe("0085"); // last 4 digits
      
      const masked = maskAccountNumber("1185-4190085");
      expect(masked).toBe("0085");
      
      const parsedData = {
        bankName,
        accountId: masked,
        accountSlug: slugBefore,
        accountType,
      };
      
      const slugAfter = getAccountSlug(parsedData);
      expect(slugAfter).toBe(slugBefore);
      expect(slugAfter).toBe("0085");
    });
  });

  describe("Alphanumeric account IDs", () => {
    it("should generate stable slug for HQ6MK8XN6CAD using getAccountSlug", () => {
      const bankName = "Tangerine";
      const accountType = "Savings";
      
      const slugBefore = buildAccountSlug(bankName, "HQ6MK8XN6CAD", undefined, accountType);
      expect(slugBefore).toBe("hq6mk8xn6cad"); // alphanumeric, normalized to lowercase
      
      const masked = maskAccountNumber("HQ6MK8XN6CAD");
      expect(masked).toBe("6CAD");
      
      const parsedData = {
        bankName,
        accountId: masked, // only "6CAD" now
        accountSlug: slugBefore, // stored from original
        accountType,
      };
      
      const slugAfter = getAccountSlug(parsedData);
      expect(slugAfter).toBe(slugBefore);
      expect(slugAfter).toBe("hq6mk8xn6cad");
    });
  });

  describe("Synthetic account IDs", () => {
    it("should generate stable slug for synthetic ID s123 using getAccountSlug", () => {
      const bankName = "RBC";
      const accountType = "Credit Card";
      
      const slugBefore = buildAccountSlug(bankName, "s123", undefined, accountType);
      expect(slugBefore).toBe("s123"); // <4 digits, uses alphanumeric
      
      const masked = maskAccountNumber("s123");
      expect(masked).toBe("s123"); // already 4 chars, unchanged
      
      const parsedData = {
        bankName,
        accountId: masked,
        accountSlug: slugBefore,
        accountType,
      };
      
      const slugAfter = getAccountSlug(parsedData);
      expect(slugAfter).toBe(slugBefore);
      expect(slugAfter).toBe("s123");
    });
  });

  describe("Edge cases", () => {
    it("should handle 4-digit account ID using getAccountSlug", () => {
      const bankName = "CIBC";
      const accountType = "Chequing";
      
      const slugBefore = buildAccountSlug(bankName, "1234", undefined, accountType);
      expect(slugBefore).toBe("1234"); // exactly 4 digits
      
      const masked = maskAccountNumber("1234");
      expect(masked).toBe("1234");
      
      const parsedData = {
        bankName,
        accountId: masked,
        accountSlug: slugBefore,
        accountType,
      };
      
      const slugAfter = getAccountSlug(parsedData);
      expect(slugAfter).toBe(slugBefore);
      expect(slugAfter).toBe("1234");
    });

    it("should fall back to buildAccountSlug when accountSlug is missing", () => {
      const bankName = "Scotiabank";
      const accountType = "Savings";
      
      // Legacy data without stored accountSlug
      const parsedData = {
        bankName,
        accountId: undefined,
        accountType,
      };
      
      const slug = getAccountSlug(parsedData);
      expect(slug).toBe("scotiabank-savings");
    });
  });
});
