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
  orchestrator/       Receives JSON action payloads, dispatches to subsystems
  gm-dashboard/       React web UI for the Game Master (images, music, tips)
  session-summarizer/ Post-session summary and next-session prep generator

packages/
  stt-client/         Abstraction over STT backends (Voxtral API / Whisper local)
  llm-agent/          Abstraction over LLM backends (Mistral API / Ollama)
  context-manager/    Session state machine (scene, mood, active music, history)
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
- **Runtime**: Node.js 20+ (LTS)
- **Package manager**: pnpm with workspaces
- **Discord**: discord.js v14 + @discordjs/voice
- **STT (Phase 1-2)**: Voxtral API (Mistral); fallback: OpenAI Whisper API
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

- **Phase 1 (MVP)**: Discord bot audio capture → Voxtral API STT → Mistral API LLM → basic orchestration (music + image) → GM Dashboard → SQLite logging
- **Phase 2**: Speaker diarization, keyword triggers, `/scene` commands, OBS WebSocket, session summaries
- **Phase 3**: Local STT (Whisper microservice), local LLM (Ollama), semantic asset search

Do not implement Phase 2 or 3 features during Phase 1 work unless explicitly asked.

---

## Testing Strategy

- Unit tests for: context-manager state transitions, Zod schema validation, asset library search
- Integration tests for: STT client (mocked API), LLM agent (mocked API), orchestrator dispatch
- No tests for: Discord.js internals, third-party API behavior
- Test files colocated with source: `src/context-manager.test.ts`
- Use `vitest` with `@vitest/coverage-v8`

---

## Common Pitfalls

- **Do not** call the LLM on every audio chunk — buffer transcriptions until a sentence boundary or silence gap
- **Do not** store raw audio to disk — transcribe in memory and discard
- **Do not** expose the orchestrator HTTP port publicly — it's localhost only
- **Do not** trust LLM JSON output without Zod validation — models can hallucinate invalid structures
- **Do not** hardcode asset paths — use the asset library index (SQLite)
- **Always** handle Discord voice connection drops with exponential backoff reconnect


Note : à l'avenir, utilise PowerShell (et non WSL) pour les commandes pnpm install/pnpm add sur ce projet. Les deux environnements peuvent coexister pour le reste (WSL pour les scripts, PowerShell pour la gestion des packages).