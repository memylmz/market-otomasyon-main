/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Paylaşılan paket ESM kaynak olarak gelir; Next'in derlemesi gerekir.
  transpilePackages: ['@market/shared'],
  poweredByHeader: false,
  eslint: { ignoreDuringBuilds: true },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
    ];
  },
};

export default nextConfig;
