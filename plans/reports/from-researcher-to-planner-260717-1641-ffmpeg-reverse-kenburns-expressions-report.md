# FFmpeg reverse Ken Burns + static mode — research report

Scope: pure research, no code changed. Sources: `ffmpeg.org/ffmpeg-filters.html` mirrored via
`doc/filters.texi` (FFmpeg master, github.com/FFmpeg/FFmpeg), `libavfilter/vf_zoompan.c` and
`libavfilter/avfilter.c` (FFmpeg master source, read directly), plus secondary blog sources
cross-checked against source.

Current code read: `content-extractor/lib/kenburns.ts` (full, 142 lines),
`content-extractor/scripts/render-video.mts:150-200`, `content-extractor/lib/ffmpeg.ts:85-116`
(`renderShot` — confirms input is `-loop 1 -framerate fps -i image`, output capped by `-t durationSec`,
`-r fps`).

## Q1 — Reverse pan: `'base+travel*(1-t/dur)'`

**Verdict: correct and safe. High confidence.**

`crop`'s `x`/`y` expressions support variable `t` = "timestamp expressed in seconds", evaluated
per-frame (`filters.texi` §crop, official docs — I fetched the source `.texi` from FFmpeg master,
not a scraped summary). Flipping `t/dur` → `1-t/dur` is the correct, minimal reversal:

- pan-v forward: `y` goes `base → base+travel` (small→large y = window slides down = "lia xuống").
  Reverse: `y` goes `base+travel → base` (large→small y = window slides up = "lia lên"). ✓ matches
  requested semantics exactly.
- pan-h: same transform on `x`, "phải → trái".

**Gotchas checked, none new for reverse:**
- Docs explicitly state: *"If the evaluated value is not valid, it is approximated to the nearest
  valid value"* — ffmpeg auto-clamps out-of-range `x`/`y`, so any float edge-case (e.g. `1-t/dur`
  dipping slightly below 0 from FP rounding) self-heals. This safety net applies identically to
  forward and reverse — not a new risk.
- Last-frame undershoot: with `-loop 1 -framerate fps -i img` + `-t dur`, output frame count ≈
  `round(dur*fps)`, so the last frame's `t = (frames-1)/fps < dur`. This means the forward version
  never quite reaches `t/dur = 1` (travel never 100% completes on last frame), and by symmetry the
  reverse version never quite reaches `1-t/dur = 0` either. This is a **pre-existing** minor
  undershoot in the current forward code, not something reversal introduces or worsens — no change
  needed to compensate for it unless you want to fix both directions together.

Concrete patch shape (for planner, not applied):
```
const frac = reverse ? `(1-t/${dur.toFixed(3)})` : `(t/${dur.toFixed(3)})`;
const y = travelPx > 0 ? `'${basePx}+${travelPx}*${frac}'` : String(basePx ?? 0);
```

## Q2 — Reverse zoom (zoom-out) in zoompan with `d=1` + `on`

**Verdict: `z='Z-(Z-1)*on/(frames-1)'` is correct. High confidence — verified via source, not just docs.**

Official semantics (`filters.texi` §zoompan): `on` = "Output frame count", zoom range clamped to
1–10. I traced the actual C source (`libavfilter/vf_zoompan.c` + `libavfilter/avfilter.c`,
FFmpeg master) to confirm `on` is **0-indexed**, not inferred from "it must already work in prod":
- `vf_zoompan.c:175/289`: `var_values[VAR_ON] = outl->frame_count_in;` — read *before* the current
  frame is pushed downstream.
- `avfilter.c:1107` (`ff_filter_frame_framed`): `li->l.frame_count_in++` fires when a frame is
  queued into a link — i.e. incremented *after* each previous frame was pushed via
  `ff_filter_frame(outlink, out)`.
- Net effect: frame 1 reads `on=0` (nothing pushed yet), frame 2 reads `on=1`, ..., frame `frames`
  reads `on=frames-1`. This exactly matches what the existing forward formula
  `1+(Z-1)*on/(frames-1)` assumes (on=0 → z=1, on=frames-1 → z=Z). Confirmed by reading the
  scheduling code, not by trusting that shipped code "must be right."

