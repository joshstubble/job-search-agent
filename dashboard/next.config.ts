import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow 127.0.0.1 to hit HMR WebSocket in the dev container.
  allowedDevOrigins: ["127.0.0.1"],

  // Theme packages and puppeteer-core contain native / JSX / platform-specific
  // code that must be loaded at runtime via Node — NOT bundled by Turbopack.
  serverExternalPackages: [
    "puppeteer-core",
    "pdfkit",
    "jsonresume-theme-even",
    "jsonresume-theme-classy",
    "jsonresume-theme-kendall",
    "jsonresume-theme-macchiato",
    "jsonresume-theme-stackoverflow",
    "jsonresume-theme-onepage-plus",
    "jsonresume-theme-flat",
    "jsonresume-theme-relaxed",
  ],
};

export default nextConfig;
