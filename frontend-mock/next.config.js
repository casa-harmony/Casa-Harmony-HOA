/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: "standalone",
  // Next 16 blocks dev resources (incl. the hydration bootstrap + HMR) for
  // hosts not on this list. Without it, opening http://127.0.0.1:3000 serves
  // the SSR HTML but React never hydrates — every form is dead. Keep both
  // spellings so "localhost" and "127.0.0.1" behave identically in dev.
  allowedDevOrigins: ["localhost", "127.0.0.1"],
};

module.exports = nextConfig;