Reverse is the same "flip the fraction" transform as Q1 — swap `on/(frames-1)` for
`1-on/(frames-1)`:
```
z = Z - (Z-1)*on/(frames-1)   // equivalent to 1+(Z-1)*(1-on/(frames-1))
```
At `on=0`: `z=Z` (start fully zoomed). At `on=frames-1`: `z=1` (end at no zoom). Matches "zoom-out
(Z→1)" requirement.

**Known jitter/wobble gotcha — applies equally to zoom-in and zoom-out, not worse for reverse:**
- Read directly in `vf_zoompan.c` (`output_single_frame`): `w = in->width * (1.0/zoom)` is computed
  into an `int` (implicit truncation, not rounding), then `x`/`y` are `av_clipd`'d and bit-masked to
  chroma subsampling boundaries (`x &= ~((1<<log2_chroma_w)-1)`). Because the crop window `w`×`h`
  is re-truncated to an integer every frame and then `sws_scale`d to a *fixed* output size, the
  effective magnification hops in small discrete steps frame-to-frame instead of changing smoothly
  → visible jitter/wobble. This mechanism is direction-agnostic: it depends on `zoom` changing at
  all, not on which way it changes. So reverse (zoom-out) is not inherently worse than the existing
  forward path, and the codebase's existing mitigation (supersample scale ×2 before `zoompan`,
  already in `kenburns.ts:126,138`) applies identically — no extra work needed for the reverse case,
  just reuse the same `×2` pre-scale.
- Secondary corroboration (medium confidence — blog, not primary, but *matches* the source-level
  mechanism above almost verbatim): datarecoveryunion.com and usercomp.com both independently
  describe "zoompan rounds x/y, upscaling resolution beforehand shrinks the rounding error" as the
  known fix.
- FFmpeg trac ticket #4298 ("avfilter/vf_zoompan: fix shaking when zooming", referenced by a
  `ffmpeg-devel` patch mail) was found only via a search-result snippet — the ticket page itself
  is bot-blocked (Anubis) and I could not read it directly. Treat this citation as weaker/unverified
  corroboration only; the load-bearing evidence for the jitter mechanism is the source-code trace
  above, done against the **current** FFmpeg master (i.e. the truncation behavior still exists
  in-tree today, patch or no patch).
