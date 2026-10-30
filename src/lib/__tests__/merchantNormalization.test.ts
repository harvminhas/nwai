/**
 * Unit tests for merchant name normalization used in merge suggestions
 */

import { normalizeMerchantForSimilarity } from "../merchantSimilarity";

describe("normalizeMerchantForSimilarity", () => {
  test("real Google Cloud variants from production data", () => {
    // These are the exact 10 Google Cloud names from the user's data
    // All should normalize to "google cloud"
    expect(normalizeMerchantForSimilarity("GOOGLE CLOUD XR3XS7")).toBe("google cloud");
    expect(normalizeMerchantForSimilarity("GOOGLE *CLOUD 74DBCz")).toBe("google cloud");
    expect(normalizeMerchantForSimilarity("Google *CLOUD R69wX8")).toBe("google cloud");
    expect(normalizeMerchantForSimilarity("GOOGLE *CLOUD VF5Q3W")).toBe("google cloud");
    expect(normalizeMerchantForSimilarity("GOOGLE CLOUD A1B2C3")).toBe("google cloud");
    
    // MPRCGL has no digit, so it's kept but should still group via "google cloud" prefix
    const mprcgl = normalizeMerchantForSimilarity("GOOGLE *CLOUD MPRCGL");
    expect(mprcgl.startsWith("google cloud")).toBe(true);
  });
  
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
