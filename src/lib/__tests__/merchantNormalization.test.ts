/**
 * Unit tests for merchant name normalization used in merge suggestions
 */

/**
 * Normalize merchant name for similarity matching.
 * Strips special chars, trailing random codes, and normalizes whitespace.
 */
function normalizeMerchantForSimilarity(name: string): string {
  let cleaned = name.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  // Strip trailing tokens that contain BOTH a letter and a digit (or all digits)
  // separated by space. This catches codes like "XR3XS7", "74DBCz", "123456"
  // but preserves real words like "netflix", "resend", "godaddy", "turbotax"
  cleaned = cleaned.replace(/\s+(?=\S*\d)(?=\S*[a-z])[a-z0-9]{5,8}$/i, "").trim();
  // Also strip all-digit codes at the end
  cleaned = cleaned.replace(/\s+\d{5,8}$/, "").trim();
  return cleaned;
}

describe("normalizeMerchantForSimilarity", () => {
  test("strips trailing codes with mixed letters and digits", () => {
    expect(normalizeMerchantForSimilarity("GOOGLE CLOUD XR3XS7")).toBe("google cloud");
    expect(normalizeMerchantForSimilarity("GOOGLE *CLOUD 74DBCz")).toBe("google cloud");
    expect(normalizeMerchantForSimilarity("Google *CLOUD R69wX8")).toBe("google cloud");
    expect(normalizeMerchantForSimilarity("AWS EC2 A1B2C3")).toBe("aws ec2");
  });

  test("strips trailing all-digit codes", () => {
    expect(normalizeMerchantForSimilarity("MERCHANT 123456")).toBe("merchant");
    expect(normalizeMerchantForSimilarity("SERVICE 987654")).toBe("service");
  });

  test("preserves real merchant names without digits", () => {
    expect(normalizeMerchantForSimilarity("NETFLIX.COM")).toBe("netflix com");
    expect(normalizeMerchantForSimilarity("NETFLIX")).toBe("netflix");
    expect(normalizeMerchantForSimilarity("RESEND")).toBe("resend");
    expect(normalizeMerchantForSimilarity("IMPROVMX")).toBe("improvmx");
    expect(normalizeMerchantForSimilarity("TURBOTAX")).toBe("turbotax");
    expect(normalizeMerchantForSimilarity("GODADDY")).toBe("godaddy");
    expect(normalizeMerchantForSimilarity("LINKEDIN")).toBe("linkedin");
  });

  test("handles mixed case and special characters", () => {
    expect(normalizeMerchantForSimilarity("Google-Cloud-Platform XR3XS7")).toBe("google cloud platform");
    expect(normalizeMerchantForSimilarity("GOOGLE*CLOUD*74DBCz")).toBe("google cloud");
    expect(normalizeMerchantForSimilarity("Amazon Web Services A1B2C3D4")).toBe("amazon web services");
  });

  test("preserves short codes (< 5 chars)", () => {
    expect(normalizeMerchantForSimilarity("SERVICE A1B2")).toBe("service a1b2");
    expect(normalizeMerchantForSimilarity("MERCHANT X1")).toBe("merchant x1");
  });

  test("preserves long codes (> 8 chars)", () => {
    expect(normalizeMerchantForSimilarity("SERVICE A1B2C3D4E5")).toBe("service a1b2c3d4e5");
  });

  test("handles multiple spaces and special chars", () => {
    expect(normalizeMerchantForSimilarity("GOOGLE   CLOUD    XR3XS7")).toBe("google cloud");
    expect(normalizeMerchantForSimilarity("GOOGLE***CLOUD***74DBCz")).toBe("google cloud");
  });

  test("preserves all-letter codes (no digits)", () => {
    expect(normalizeMerchantForSimilarity("GOOGLE CLOUD MPRCGL")).toBe("google cloud mprcgl");
    expect(normalizeMerchantForSimilarity("SERVICE ABCDEF")).toBe("service abcdef");
  });
});
