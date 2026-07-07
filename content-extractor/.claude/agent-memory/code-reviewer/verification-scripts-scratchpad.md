---
name: verification-scripts-scratchpad
description: e2e/unit verification scripts for this repo live in session scratchpad, not the repo — gates are not reproducible later
metadata:
  type: project
---

The mock-OpenAI e2e (`e2e-storyboard.mts`, `mock-openai-vision.mjs`) and algorithm-port unit tests (`verify-phase2-banding.mts`, `verify-phase3-narration.mts`) for Stage 1.5 were written in the session scratchpad, not committed. Stage 1's mock server was also lost this way (plan validation log confirms: "mock server e2e Stage 1 nằm ở scratchpad session cũ (đã mất)").

**Why:** project philosophy keeps repo minimal; but it means "58/58 pass" claims cannot be re-verified after the session ends.
**How to apply:** when reviewing later stages, treat past e2e pass counts as unverifiable history; recommend persisting verification scripts (e.g., `scripts/` + package.json script) if regressions matter. Related: [[content-extractor-conventions]].
