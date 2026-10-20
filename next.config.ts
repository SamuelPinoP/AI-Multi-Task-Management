import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The dev-only route badge sat on top of the sidebar's Collapse button and
  // the phone Home tab. Build and runtime errors still open the dev overlay.
  devIndicators: false,
  experimental: {
    proxyClientMaxBodySize: "110mb",
  },
};

export default nextConfig;
