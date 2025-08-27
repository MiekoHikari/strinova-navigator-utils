#############################################
# Multi-stage Dockerfile (pnpm + SWC build) #
#############################################

# Base stage with pnpm enabled and shared cache configuration
FROM node:22-slim AS base
ENV PNPM_HOME="/pnpm" \
	NODE_ENV=production \
	TZ=UTC
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && mkdir -p /pnpm/store
WORKDIR /app

# Only copy manifest files first for better layer caching
COPY package.json pnpm-lock.yaml ./

# Pre-fetch dependencies to leverage pnpm store across stages (no install yet)
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
	pnpm fetch

#############################################
# Build stage (includes dev dependencies)    #
#############################################
FROM base AS build
ENV NODE_ENV=development
# Install all deps (dev + prod) using the already fetched store
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
	pnpm install --frozen-lockfile

# Copy source after deps to maximize caching
COPY . .

# Build TypeScript -> dist using swc
RUN pnpm run build

#############################################
# Production dependencies only               #
#############################################
FROM base AS prod-deps
# Install only production dependencies (no dev) into their own layer
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
	pnpm install --prod --frozen-lockfile

#############################################
# Final runtime image                         #
#############################################
FROM node:22-slim AS runner
ENV NODE_ENV=production \
	TZ=UTC
WORKDIR /app

# Install curl for healthcheck
RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

# Copy production node_modules and built sources
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./

# Switch to non-root user provided by the base image
USER node

EXPOSE 4000

# Healthcheck: expects 2xx from /status
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
	CMD curl -fsS http://localhost:4000/status || exit 1

CMD ["node", "dist/index.js"]

