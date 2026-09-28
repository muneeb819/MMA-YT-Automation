import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // This app is self-contained; pin tracing to its own root so the parent
  // workspace lockfile is not inferred as the project root.
  outputFileTracingRoot: dir,
  // ffmpeg-static ships a large platform binary; keep it external to the server bundle.
  serverExternalPackages: ['ffmpeg-static', 'pg', '@electric-sql/pglite', 'bullmq', 'ioredis'],
  outputFileTracingIncludes: {
    '/api/**/*': ['./node_modules/ffmpeg-static/**/*'],
  },
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: false },
};

export default nextConfig;
