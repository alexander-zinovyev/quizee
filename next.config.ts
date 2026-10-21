import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  distDir: process.env.QUIZEE_NEXT_DIST_DIR ?? ".next",
  outputFileTracingIncludes: {
    // sharp's native binding loads libvips dynamically, which tracing can miss.
    "/api/rooms/from-manifest": ["./node_modules/@img/sharp-libvips-*/lib/**/*"],
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "images.unsplash.com",
      },
      {
        protocol: "https",
        hostname: "firebasestorage.googleapis.com",
      },
    ],
  },
};

export default nextConfig;
