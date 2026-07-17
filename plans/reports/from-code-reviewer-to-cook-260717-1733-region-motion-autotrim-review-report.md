# Code Review — Storyboard region → motion → autotrim (plan 260717-1702)

Reviewer: code-reviewer · Date: 2026-07-17 · Scope: uncommitted diff for plan phases 1–3 only
(TTS-provider changes in the same working tree were explicitly excluded).

## Verdict: DONE_WITH_CONCERNS (no blockers)

Implementation is careful, well-scoped, and matches the plan's locked decisions. All acceptance
criteria verified. No Critical/High issues. Findings below are Low severity / informational.

## Gates run (Node 24, Herd nvm)
- `tsc --noEmit` → exit 0 (no contract break slipped through the widened signatures)
- `eslint` on all 10 plan-owned files → exit 0
- `verify-ink-bbox.mts` → PASS
- `verify-kenburns-css.mts` → PASS (reverse/static/label cases)
- `verify-script.mts` → ALL_PASS, incl. **Test 7b byte-identical gate** and region/motion clone tests
- Not run: full `next build` (task reports it already green); tsc covers type layer.

## Acceptance criteria — all confirmed
1. Region wired: `script.ts:159` no longer hardcodes `null`; copies `inputs[idx].region` (cloned).
   `script/route.ts:60` maps `beat.region`. `resolveMissingContent` preserves via `{...inp}` spread
   (verified — no silent drop). ✓
2. `motion` undefined → filtergraph byte-identical. Test 7b pins the exact literal
   `[0:v]crop=600:2400:0:0,scale=1080:-2,crop=1080:1920:0:'192+2016*(t/3.000)',setsar=1[v]`.
   Manually re-derived from `panVPlan` math — matches. `{mode:'auto'}` and `auto+reverse` also
   assert-equal to it. ✓
3. Forced modes: pan reverse only flips `(t/dur)→(1-t/dur)` (`kenburns.ts:173`); zoom reverse closed
   form `Z-(Z-1)*on/(frames-1)` (`:219-221`); static drops zoompan entirely (`:191-210`); forced pan
   drops `PAN_MAX_COVER` but keeps `PAN_MIN_COVER` and falls through to auto when infeasible
   (`:115-129`). Test 7b covers cover>3 forced-pan and pan-h fallback. ✓
4. `motion` propagates without silent drop: `toStoryboardManifest` (schema:164), `toScriptManifest`
   (schema:225), `toBeat` (store:253→toBeatDTO:263), `toScriptSegments` (script:163), `TimelineShot`
   (timeline:111), render CLI (render-video.mts:184), video preview (page:311). Import re-hydrates via
   `...b` (import/route:88) + `setScript(segments)`. ✓
5. Backward compat: `motion?` optional everywhere; `planKenburns` treats undefined/`auto` as legacy
   path. PATCH contract additive — narration/region/order unchanged; missing `motion` skipped in
   `updateBeat`. `BeatDTO extends Beat` so DTO carries it. ✓
6. `inkBBox`: gray `(299R+587G+114B)/1000`, 1% ratio threshold, pad `max(4%,14px)`, null on
   full-bleed/white, cropper scales back from 800px canvas via `1/scale`. ✓ (see L1 caveat)
7. No new lint/type errors. ✓

## Findings

### Low
- **L1 — ink-bbox padding floor lives in downscaled canvas space.** `fitToContent`
  (`region-cropper.tsx`) computes the bbox on the ≤800px canvas, then scales the whole region back by
  `1/scale`. `padMinPx=14` is therefore applied *before* the up-scale, so on a tall strip
  (scale≈0.357) the effective floor becomes ~39px in working px, not 14px. The `padPct` (4%) part
  scales correctly; only the absolute floor is inflated. Deviation from the "14px" spec, but padding
  is intentionally generous and P3 padding calibration is an open plan question. No fix required;
  flag if the padding "feels" too loose on tall bands.
- **L2 — `ctx.getImageData` has no try/catch.** If the cropper `<img>` ever becomes cross-origin
  (future CDN), `getImageData` throws a SecurityError that propagates uncaught out of the click
  handler. Currently the working image is same-origin (`?v=rev` API URL), so safe today. A
  try/catch → `toast.info` would harden it.
- **L3 — ink-bbox pathological asymmetry.** If content rows pass `rowMin` but no single column
  reaches `colMin`, the column scan leaves `left===width`, yielding a 14px sliver region at the right
  edge instead of `null`. Cannot occur on real full-bleed webtoon corpus; manual button + live
  preview + "Cả trang" undo make it low-risk. Not worth code unless a real image triggers it.
- **L4 — dropdown checkmark can land on a disabled item.** If a directional mode is forced and the
  region is later shrunk so that mode becomes infeasible, `plan.mode` falls back to auto inference and
  the chip correctly shows the fallback, but the "✓" still marks the now-disabled forced mode in the
  dropdown. Purely cosmetic; render behavior (safe auto fallback) is correct.

### Informational
- **Banner reset relies on route unmount.** `editedAfterScript` is never reset while the storyboard
  page stays mounted; regenerating the script happens on `/script/[jobId]`, so returning remounts and
  clears it. Matches the plan's accepted "banner tĩnh đủ cho v1". No false positive found (banner
  needs both `hasScript` probe true AND a post-mount edit).
- **Reverse button on `auto` freezes the inferred mode** into an explicit override + reverse. This is
  documented intended behavior, not a bug.

## Positive (risk calibration)
- The byte-identical regression gate is a real literal assertion (Test 7b), not a tautology — the
  strongest guard the plan asked for is genuinely in place and passing.
- Region and motion are cloned at every copy boundary (spread `{...region}` / `{...motion}`), with
  explicit tests asserting reference identity differs — the "sửa beat không lây sang shot" invariant
  holds.
- Forced-pan `PAN_MAX_COVER` removal is paired with a fall-through-to-auto guard, so a hand-edited
  `.mtvproj` forcing an impossible pan cannot produce an out-of-bounds crop filter.

## Unresolved questions
- None blocking. L1 (effective padding floor) may want a one-line eye check on a tall band during the
  P3 validate gate.
