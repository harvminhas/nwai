import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // Keep authenticated app pages out of search results
        disallow: ["/account/", "/api/"],
      },
    ],
    sitemap: "https://networth.online/sitemap.xml",
    host: "https://networth.online",
  };
}
