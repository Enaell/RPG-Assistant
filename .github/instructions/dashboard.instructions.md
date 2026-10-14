---
description: "Use when working on apps/gm-dashboard: the React + Vite GM web UI that polls the orchestrator."
applyTo: "apps/gm-dashboard/**"
---

# apps/gm-dashboard conventions

- Standalone Vite app: `tsconfig.json` intentionally does **not** extend `tsconfig.base.json` (that one targets CommonJS with no DOM lib — wrong for React/Vite). Don't "fix" this by making it extend the base config.
- Build is `vite build`, not `tsc` — this app is **excluded** from the `pnpm -r build`/`pnpm -r test` mental model; use `pnpm --filter gm-dashboard build` or `pnpm dev:dashboard` directly. There are no automated tests here — verify manually (or via `vite build` for type errors).
- Reads `import.meta.env.VITE_ORCHESTRATOR_URL` from `apps/gm-dashboard/.env.local` — **Vite does not read the monorepo-root `.env`**. Any new env var here needs its own `VITE_` prefix and must go in `.env.local`.
- Polls the orchestrator every 3s (`GET /state`, `GET /transcript/recent`) — this app never calls `POST /actions` or talks to Discord/SQLite directly, only the orchestrator's HTTP API.
- Session ID is entered manually (no "active session" endpoint exists yet on the orchestrator) — don't assume auto-discovery of the current session.
