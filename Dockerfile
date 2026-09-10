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

# No build arguments at all, which is what makes one image runnable anywhere.
#
# The only candidate was ever NEXT_PUBLIC_BETTER_AUTH_URL: NEXT_PUBLIC_* values
# are inlined into the client bundle here rather than read at runtime, so an
# origin passed in would be baked into every bundle every user of this image
# pulls, and setting the variable on `docker run` would do exactly nothing.
# Nothing in src/ reads it — the auth UI is Server Actions, and the links that
# have to be absolute come from requestOrigin(), which reads the request's own
# host headers. Reintroducing it would make the image host-specific; put the
# origin in front of the container instead.
#
# DATABASE_URL and BETTER_AUTH_SECRET are runtime-only for a different reason:
# every route is server-rendered, so they're never needed at build time, and a
# build arg would bake secrets into image layers.
ENV NEXT_TELEMETRY_DISABLED=1

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
# so the runtime image doesn't carry the full node_modules tree. public/ is not
# part of that trace, hence the separate copy — and it's kept in the repo by a
# .gitkeep even though the app currently ships no static assets there (the
# favicon is app/favicon.ico). Git doesn't track empty directories, so deleting
# that file breaks this COPY and the whole image build with it.
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
