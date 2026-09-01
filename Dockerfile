# Build stage
#
# node:24-alpine is the ACTIVE LTS line, not the newest tag — roughly half of all
# Node majors never become LTS, so "newest" and "supported" are different things.
# What keeps this honest is a comparison, not a version number written down here:
# `node:lts-alpine` and `node:24-alpine` MUST resolve to the same digest. The day
# 24 leaves LTS they diverge, and that is visible; a hardcoded version in a comment
# is not. Verified 2026-09-01: both resolve to the digest below, Node 24.20.0.
# Refresh the digest and re-run that comparison together — a stale tag is
# invisible if only the digest is re-resolved.
FROM node:24-alpine@sha256:e67514e5d0f6c46656005e1b693b2ec9d52e80b641307de684d4a015ba7a4eaf AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev --ignore-scripts

# Runtime
FROM node:24-alpine@sha256:e67514e5d0f6c46656005e1b693b2ec9d52e80b641307de684d4a015ba7a4eaf
WORKDIR /app
ENV NODE_ENV=production

# CVE-2026-14456: the pinned base image carries OpenSSL 3.5.7-r0, and Alpine's
# fixed 3.5.8-r0 has not been rebuilt into node:24-alpine yet. Upgrading these
# two packages by name rather than running a blanket `apk upgrade` keeps the
# rest of the image exactly as the digest pins it. Drop this once the base
# image ships the fix.
RUN apk add --no-cache --upgrade libcrypto3 libssl3

# Node as PID 1 has no default SIGTERM disposition, so `docker stop` would wait
# out the full grace period before killing it. tini forwards the signal. It also
# reaps orphans, which this server does not produce today — no child processes —
# but that is one `execFile` away from being wrong.
RUN apk add --no-cache tini=~0.19

# The runtime never runs a package manager: the entrypoint is `node dist/index.js`
# and node_modules arrives already pruned from the build stage. Dropping the
# bundled npm and corepack removes their vendored dependency trees, which is
# where every HIGH/CRITICAL finding of the image scan came from — npm's own tar,
# undici, brace-expansion and ip-address, none of them this project's
# dependencies, and none of them reachable at runtime. They also cannot be fixed
# from here: they ship inside the base image.
RUN rm -rf /usr/local/lib/node_modules/npm \
  /usr/local/lib/node_modules/corepack \
  /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack

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
