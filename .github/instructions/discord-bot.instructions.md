---
description: "Use when working on apps/discord-bot: Discord voice capture, @discordjs/voice audio pipeline, slash commands, session-manager, post-session transcription."
applyTo: "apps/discord-bot/**"
---

# apps/discord-bot conventions

- Pipeline: Opus → `prism.opus.Decoder` → stereo PCM 48kHz → `stereoToMono()` → `downsample(÷3)` → 16kHz mono → `pcmToWav()`. Keep this order; STT expects 16kHz mono WAV.
- Never persist raw audio beyond the explicit `AUDIO_OUTPUT_MODE=local` dev path. Real-time `stt` mode must transcribe and discard in memory.
- `/stop` must immediately halt capture and clear in-memory audio buffers. Consent notice is posted to the text channel on every `/session start` — don't remove or make it conditional.
- `session-manager.ts` never fire-and-forgets async work triggered from voice event handlers (e.g. `dispatchAudioSegment()`): catch, log, and count failures (`getDispatchFailureCount()`, surfaced in `/session status`). Mirror this pattern for any new async work hooked into voice events.
- All env vars (including `AUDIO_OUTPUT_MODE`, `DB_PATH`, conditional `MISTRAL_API_KEY`) are validated once via Zod in `index.ts` **before** `bot.ts` is imported. Downstream modules trust `process.env` — don't re-validate ad hoc; add new vars to the same schema.
- `RECORDINGS_DIR`/`DB_PATH` resolve against `process.cwd()`, which differs between `pnpm dev:bot` (cwd = `apps/discord-bot/`) and Docker (cwd = `/app`). Check the startup log line for the actual resolved path before assuming a session file is missing.
- Idempotent retranscription: `TranscriptRepository.existsBySessionAndSourceFile` guards `(session_id, source_file)`; preserve this check in any new write path touching `transcript_lines` from this app.
- This app can import from `packages/*` but never from another `apps/*` (including `apps/orchestrator` — there is no HTTP client to it yet; that wiring is a deliberately separate task, don't assume it exists).
- After touching a `packages/*` source file this app depends on, run `pnpm -r build` before `pnpm --filter @rpg-assistant/discord-bot test` (tests resolve `@rpg-assistant/*` via `dist/`, not `src/`).
