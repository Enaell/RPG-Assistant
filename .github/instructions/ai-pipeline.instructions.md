---
description: "Use when working on the AI reasoning chain: packages/stt-client, packages/llm-agent, packages/context-manager (STT → context state → LLM decision)."
applyTo: "packages/stt-client/**, packages/llm-agent/**, packages/context-manager/**"
---

# AI pipeline conventions (stt-client · llm-agent · context-manager)

These three packages are tested independently and are **not yet wired together end-to-end** — nothing calls `context-manager` from `llm-agent` automatically, and no real-time trigger loop exists. Don't assume the chain is live; that's a separate, deliberately deferred task.

- **stt-client**: calls `POST /v1/audio/transcriptions` with `voxtral-mini-latest` only. The Zod env schema rejects any `STT_MODEL` containing `realtime` at startup — never configure the realtime/WebSocket model for this batch endpoint. Retries HTTP 429 with exponential backoff, honoring `Retry-After`.
- **llm-agent**: `AgentResponseSchema` (Zod) lives **here**, not in `shared-types` (which stays runtime-dependency-free). `apps/orchestrator` imports and reuses this exact schema — never duplicate it. Invalid/malformed LLM JSON throws `AgentError`; there is no silent fallback — let the caller decide how to handle it. Retry with exponential backoff on network errors and HTTP 429/5xx only — never on 4xx (bad API key) or an already-elapsed timeout.
- **context-manager**: state machine is `IDLE → ACTIVE → PAUSED → ACTIVE → ENDED`. `ENDED` is terminal by design — never try to restart an existing instance; construct a new `ContextManager()` per session. Emits typed events (`stateChanged`, `sceneChanged`, `transcriptAppended`, `musicChanged`, `imageChanged`) via `onEvent()`.
- Validate all external/LLM data with Zod at the boundary; no `any`.
- After editing any of these packages, run `pnpm -r build` before running tests in a consumer package (tests resolve `@rpg-assistant/*` imports through `dist/`).
