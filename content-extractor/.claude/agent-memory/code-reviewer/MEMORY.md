# Memory Index

- [content-extractor conventions](project-conventions.md) — Stage 1 patterns are the de-facto standard; known systemic gaps from Stage 1.5 review; gates via Node 24 Herd nvm
- [Verification scripts in scratchpad](verification-scripts-scratchpad.md) — e2e/unit tests not committed; past pass counts unverifiable
- [Index-URL re-index staleness](image-url-reindex-staleness.md) — index-based image URLs go stale after splice/re-index unless cache-busted or keyed by stable id (storyboard uses ?v=rev; item grid doesn't)
- [Master-detail draft refresh staleness](master-detail-draft-refresh-staleness.md) — draft keyed by selected id survives background refresh; Save can wipe fresh server data (H1, UI-unification review)
- [TTS cache-key resolution invariant](tts-provider-cachekey-invariant.md) — cache key must reflect fully-resolved voice/model; CapCut resolves defaults lazily in synth(), so empty voice + CAPCUT_VOICE env serves stale audio
