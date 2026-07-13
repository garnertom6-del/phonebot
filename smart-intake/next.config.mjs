/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Keep PDF.js and its colocated worker outside the server bundle. The
    // server-side PDF reader loads the worker relative to the installed
    // package, not relative to .next/server/chunks.
    serverComponentsExternalPackages: ["@prisma/client", "pdfjs-dist"],
  },
};
export default nextConfig;
