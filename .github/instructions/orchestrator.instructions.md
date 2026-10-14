---
description: "Use when working on apps/orchestrator: the local HTTP API that receives AgentResponse and dispatches music/image/gm_tip/rule_help actions."
applyTo: "apps/orchestrator/**"
---

# apps/orchestrator conventions

- Binds to `127.0.0.1` explicitly in `index.ts` — **never** change this to `0.0.0.0` or any external interface; this API must stay local-only (privacy requirement).
- `POST /actions` validates bodies with `AgentResponseSchema` **imported from `packages/llm-agent`** — don't redefine or fork this schema here.
- Dedup (`handlers.ts`) is **per-action-type equality within a time window** (`DEDUP_WINDOW_MS`, default 4000ms), not a global request dedup — a `music` and a `gm_tip` action in the same `AgentResponse` are deduped independently against their own last-dispatched state.
- `GET /transcript/recent` reads the **same SQLite file** as `discord-bot` via `@rpg-assistant/db` (read-only from this process) — it does not go through `AgentResponse` (which has no transcript field). Requires this app's own `DB_PATH` env var; returns 503 if unset.
- Nothing currently calls `POST /actions` in real conditions — there is no live caller yet (that's the end-to-end wiring task, separate from this app's own correctness).
- This app can import from `packages/*` but never from another `apps/*`.
- After editing `packages/llm-agent` or `packages/db`, run `pnpm -r build` before `pnpm --filter @rpg-assistant/orchestrator test`.
