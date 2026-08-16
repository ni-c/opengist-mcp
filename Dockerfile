# Build stage
FROM node:24-alpine@sha256:d32cdf619f63fe0471182d08996dd516c6275bb5fd31ae06e55a570bd9e1ad43 AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev --ignore-scripts

# Runtime
FROM node:24-alpine@sha256:d32cdf619f63fe0471182d08996dd516c6275bb5fd31ae06e55a570bd9e1ad43
WORKDIR /app
ENV NODE_ENV=production

# Node as PID 1 has no default SIGTERM disposition, so `docker stop` would wait
# out the full grace period before killing it. tini forwards the signal. It also
# reaps orphans, which this server does not produce today — no child processes —
# but that is one `execFile` away from being wrong.
RUN apk add --no-cache tini=~0.19

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
# The server reports its version from package.json at runtime.
COPY package.json package-lock.json ./

# Ownership proof for the MCP Registry: must match server.json's name.
LABEL io.modelcontextprotocol.server.name="io.github.ni-c/opengist-mcp"

# Drop root: the node image ships an unprivileged `node` user (uid 1000).
USER node

# stdio transport only — no port, no healthcheck. The server starts without
# OPENGIST_* credentials (tools are listable, so Glama's sandbox inspector can
# enumerate them); calls then fail with setup instructions.
ENTRYPOINT ["/sbin/tini", "--", "node", "dist/index.js"]
