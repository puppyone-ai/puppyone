import type { NextConfig } from 'next';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

function loadVersion(): string {
  const candidates = [
    join(import.meta.dirname, '..', 'version.json'),
    join(import.meta.dirname, 'version.json'),
  ];
  for (const p of candidates) {
    if (existsSync(p)) {
      return JSON.parse(readFileSync(p, 'utf-8')).version;
    }
  }
  return process.env.APP_VERSION ?? '0.0.0';
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  env: {
    NEXT_PUBLIC_APP_VERSION: loadVersion(),
  },
};

export default nextConfig;
