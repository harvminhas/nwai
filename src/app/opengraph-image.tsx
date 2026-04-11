import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "networth.online – Know Where Your Money Actually Goes";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OGImage() {
  return new ImageResponse(
    (
      <div
        style={{
          background: "white",
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          justifyContent: "center",
          padding: "72px 80px",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        {/* Purple accent bar */}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: 8,
            background: "#9333ea",
          }}
        />

        {/* Logo */}
        <div style={{ display: "flex", alignItems: "center", marginBottom: 40 }}>
          <span style={{ fontWeight: 700, fontSize: 22, color: "#9333ea" }}>
            networth
          </span>
          <span style={{ fontWeight: 700, fontSize: 22, color: "#9ca3af" }}>
            .online
          </span>
        </div>

        {/* Headline */}
        <div
          style={{
            fontSize: 60,
            fontWeight: 800,
            color: "#111827",
            lineHeight: 1.1,
            maxWidth: 720,
            marginBottom: 24,
          }}
        >
          Finally know where your{" "}
          <span style={{ color: "#9333ea" }}>money actually goes.</span>
        </div>

        {/* Sub-copy */}
        <div style={{ fontSize: 24, color: "#6b7280", maxWidth: 640, lineHeight: 1.4 }}>
          Upload a bank statement PDF and get your net worth, spending breakdown,
          savings rate, and AI insights — in under 60 seconds.
        </div>

        {/* Trust badges */}
        <div
          style={{
            display: "flex",
            gap: 32,
            marginTop: 48,
          }}
        >
          {[
            "No bank login",
            "Any Canadian bank",
            "Free to start",
          ].map((badge) => (
            <div
              key={badge}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                background: "#f9fafb",
                border: "1px solid #e5e7eb",
                borderRadius: 8,
                padding: "8px 16px",
                fontSize: 16,
                color: "#374151",
                fontWeight: 500,
              }}
            >
              <span style={{ color: "#22c55e", fontSize: 18 }}>✓</span>
              {badge}
            </div>
          ))}
        </div>
      </div>
    ),
    { ...size }
  );
}
