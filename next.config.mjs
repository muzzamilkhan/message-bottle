/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**.public.blob.vercel-storage.com" },
      { protocol: "https", hostname: "lh3.googleusercontent.com" },
    ],
  },
  experimental: {
    serverActions: {
      // One compressed letter image is capped at 600 KB; this leaves room for
      // it plus form fields without an opaque 413.
      bodySizeLimit: "2mb",
    },
  },
};

export default nextConfig;
