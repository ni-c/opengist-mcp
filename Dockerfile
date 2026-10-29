# Build stage
#
# node:26-alpine is the ACTIVE LTS line, not the newest tag — roughly half of all
# Node majors never become LTS, so "newest" and "supported" are different things.
# Only the major belongs in this note. A patch version written here would be
# falsified by the next digest bump, which would arrive red for a reason nobody
# needs to act on. CI checks the claim instead, on every run
# (.github/scripts/check-base-image-pin.sh): `node:lts-alpine` and
# `node:26-alpine` must resolve to the same digest, and the digest pinned below
# must be a Node 26 image. The day 26 leaves LTS, that fails.
FROM node:26-alpine@sha256:c6ad9e9c1d80f6eb607c26b4b0a132ff7a2344fad1c78ea3baa2a7d4c8de6d94 AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev --ignore-scripts

# Runtime
FROM node:26-alpine@sha256:c6ad9e9c1d80f6eb607c26b4b0a132ff7a2344fad1c78ea3baa2a7d4c8de6d94
WORKDIR /app
ENV NODE_ENV=production

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
# yarn is the third thing the base image ships beside npm and corepack, under
# /opt and as two symlinks; nothing here runs it either.
RUN rm -rf /usr/local/lib/node_modules/npm \
  /usr/local/lib/node_modules/corepack \
  /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
  /usr/local/bin/yarn /usr/local/bin/yarnpkg /opt/yarn-v*

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
# The server reports its version from package.json at runtime. The lockfile is
# not copied: nothing reads it once node_modules is in place.
COPY package.json ./

# Ownership proof for the MCP Registry: must match server.json's name.
LABEL io.modelcontextprotocol.server.name="io.github.ni-c/opengist-mcp"

# Drop root: the node image ships an unprivileged `node` user (uid 1000).
USER node

# stdio transport only — no port, no healthcheck. The server starts without
# OPENGIST_* credentials (tools are listable, so Glama's sandbox inspector can
# enumerate them); calls then fail with setup instructions.
ENTRYPOINT ["/sbin/tini", "--", "node", "dist/index.js"]
