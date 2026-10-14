# GitHub Copilot — Project Instructions

## Project Overview

**RPG-Assistant** is a real-time AI assistant for tabletop RPG (TTRPG) sessions over Discord.

It captures per-user voice audio from a Discord voice channel, transcribes the Game Master's speech using a STT model (Voxtral API, later local Whisper), feeds the transcript and session context into an LLM agent, and dispatches resulting actions (music, images, GM tips) via an orchestrator to a local GM Dashboard and OBS.

---

## Monorepo Structure

This is a **pnpm workspace monorepo** with the following apps and packages:

```
apps/
  discord-bot/        Entry point for Discord voice capture and slash commands
  orchestrator/       Local HTTP API — receives AgentResponse, dispatches actions (music/image/gm_tip/rule_help)
  gm-dashboard/        React + Vite web UI for the Game Master (images, music, tips) — polls the orchestrator
  session-summarizer/ Post-session summary and next-session prep generator

packages/
  stt-client/         Abstraction over STT backends (Voxtral API / Whisper local)
  llm-agent/          Abstraction over LLM backends (Mistral chat API / Ollama), prompt + Zod validation
  context-manager/    Session state machine (scene, mood, active music, history)
  db/                 SQLite persistence (sessions, transcript_lines)
  asset-library/      Music and image library with semantic search
  shared-types/       Shared TypeScript types across all packages

services/
  whisper-local/      Optional Python microservice for local STT (Phase 3 only)

assets/
  music/              Audio tracks organized by mood/scene
  images/             Scene images organized by setting/mood
```

---

## Tech Stack

- **Language**: TypeScript 5+ (strict mode, no `any` without justification)
- **Runtime**: Node.js 22.12+ (LTS)
- **Package manager**: pnpm with workspaces
- **Discord**: discord.js v14 + @discordjs/voice
- **STT (Phase 1)**: Voxtral batch API (Mistral, `POST /v1/audio/transcriptions`, modèle `voxtral-mini-latest`); fallback: OpenAI Whisper API
- **STT realtime (future)**: `voxtral-mini-transcribe-realtime-2602` is reserved for the realtime/WebSocket API and must not be used with the batch endpoint
- **STT (Phase 3)**: faster-whisper Python microservice exposed as REST
- **LLM (Phase 1-2)**: Mistral API (mistral-large or mistral-small)
- **LLM (Phase 3)**: Ollama local (REST API, no Python binding needed)
- **Database**: SQLite via `better-sqlite3` for session logs and asset metadata
- **Dashboard**: React + Vite (single page, no SSR needed)
- **OBS Integration**: `obs-websocket-js` v5
- **Testing**: Vitest
- **CI**: GitHub Actions

---

## Coding Conventions

### TypeScript
- Strict mode always (`"strict": true` in tsconfig)
- Prefer `type` over `interface` for data shapes; use `interface` for extensible contracts
- No `any`. Use `unknown` and narrow explicitly
- All async functions must handle errors — prefer `Result<T, E>` pattern over throwing for expected errors
- Use Zod for runtime validation of external data (LLM responses, API payloads, Discord events)

### Naming
- Files: `kebab-case.ts`
- Classes/Types: `PascalCase`
- Functions/variables: `camelCase`
- Constants: `SCREAMING_SNAKE_CASE`
- Packages in `packages/`: expose a single `index.ts` entry point

### Module Boundaries
- `apps/` can import from `packages/` but never from other `apps/`
- `packages/` must not import from `apps/`
- `shared-types` has zero runtime dependencies (types only)
- All cross-package communication at runtime uses the shared types from `shared-types`

### Environment Variables
- All secrets go in `.env` (never committed)
- Always validate env vars at startup using Zod (`z.string().min(1)`)
- Provide `.env.example` with all keys documented

---

## Architecture Decisions (ADRs)

### ADR-001: TypeScript over Python
Chosen because `discord.js` + `@discordjs/voice` are the most mature Discord libraries available. Python is only used for the optional local Whisper microservice (Phase 3). Ollama exposes a REST API making local LLMs accessible from TypeScript without any Python dependency.

### ADR-002: Per-user audio streams (Discord Bot) over system audio capture
System audio (VB-Cable) cannot identify individual speakers, mixes all sounds, and is OS-dependent. The Discord bot approach with `@discordjs/voice` provides a separate Opus stream per user, enabling speaker attribution and filtering (GM vs players).

### ADR-003: Asset library + semantic search over real-time image generation
AI image generation (Stable Diffusion, DALL-E) is too slow (5-30s) and produces inconsistent visual styles across a session. A curated library with semantic search is fast (<100ms), works offline, and produces coherent atmosphere. AI generation can be added in Phase 3 to enrich the library asynchronously.

