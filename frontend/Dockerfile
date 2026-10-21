# =============================================================================
# ClaimGuard Web — Next.js 15 (App Router, output: "standalone")
#
# Dasar: next.config.ts memakai `output: "standalone"`, jadi image akhir hanya
# butuh .next/standalone + .next/static + public.
#
# Penting: NEXT_PUBLIC_* di-inline saat `next build`, bukan saat runtime.
# Karena itu nilainya diberikan sebagai build ARG, bukan env Cloud Run.
# =============================================================================

FROM node:24-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# npm ci butuh lockfile yang sinkron; ini juga menjaga build deterministik.
RUN npm ci

FROM node:24-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Di-inline ke bundle browser saat build.
ARG NEXT_PUBLIC_API_BASE_URL
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

RUN npm run build

FROM node:24-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=8080 \
    HOSTNAME=0.0.0.0

# Output standalone sudah memuat node_modules yang dibutuhkan.
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

RUN groupadd --system --gid 10001 nodejs \
    && useradd --system --uid 10001 --gid nodejs nextjs \
    && chown -R nextjs:nodejs /app
USER nextjs

EXPOSE 8080

# server.js dihasilkan Next.js; menghormati PORT dan HOSTNAME.
CMD ["node", "server.js"]
