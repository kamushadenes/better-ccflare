# Multi-stage build: compile from source
# Stage 1: Build
FROM oven/bun:1 AS builder

WORKDIR /build

# Copy package files first for layer caching
COPY package.json bun.lock ./
COPY apps/cli/package.json apps/cli/
COPY apps/server/package.json apps/server/
COPY apps/lander/package.json apps/lander/
COPY packages/agents/package.json packages/agents/
COPY packages/cli-commands/package.json packages/cli-commands/
COPY packages/config/package.json packages/config/
COPY packages/core/package.json packages/core/
COPY packages/core-di/package.json packages/core-di/
COPY packages/dashboard-web/package.json packages/dashboard-web/
COPY packages/database/package.json packages/database/
COPY packages/errors/package.json packages/errors/
COPY packages/http-api/package.json packages/http-api/
COPY packages/http-common/package.json packages/http-common/
COPY packages/load-balancer/package.json packages/load-balancer/
COPY packages/logger/package.json packages/logger/
COPY packages/oauth-flow/package.json packages/oauth-flow/
COPY packages/providers/package.json packages/providers/
COPY packages/proxy/package.json packages/proxy/
COPY packages/security/package.json packages/security/
COPY packages/types/package.json packages/types/
COPY packages/ui-common/package.json packages/ui-common/
COPY packages/ui-constants/package.json packages/ui-constants/

RUN bun install --frozen-lockfile

# Copy all source
COPY . .

# Build dashboard and CLI binary
RUN bun run build

# Stage 2: Runtime
FROM debian:bookworm-slim

RUN apt-get update && \
    apt-get install -y sqlite3 ca-certificates curl && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy the compiled binary
COPY --from=builder /build/apps/cli/dist/better-ccflare /usr/local/bin/better-ccflare
RUN chmod +x /usr/local/bin/better-ccflare

# Create non-root user
RUN useradd -r -u 1000 -m -s /bin/bash ccflare && \
    mkdir -p /data /app/logs && \
    chown -R ccflare:ccflare /data /app

ENV NODE_ENV=production
ENV BETTER_CCFLARE_DB_PATH=/data/better-ccflare.db
ENV BETTER_CCFLARE_LOG_DIR=/app/logs

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD curl -f http://localhost:8080/health || exit 1

LABEL org.opencontainers.image.title="better-ccflare"
LABEL org.opencontainers.image.description="Load balancer proxy for Claude API"
LABEL org.opencontainers.image.source="https://github.com/kamushadenes/better-ccflare"

# Startup script
RUN printf '#!/bin/bash\necho "================================="\necho "better-ccflare Docker Container"\necho "================================="\necho "Architecture: $(uname -m)"\necho ""\n/usr/local/bin/better-ccflare --version\necho "================================="\necho ""\nexec /usr/local/bin/better-ccflare "$@"\n' > /usr/local/bin/entrypoint.sh && \
    chmod +x /usr/local/bin/entrypoint.sh

USER ccflare

VOLUME ["/data"]

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["--serve", "--port", "8080"]