### ADR-004: Hybrid trigger strategy (polling + events)
Pure polling every 5-15s misses dramatic moments and wastes API calls during silence. The strategy combines: (1) 15s ambient polling to maintain scene context, (2) keyword/phrase triggers in the transcript for immediate reactions, (3) explicit `/scene` Discord commands for planned moments.

### ADR-005: SQLite for session persistence
Sessions are single-writer, single-reader, local. SQLite with `better-sqlite3` is sufficient, fast, and zero-infrastructure. No need for Postgres or a cloud DB.

---

## Key Domain Vocabulary

| Term | Definition |
|------|-----------|
| MJ / GM | Maître du Jeu / Game Master — the narrator/referee |
| Joueur / Player | A player character participant |
| Scène / Scene | The current narrative moment (exploration, combat, social, etc.) |
| Ambiance / Mood | The emotional tone of the scene (mystérieux, tendu, joyeux, etc.) |
| Session | A single play session (2-5 hours typically) |
| Campagne / Campaign | A series of connected sessions |
| Asset | A music track or image in the local library |
| Action JSON | The structured output from the LLM agent describing what to trigger |
| Orchestrateur | The service that receives Action JSON and dispatches to subsystems |

---

## LLM Agent Contract

The LLM agent always outputs valid JSON matching this schema (validated with Zod at runtime):

```typescript
type AgentAction =
  | { type: "music"; track: string; fade_in?: number }
  | { type: "image"; query: string; source: "library" | "generate" }
  | { type: "gm_tip"; text: string; priority: "low" | "normal" | "high" }
  | { type: "rule_help"; topic: string; system: string }
  | { type: "none" };

type AgentResponse = {
  scene: string;
  mood: string;
  confidence: number; // 0-1
  actions: AgentAction[];
  trigger: "polling" | "keyword" | "manual";
  timestamp: string; // ISO 8601
};
```

The system prompt must always include:
- Current scene and mood
- Last N transcript lines with speaker labels
- Active music track (if any)
- Last displayed image description
- Available asset library summary
- Game system and active rules context

---

## Session State Machine

Valid scene transitions managed by `context-manager`:

```
IDLE → ACTIVE → PAUSED → ACTIVE → ENDED
                          ↑_____↓
```

The state machine emits events consumed by the orchestrator. No direct calls from the Discord bot to the orchestrator — always through the context manager.

---

## Privacy & Ethics Requirements

- The bot must display an **active recording** status in the Discord channel when capturing audio
- Audio streams must be **transcribed and immediately discarded** (never persisted as raw audio)
- All session participants must give **explicit consent** before capture starts
- The `/stop` command must immediately halt all capture and delete in-memory audio buffers
- No voice data is ever sent to third-party services other than the configured STT provider

---

## Development Phases

When asked to implement features, respect this phasing:

- **Phase 1 (MVP)**: Discord bot audio capture → `AUDIO_OUTPUT_MODE=local` (WAV sur disque) ou `AUDIO_OUTPUT_MODE=stt` (transcription via Voxtral batch HTTP) → `/session transcribe` (transcription post-séance des WAV locaux, avec export `transcript.txt`) → SQLite logging (sessions + transcript_lines) → Mistral API LLM → basic orchestration (music + image) → GM Dashboard
- **Phase 2**: Speaker diarization, keyword triggers, `/scene` commands, OBS WebSocket, session summaries
- **Phase 3**: Local STT (Whisper microservice), local LLM (Ollama), semantic asset search

Do not implement Phase 2 or 3 features during Phase 1 work unless explicitly asked.

`packages/context-manager`, `packages/llm-agent`, `apps/orchestrator` and `apps/gm-dashboard` now exist
as standalone, independently tested units (Phase 1 scope), but are **not wired together end-to-end**:
nothing in `discord-bot` calls `context-manager` yet, `context-manager` isn't connected to `llm-agent`,
and nothing calls the orchestrator's `POST /actions` in real conditions. That wiring (an HTTP client in
`discord-bot`, a polling/keyword trigger loop per ADR-004, and failure handling for that chain) is a
deliberately separate, not-yet-done task — don't assume the pipeline is live just because the pieces exist.

---

## Testing Strategy

- Unit tests for: context-manager state transitions, Zod schema validation, asset library search
- Integration tests for: STT client (mocked API), LLM agent (mocked API), orchestrator dispatch
- No tests for: Discord.js internals, third-party API behavior, the `gm-dashboard` React UI (Vite app,
  not covered by `pnpm -r test` — verified manually / via `vite build` only)
