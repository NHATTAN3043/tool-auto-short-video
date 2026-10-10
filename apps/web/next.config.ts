import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: [
    "@studio/domain",
    "@studio/services",
    "@studio/adapters",
    "@studio/video",
    "@studio/config",
  ],
  // Rendering happens in the worker; never bundle Remotion's Node renderer into the web server.
  serverExternalPackages: ["@remotion/bundler", "@remotion/renderer"],
};

export default nextConfig;
