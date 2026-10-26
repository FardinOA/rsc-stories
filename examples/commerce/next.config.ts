import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Product images are local SVG placeholders.
  images: { dangerouslyAllowSVG: true, contentDispositionType: 'attachment' },
};

export default nextConfig;