- Test files colocated with source: `src/context-manager.test.ts`
- Use `vitest` with `@vitest/coverage-v8`
- Existing Phase 1 coverage (as of this note): PCM→WAV conversion, WAV sorting/transcription in
  `post-session-transcriber.ts`, STT 429 retry/backoff + `Retry-After` handling, orphaned session
  recovery (`recoverOrphanedSession`), session-manager start/stop/reconnect transitions, STT response
  Zod validation, context-manager state transitions/events, llm-agent prompt building + AgentError
  cases (invalid JSON, schema failure, timeout, retry), orchestrator action dispatch/dedup + HTTP layer
  (`state.test.ts`, `server.test.ts`). Run `pnpm -r build` before `pnpm -r test` after touching a
  `packages/*` source file — tests resolve `@rpg-assistant/*` workspace imports through `dist/`, not `src/`.

---

## Common Pitfalls

- **Do not** call the LLM on every audio chunk — buffer transcriptions until a sentence boundary or silence gap
- **Do not** store raw audio to disk — transcribe in memory and discard
- **Do not** expose the orchestrator HTTP port publicly — it's localhost only
- **STT batch vs realtime**: use `voxtral-mini-latest` with `POST /v1/audio/transcriptions`; do not configure a realtime/WebSocket model for this endpoint. The Zod env schema (`index.ts`) rejects any `STT_MODEL` containing `realtime` at startup.
- **STT rate limits**: post-session transcription spaces requests and retries HTTP 429 responses with exponential backoff, honoring `Retry-After`
- **Post-session export**: `/session transcribe` writes `transcript.txt` beside the WAV files and also persists transcript lines in SQLite
- **Idempotent retranscription**: each `transcript_lines` row is keyed by `(session_id, source_file)` via a partial unique index (real-time lines have `source_file = NULL` and are unaffected). Re-running `/session transcribe` skips files already transcribed instead of re-calling the STT API and duplicating rows — see `TranscriptRepository.existsBySessionAndSourceFile`.
- **Real-time dispatch errors**: `session-manager.ts` never fires-and-forgets `dispatchAudioSegment()` — rejections are caught, logged, and counted (`sessionManager.getDispatchFailureCount()`, surfaced in `/session status`). Keep this pattern for any other async work triggered from voice event handlers.
- **Config validation**: all `apps/discord-bot` env vars (including `AUDIO_OUTPUT_MODE`, `DB_PATH`, and the conditional `MISTRAL_API_KEY` requirement) are validated once via Zod in `index.ts` before `bot.ts` is imported. Downstream modules (`audio-output.ts`, `database.ts`) trust `process.env` because of this ordering — do not re-validate ad hoc.
- **`RECORDINGS_DIR`/`DB_PATH` are resolved against `process.cwd()`**, which differs between `pnpm dev:bot` (cwd = `apps/discord-bot/`) and Docker (cwd = `/app`, bind-mounted/volumed to the repo root). A session recorded in one environment is invisible to the bot in the other — always check the `📁 Répertoire d'enregistrements : …` startup log to know where a given run actually reads/writes. See README § "Chemins de stockage : local vs Docker".
- **`ContextManager` states are single-use**: `ENDED` is terminal by design (matches the state diagram above) — do not try to `start()` the same instance again for a new session; construct a new `ContextManager()` instead, mirroring how `session-manager.ts` creates a new `Session` object per `/session start`.
- **`AgentResponseSchema` lives in `packages/llm-agent`**, not `shared-types` — `shared-types` only has the plain `AgentResponse`/`AgentAction` TS types (no Zod dependency, per its "zero runtime dependencies" rule). Both `llm-agent` (parsing the LLM's raw JSON) and `apps/orchestrator` (validating `POST /actions` bodies) import and reuse the same schema — don't duplicate it.
- **`apps/orchestrator` binds to `127.0.0.1` explicitly** in `index.ts` — never change this to `0.0.0.0` or an external interface; this API must stay local-only per the privacy requirements above.
- **Orchestrator dedup is per-action-type equality + a time window** (`DEDUP_WINDOW_MS`, default 4000ms), not a global request dedup — a `music` action and a `gm_tip` action in the same `AgentResponse` are deduped independently against their own last-dispatched state (see `apps/orchestrator/src/handlers.ts`).
- **`GET /transcript/recent` on the orchestrator reads the same SQLite file as `discord-bot`** via `@rpg-assistant/db` (read-only from this process) — it does **not** go through `AgentResponse`, which has no transcript field. Requires the orchestrator's own `DB_PATH` env var to point at the same file; returns 503 if unset.
- **`apps/gm-dashboard` is a standalone Vite app**: its `tsconfig.json` intentionally does **not** extend `tsconfig.base.json` (that one targets CommonJS with no DOM lib, wrong for a Vite/React app), and it's excluded from the `tsc`-based mental model of "build = compile" — its `build` script is `vite build`, not `tsc`. It also reads `import.meta.env.VITE_ORCHESTRATOR_URL`, which must live in `apps/gm-dashboard/.env.local` — **Vite does not read the monorepo-root `.env`**.