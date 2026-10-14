---
description: "Use when working on packages/db: SQLite schema and persistence for sessions and transcript_lines."
applyTo: "packages/db/**"
---

# packages/db conventions

- SQLite via `better-sqlite3`; two tables: `sessions`, `transcript_lines`. Single-writer/single-reader (discord-bot writes, orchestrator reads `/transcript/recent` read-only) per ADR-005 — don't introduce multi-writer assumptions (connection pooling, concurrent write locks, etc.).
- `transcript_lines` idempotency is enforced by a **partial unique index** on `(session_id, source_file)` — real-time lines have `source_file = NULL` and are unaffected by it. Any new insert path must go through (or preserve the semantics of) `TranscriptRepository.existsBySessionAndSourceFile` rather than re-deriving its own dedup logic.
- This package must not import from any `apps/*` (module boundary rule) — it's consumed by both `apps/discord-bot` and `apps/orchestrator`, so schema changes affect both; check both consumers before altering table shape.
- After changing schema or repository code here, run `pnpm -r build` before testing consumer apps — they resolve `@rpg-assistant/db` via `dist/`, not `src/`.
