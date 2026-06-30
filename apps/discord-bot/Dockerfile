# ══════════════════════════════════════════════════════════════════════════════
# Stage 1 — Builder
#
# Installs the full pnpm workspace, compiles TypeScript, then uses `pnpm deploy`
# to produce a self-contained directory with only production dependencies.
# This is the standard approach for pnpm monorepos in Docker.
# ══════════════════════════════════════════════════════════════════════════════
FROM node:20-slim AS builder

# Enable corepack to get pnpm without a separate install step
RUN corepack enable && corepack prepare pnpm@9 --activate

WORKDIR /build

# ── Copy workspace manifests (layer-cached until these files change) ──────────
# .npmrc must be included: it contains shamefully-hoist=true which makes pnpm
# create a flat node_modules, ensuring TypeScript can resolve workspace packages.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json .npmrc ./

# ── Copy only the packages required by the discord-bot ───────────────────────
# Add more COPY lines here as new packages/ are created and used by the bot.
COPY packages/shared-types/  ./packages/shared-types/
COPY apps/discord-bot/       ./apps/discord-bot/

# ── Install all workspace dependencies ───────────────────────────────────────
RUN pnpm install --frozen-lockfile

# ── Build workspace packages in dependency order ─────────────────────────────
RUN pnpm --filter @rpg-assistant/shared-types build
RUN pnpm --filter @rpg-assistant/discord-bot  build

# ── Deploy: copy the bot + prod deps into an isolated directory ───────────────
# `pnpm deploy --prod` resolves workspace: references and produces a directory
# that can run standalone — no pnpm, no workspace overhead.
RUN pnpm --filter @rpg-assistant/discord-bot deploy --prod /deploy/discord-bot

# ══════════════════════════════════════════════════════════════════════════════
# Stage 2 — Runtime
#
# Minimal image with only the compiled app and its production dependencies.
# No TypeScript, no dev tools, no source files from other packages.
# ══════════════════════════════════════════════════════════════════════════════
FROM node:20-slim AS runtime

# Run as non-root for security
RUN groupadd --gid 1001 nodejs \
  && useradd  --uid 1001 --gid nodejs --shell /bin/bash --create-home nodejs

WORKDIR /app

# Copy the self-contained deploy directory from the builder stage
COPY --from=builder --chown=nodejs:nodejs /deploy/discord-bot ./

# Create the recordings directory (used when AUDIO_OUTPUT_MODE=local).
# It will be overridden by the Docker Compose bind mount in practice,
# but having it here lets the container start without a mounted volume.
RUN mkdir -p recordings && chown nodejs:nodejs recordings

USER nodejs

# The bot's index.ts calls dotenv.config({ path: resolve(__dirname, '../../../.env') }).
# In the container that path resolves to a non-existent file — dotenv silently
# no-ops, and Zod validates env vars injected by Docker Compose instead.
CMD ["node", "dist/index.js"]
