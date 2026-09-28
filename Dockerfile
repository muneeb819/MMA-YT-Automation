# ShortForge AI — production image
# Multi-stage: builder produces the Next.js app, runtime carries FFmpeg + worker.
# The worker MUST be able to run FFmpeg, so a serverless function image is not
# sufficient for the worker; the web service can be deployed to Vercel.

# ---------- Stage 1: dependencies ----------
FROM node:22-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund

# ---------- Stage 2: build ----------
FROM node:22-bookworm-slim AS builder
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ---------- Stage 3: runtime ----------
FROM node:22-bookworm-slim AS runtime
WORKDIR /app

# ffmpeg-static ships its own binary, but a system ffmpeg is a useful fallback
# and is required for probing/edge cases.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=4310

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/src ./src
COPY --from=builder /app/tsconfig.json ./tsconfig.json
COPY --from=builder /app/next.config.mjs ./next.config.mjs
# tsx is required at runtime so the worker can execute TypeScript directly.
COPY --from=builder /app/node_modules/tsx ./node_modules/tsx

# Writable locations for the PGlite database and local storage fallback.
RUN mkdir -p /app/.data/storage /app/.data/pglite
VOLUME ["/app/.data"]

RUN groupadd --system --gid 1001 nodejs \
    && useradd --system --uid 1001 --gid nodejs shortforge \
    && chown -R shortforge:nodejs /app/.data
USER shortforge

EXPOSE 4310

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD curl -fsS http://localhost:4310/api/health || exit 1

CMD ["npm", "run", "start"]
