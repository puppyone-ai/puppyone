import type { NextConfig } from 'next';
import { readFileSync } from 'fs';
import { join } from 'path';

const versionFile = JSON.parse(
  readFileSync(join(import.meta.dirname, '..', 'version.json'), 'utf-8')
);

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  env: {
    NEXT_PUBLIC_APP_VERSION: versionFile.version,
  },
};

export default nextConfig;
