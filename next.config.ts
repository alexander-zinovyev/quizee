import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  distDir: process.env.QUIZEE_NEXT_DIST_DIR ?? ".next",
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
