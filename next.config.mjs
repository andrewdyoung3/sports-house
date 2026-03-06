/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'a.espncdn.com' },
      { protocol: 'https', hostname: 'www.thesportsdb.com' },
      { protocol: 'https', hostname: 'cdn.ssref.net' },
    ],
  },
};

export default nextConfig;
