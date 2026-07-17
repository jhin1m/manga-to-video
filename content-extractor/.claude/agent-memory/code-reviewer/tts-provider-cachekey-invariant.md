---
name: tts-provider-cachekey-invariant
description: TTS cache key must be computed from the FULLY-RESOLVED voice/model, not raw cfg — CapCut resolves defaults lazily inside synth(), breaking this
metadata:
  type: project
---

The disk TTS cache (`lib/tts.ts` `ttsCacheKey`) is computed in `synthSegment` from `cfg.voiceId`/`cfg.model` BEFORE `provider.synth` runs.

**Invariant:** every field that changes the produced audio must be resolved into `cfg` (and thus into the cache key) before the key is computed. ElevenLabs obeys this: `readTtsConfig` eagerly resolves `ELEVENLABS_VOICE_ID`/`MODEL` env defaults into `cfg` up front, so changing the env busts the key.

**Violation (as of 2026-07-17 CapCut provider):** `capcut.synth` resolves the effective voice lazily as `cfg.voiceId || CAPCUT_VOICE(env) || DEFAULT_VOICE`, i.e. AFTER the key is computed. So when the user leaves voice empty (UI "Giọng mặc định" → voiceId=''), the key is keyed on '' while the actual audio depends on `CAPCUT_VOICE` env. Changing that env, or a shared cache dir across projects, serves stale/wrong-voice audio on a cache HIT with no error.

**Why:** cache dir (`.cache/tts`) persists across renders on one machine; bundle handoff carries synthesized audio by segId, not by cache key, so this only bites when audio isn't bundled and the CLI re-synths.

**How to apply:** when reviewing any new TTS provider, verify the provider's default-resolution (env/constant fallbacks for voice/model/anything audio-affecting) happens where it lands in the cache key — either resolved in `readTtsConfig` (like ElevenLabs) or exposed via a provider-level resolve hook that `synthSegment` calls before `ttsCacheKey`. Related: [[project-conventions]].
