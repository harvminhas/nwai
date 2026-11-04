import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Hide the floating Next.js dev tools badge in the corner - it only ever showed up in local dev.
  devIndicators: false,
};

export default nextConfig;
