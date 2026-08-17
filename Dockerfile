# syntax=docker/dockerfile:1

FROM node:24-alpine AS base

# ---- Dependencies ----
FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---- Build ----
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# NEXT_PUBLIC_* vars are inlined into the client bundle at build time, so this
# needs to be known here. It isn't a secret. DATABASE_URL/BETTER_AUTH_SECRET
# are only needed at runtime (every route in this app is server-rendered),
# so they're deliberately NOT build args — that would bake secrets into image layers.
ARG NEXT_PUBLIC_BETTER_AUTH_URL
ENV NEXT_PUBLIC_BETTER_AUTH_URL=${NEXT_PUBLIC_BETTER_AUTH_URL} \
    NEXT_TELEMETRY_DISABLED=1

RUN npm run build

# ---- Runtime ----
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs \
    && adduser --system --uid 1001 nextjs

# `output: "standalone"` traces only the files next start actually needs,
# so the runtime image doesn't carry the full node_modules tree.
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Item photos live outside ./public on purpose — Next indexes the public folder
# once at boot in production, so files written after that would 404 until a
# restart. They're served by the /api/uploads route instead.
ENV UPLOADS_DIR=/app/uploads
RUN mkdir -p ./uploads && chown nextjs:nodejs ./uploads

USER nextjs

EXPOSE 3000

CMD ["node", "server.js"]
