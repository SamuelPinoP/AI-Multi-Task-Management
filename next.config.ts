import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The dev-only route badge sat on top of the sidebar's Collapse button and
  // the phone Home tab. Build and runtime errors still open the dev overlay.
  devIndicators: false,
  experimental: {
    proxyClientMaxBodySize: "110mb",
  },
  async headers() {
    return [
      {
        // Browsers check for a new service worker on every visit; never serve a stale one.
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self'" },
        ],
      },
    ];
  },
};

export default nextConfig;
