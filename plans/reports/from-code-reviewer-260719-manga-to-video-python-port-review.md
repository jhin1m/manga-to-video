# Code Review — manga-to-video TypeScript→Python Port

Reviewer: code-reviewer (advisory only, no files changed)
Date: 2026-07-19
Scope: `~/.claude/skills/manga-to-video/**` (engine port + scripts + schemas + tests + agent),
`tools/parity-port/**` (harness), against source of truth `content-extractor/lib/*.ts` +
`scripts/render-video.mts` (read-only).
Method: line-by-line diff of every ported module vs its TS origin; ran validate smoke test
(11/11 PASS); verified git cleanliness. Did NOT re-run heavy parity/render gates (per instructions).

## Overall Assessment

The port is faithful and disciplined. The numerically-sensitive paths (band cuts, Ken Burns
filtergraph strings, SRT timing) are correct, and `js_round` is applied exactly where JS
`Math.round` semantics diverge from Python's banker's rounding. No Critical or High defects
found. No secret leakage. `content-extractor/` tracked files are clean. Findings below are
concurrency/atomicity hardening, a handful of latent `round`/`or`/`\w` inconsistencies that do
NOT currently diverge, and wording precision on acceptance criterion #1.

---

## Findings

| # | Severity | File:Line | Issue | Failure scenario |
|---|----------|-----------|-------|------------------|
| 1 | Medium | `scripts/render.py:105-107,146-197` | Working dir + output NOT namespaced by aspect/pid (regression from TS) | Two concurrent `render.py --workdir W --aspect X` and `--aspect Y` share `out/.shots` and both write `out/video.mp4`; the `finally: shutil.rmtree(shots_dir)` of the first finisher deletes shot MP4s the second run is still concatenating → corrupt/failed output. TS `render-video.mts:108-111` deliberately namespaces `.render/<jobId>-<aspect>-<pid>` and uses `output-<aspect>.mp4` for exactly this. Usage-dependent: skill's documented flow renders one aspect at a time, so likelihood is low, but the source's parallel-safety was dropped. |
| 2 | Medium/Low | `scripts/mtv/schema_defs.py:54-59` (`save_json_atomic`) | Non-unique `.tmp` suffix | tts.py (end) and render.py (end) both do load→mutate→`save_manifest`. If two processes write the same JSON path concurrently they share `<path>.tmp`: interleaved writes, or the second `os.replace` raises `FileNotFoundError` (first already moved the tmp). Contrast `tts.py:57-60 write_atomic_bytes` and `tts_capcut.py:313` which use pid/uuid suffixes, and TS `tts.ts:116 writeAtomic` (pid+counter). Sequential skill flow makes this low-likelihood, but it is the one atomic-writer in the port without a unique temp name. |
| 3 | Low | `scripts/mtv/ink_bbox.py:66-67` | Padding uses builtin `round()`, not `js_round` | TS `ink-bbox.ts:79-80` uses `Math.round(bw*padPct)`. NOT currently divergent: for integer `bw`, `bw*0.04 = bw/25` never lands on an exact `.5`, so builtin-round == Math.round. Latent inconsistency — the `js_math` helper exists precisely for this and is used elsewhere. Speculative (no reproducing input found). Not covered by any gate (ink-bbox is the skill's trim step, outside the banding/filter gates). |
| 4 | Low | `scripts/mtv/ffmpeg_cmd.py:94` | adelay `ms` uses builtin `round()`, not `js_round` | TS `ffmpeg.ts:170` uses `Math.round(startSec*1000)`. NOT currently divergent: `start_sec` is a `round3` value (×1000 → integer), so no `.5` case. Latent inconsistency only. |
| 5 | Low | `scripts/mtv/timeline.py:72` | `seg.get("duration_hint") or estimate_seconds(...)` uses `or`, TS uses `??` (`timeline.ts:99`) | Diverges only if `duration_hint == 0` while narration is non-empty. Unreachable in practice: render.py builds segments WITHOUT `duration_hint` (→ falls to `estimate_seconds`, same as TS which always sets `durationHint = estimateSeconds`), and empty narration is rejected by validate. Flag for correctness hygiene. |
| 6 | Low | `scripts/mtv/ingest_core.py:30-36` (`natural_sort_key`) | `casefold()` is case-insensitive but NOT accent-insensitive; comment claims parity with `localeCompare(sensitivity:'base')` which IS accent-insensitive | Filenames differing only by accent (e.g. `á` vs `a`) can sort in a different order than TS → different slice reading order → whole-video sequence differs. Corpus order was verified equal in gate #1 (`compare_cuts.py` `order_ok`), so latent for other inputs only. Speculative. |
| 7 | Low | `scripts/mtv/ffmpeg_cmd.py:153` (`burn_subs`) | `re.sub(r"[^\w ...]")` — Python `\w` is Unicode-aware (keeps accented/CJK letters); TS `\w` is ASCII-only | Python keeps MORE characters in the font name than TS. NOT a security issue — the force_style-breaking chars (`' : , \`) are still stripped in both. Cosmetic parity divergence; default font `Be Vietnam Pro` is ASCII → identical output in practice. |
| 8 | Low | `scripts/mtv/tts_capcut.py:40-42` | `SEED_DEVICE_PATH` hardcodes `~/Desktop/ducanh-project/manga-to-video/content-extractor/.cache/...` inside a portable skill | On another machine / moved project the seed silently fails (caught) and a fresh random device identity is generated — functionally safe, but couples the skill to one developer's directory layout. Consider making it env-overridable or dropping the seed. |

## Informational (not defects)

- **Acceptance criterion #1 wording.** `compare_cuts.py` runs mode A (split on TS canvas, 0px) and
  mode B (stitch from TS JPEGs, 0px) at tolerance 0, but **mode C (full pipeline — the real
  end-to-end Python path) uses `TOLERANCE_PX = 2`**. So "cuts Python = TS 0px on 3 modes" is
  imprecise: the real pipeline is validated at ≤2px, which is the band that absorbs the
  PIL-vs-sharp JPEG-encode + resize-rounding divergence (`ingest_core.py:65-71` uses builtin
  `round()` and PIL LANCZOS/JPEG q80 — genuinely different pixels than sharp). For a *different*
  corpus the ±2px drift could in principle push a gutter across `min_gutter_height` and change the
  band count; the port comments acknowledge this. No action needed, but do not treat mode C as
  byte-exact.
- **`region_ink_density` (`smart_split.py:139`)** divides by `(w*h)`; Python raises
  `ZeroDivisionError` on `h==0` where JS yields `NaN`. Unreachable — `choose_cuts` never emits a
  zero-height region (`cut_y > current_y` always, final band `h = height - lastCut > 0`).
- **`srt_time` ms==1000** (4-digit ms) is theoretically possible if the fractional part rounds up;
  present *identically* in TS and Python and unreachable for `round3` values → not a port divergence.
- **`note` field contract.** Agent file says "note chỉ khi thật sự đáng lưu ý"; schema requires
  `note` present. Resolved by `references/schema.md` ("note: '' nếu không có gì", agent reads it) and
  by validate.py failing hard (rule `schema`) → orchestrator re-spawns. Acceptable; residual risk a
  sonnet agent omits the key, but it cannot pass silently.
- **Path composition.** `content_path(workdir, sid)` and audio cache keys build paths from
  `slice_id`/`seg_id`. These are schema-constrained (`^[0-9]{3}$`, `^seg-[0-9]{3}$`) and slice ids
  originate from `ingest.py` (`f"{i:03d}"`), not user input, so no path traversal. `manifest.slices[].id`
  is used in `validate_content` before its own schema check, but the manifest is skill-generated on
  the user's own machine — not a real trust boundary. Local CLI skill: no network-exposed authz surface.

## Positive Observations (risk calibration)

- **`js_round` applied exactly where it matters.** Verified `even()` (`kenburns.py:33-35`): `n=5 →
  js_round(2.5)*2 = 6`, whereas builtin `round(2.5)=2 → 4` would diverge — correctly uses `js_round`.
  Same for `round3` and `srt_time`. This is the discriminating case and it is right.
- **Cache-key parity exact** (`tts.py:48-54`): elevenlabs keeps the legacy no-prefix
  `sha256(text\0voice\0model)`; other providers add a `provider\0` prefix — byte-for-byte matches
  `tts.ts:50-61`. UTF-8 encoding matches Node's default `update(string)`.
- **No secret leakage** (criterion c): elevenlabs API key travels only in the `xi-api-key` header,
  never in URL or any exception message (`tts_elevenlabs.py:36-43`); CapCut uses no API key;
  `secrets.py` never prints values; `tts.py:132-133` `fail("synth-error", str(err))` surfaces only
  HTTP-status/network messages (no key).
- **`with_retry` / `is_retryable` parity** exact vs `vision.ts:93-119` (429/5xx/no-status retry,
  `retryable=False` short-circuit, backoff `500*2^n + rand*250` ms).
- **git cleanliness (criterion e) confirmed**: `content-extractor/` tracked files unchanged; only
  the 3 pre-existing untracked `output-16x9.*` artifacts. Root `.gitignore` change only ignores
  parity binary artifacts (`baseline/stitched.png`, `baseline/downscaled/`).
- **Smoke test is behavioral, not phantom**: each fail fixture asserts exactly-one-error with the
  discriminating rule; 11/11 PASS on this run.

## Recommended Actions (priority order)

1. (Medium) If concurrent multi-aspect render on one workdir is ever intended, namespace
   `shots_dir` and the final output by aspect (and/or pid), mirroring `render-video.mts:108-111`.
   Otherwise document "one render per workdir" as a hard constraint.
2. (Medium/Low) Give `save_json_atomic` a unique temp suffix (pid+uuid), matching the other
   atomic writers, to make manifest updates safe under any accidental concurrency.
3. (Low) For consistency, route `ink_bbox` padding and `build_audio_track` adelay ms through
   `js_round`, and switch `timeline.py:72` `or` → an explicit `None` check — none change current
   output but they remove latent traps if inputs widen.
4. (Low) Make `tts_capcut.SEED_DEVICE_PATH` env-overridable (or drop it) to decouple the skill
   from a specific machine path.
5. (Doc) Amend the criterion-#1 note to "mode A/B 0px, mode C ≤2px" so future maintainers don't
   assume the real pipeline is byte-exact.

## Metrics

- Type coverage: N/A (Python, no type checker enforced; modules use PEP 604 hints throughout).
- Test coverage: parity-focused — validate smoke (11 cases), cuts parity harness (3 modes),
  filter parity (10 cases), shake measure, plus one A-Z pilot. No unit tests for
  timeline/kenburns/smart_split beyond the parity harness; tts/render orchestration covered only by
  the real-synth + pilot gates.
- Linting issues: none run (advisory scope); code is clean/consistent by inspection.

## Unresolved Questions

- Is concurrent render on a single workdir (finding #1) an intended use case, or is "one render per
  workdir" acceptable to document as a constraint?
- Should the port aim for byte-exact mode-C banding on arbitrary corpora, or is ≤2px the accepted
  contract? (Affects whether the PIL/sharp JPEG divergence needs mitigation.)
