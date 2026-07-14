/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Keep PDF.js and its colocated worker outside the server bundle. The
    // server-side PDF reader loads the worker relative to the installed
    // package, not relative to .next/server/chunks.
    serverComponentsExternalPackages: ["@prisma/client", "pdfjs-dist"],
  },
  async headers() {
    return [
      {
        // let the service worker control the whole app scope
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
    ];
  },
};
export default nextConfig;
