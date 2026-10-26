import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Workspace packages ship TypeScript source.
  transpilePackages: ['@acme/ui', '@acme/data'],
};

export default nextConfig;
