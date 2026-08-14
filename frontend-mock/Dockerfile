# Multi-stage build producing a minimal standalone Next.js server.
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# NEXT_PUBLIC_* must be present at BUILD time to be inlined into the bundle.
# Defaults to localhost for dev; production builds pass the public API URL.
ARG NEXT_PUBLIC_API_BASE="http://localhost:8000/api/v1"
ENV NEXT_PUBLIC_API_BASE=$NEXT_PUBLIC_API_BASE
# Without this arg Railway cannot pass NEXT_PUBLIC_DATA_MODE into the build, and
# a build that can't see it compiles the in-browser demo into the bundle — a
# live-looking app that never contacts the API. Default stays mock: an
# unconfigured build should remain the safe, self-contained demo (AGENTS.md).
ARG NEXT_PUBLIC_DATA_MODE="mock"
ENV NEXT_PUBLIC_DATA_MODE=$NEXT_PUBLIC_DATA_MODE
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
# The standalone server binds HOSTNAME:PORT. Railway/Render inject $PORT, and
# binding 0.0.0.0 (not the default localhost) is what makes the container
# reachable from outside.
ENV HOSTNAME=0.0.0.0 PORT=3000
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
EXPOSE 3000
CMD ["node", "server.js"]