- Do **not** use the tutorial idiom `z='if(eq(on,1),Z,zoom-step)'` (self-referential, depends on
  previous frame's `zoom`) — several blogs (mko.re, forum posts) use this for zoom-out, but it's a
  different, fragile pattern (speed depends on `d`, accumulates FP error). The codebase's existing
  `on/(frames-1)` approach is a closed-form, non-self-referential expression and should stay that
  way for both directions — simpler and not subject to that idiom's known issues.

## Q3 — Static mode: cheapest correct way to get a still frame

**Recommendation: do NOT use `zoompan` with `z=1`. Reuse existing crop/scale plumbing instead. Medium-high confidence (reasoning from code + docs, not a dedicated external source since this is a codebase-fit judgment call).**

Two sub-cases, both already representable with **zero new filter primitives**:

1. **No blur-fill needed** (aspect matches region): this is just the pan-v/pan-h code path with
   `travelPx=0` — which `kenburns.ts` **already implements** as a degenerate case:
   `(plan.travelPx ?? 0) > 0 ? <expr> : String(plan.basePx ?? 0)`. A `static` mode can literally
   reuse this branch (or the plain zoom branch with `zoomTarget=1`, same effect, one `scale`,
   one static `crop`, no `zoompan` at all).
2. **Blur-fill needed** (aspect mismatch, region relatively square/off-ratio): reuse the *existing*
   `bg` line unchanged (`scale=W:H:force_original_aspect_ratio=increase,crop=W:H,boxblur=20:1`,
   already in `kenburns.ts:137`), and for `fg` drop `zoompan` entirely — just
   `scale=${fw}:${fh}` (no `×2` supersample needed, no `d=1`, no `zoompan`) since a single constant
   scale operation has no frame-to-frame rounding drift to jitter from (there's nothing changing
   between frames — sws_scale runs once conceptually, same output every frame).

Why not `zoompan` with constant `z=1`: it still routes every output frame through `zoompan`'s
per-frame `sws_scale` + chroma-masked integer crop math for zero benefit — extra filter-graph
complexity and one more thing that could misbehave (e.g. if `zoomTarget` accidentally isn't exactly
`1.0` due to float formatting via `.toFixed(4)`, you'd get an unintended micro-zoom). Plain `scale`
is the standard, best-tested ffmpeg idiom for "fit/cover to frame" (already used for the `bg` layer
in this same file) — fewer moving parts, same output, no new risk surface. This is a YAGNI call:
`zoompan` exists in this file specifically to animate `z` over time; when there's no animation,
skip the filter that exists to animate.

Both sub-cases still need the `even()` helper for `fw`/`fh` (yuv420p requires even dimensions) —
this requirement is unchanged by dropping `zoompan`, not a new risk either way.

**Note for planner — `reverse` × `static` interaction:** `reverse` has no meaning for `mode:
'static'` (there is no direction to invert on a still frame). Treat `reverse` as a no-op when
`mode === 'static'` — either ignore the flag silently or make it a validation error; either is fine,
just decide explicitly so it isn't a silent footgun in `planKenburns`'s return type.

## Q4 — Verifying the direction actually reversed

**Cheapest first check (do this before rendering anything): unit-test the string.** `kenburns()` is
a pure function returning a filtergraph string — assert the reversed output contains
`(1-t/...)` (pan) or the flipped zoom formula, and that the non-reversed path is byte-identical to
before (regression safety). No `ffmpeg` binary needed for this tier.

**Rendered-frame check (macOS, copy-paste):**
```bash
# 1. Render a short single shot with the filter under test (reuse renderShot()'s own ffmpeg call,
#    or run the filtergraph manually against a test image):
ffmpeg -y -loop 1 -framerate 30 -i test.jpg -filter_complex "$FILTER" -map '[v]' -t 3 -r 30 \
  -c:v libx264 -preset veryfast -pix_fmt yuv420p shot.mp4

# 2. Extract first and last frame as PNGs:
ffmpeg -y -i shot.mp4 -vf "select=eq(n\,0)" -vframes 1 first.png
ffmpeg -y -sseof -1 -i shot.mp4 -update 1 -q:v 2 last.png   # seeks ~1s before EOF, grabs last frame

# 3. Open both in Claude Code's Read tool (it renders images) to visually confirm
#    top-vs-bottom (pan-v) / left-vs-right (pan-h) / zoomed-in-vs-out (zoom) content swapped
#    correctly between first.png and last.png relative to the forward version.
```
`-sseof -1` assumes shot ≥ ~1s; for very short shots use `-sseof -0.1` or extract all frames via
`ffmpeg -i shot.mp4 frame_%04d.png` and diff the first vs. last file (simplest for shots with few
frames, generates one file per frame — fine for a one-off manual check, not for CI).

**Optional numeric sanity check (debug-only, remove before shipping):** append a `drawtext` stage
that prints the live evaluated expression on-screen via ffmpeg's `expr_int_format`
(`%{eif:EXPR:d}`) function (confirmed present in `filters.texi` §drawtext, e.g.
`fontcolor_expr=...%{eif\: <expr> \: x \: 2}` pattern in the docs' own example) — lets you literally
read the computed `y`/`z` value per frame instead of eyeballing pixels. Escaping is fiddly (nested
filter needs backslash-escaped colons/commas) so treat as a throwaway debug aid, not something to
merge.

## Unresolved / not covered
- Did not independently render test clips myself — task asked for verification *commands to hand to
  the implementer*, not a pre-verified render (kept research-only per instructions).
- FFmpeg trac ticket #4298 content unverified (bot-blocked); relied on direct source trace instead,
  which is the stronger evidence anyway.
- Did not check whether the project's pinned ffmpeg binary version differs materially from current
  `master` source read here — behavior for `crop`/`zoompan` variable semantics has been stable
  across ffmpeg 4.x–7.x per changelogs skimmed during search, but this wasn't independently pinned
  down version-by-version.

Status: DONE
Summary: Reverse pan/zoom both reduce to flipping the time/frame fraction `f → (1-f)` in the existing linear expressions (verified against `crop`/`zoompan` docs and, for the `on` 0-indexing claim, directly against FFmpeg's C source); zoompan jitter mechanism is direction-agnostic so existing ×2 supersample mitigation covers zoom-out too; static mode should bypass `zoompan` entirely and reuse existing scale/crop plumbing rather than use `z=1`.
Concerns/Blockers: none blocking — see Unresolved section for minor gaps (trac ticket unread, ffmpeg version-pinning not checked).
