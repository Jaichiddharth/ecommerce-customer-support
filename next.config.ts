import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  allowedDevOrigins: [
    "*.ngrok-free.dev",
    "*.ngrok-free.app",
    "*.trycloudflare.com",
    "cure-thriving-bobbing.ngrok-free.dev",
  ],
};

export default nextConfig;
