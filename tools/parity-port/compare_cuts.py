#!/usr/bin/env python3
# Harness parity Phase 3 (Gate nghiệm thu #1): so điểm cắt band Python vs baseline TS.
# Chạy: ~/.claude/skills/.venv/bin/python3 tools/parity-port/compare_cuts.py
#
# 3 mode chạy tuần tự, cô lập dần nguồn sai lệch:
#   A. split-on-ts-canvas : split Python trên CHÍNH stitched.png của TS
#                           → cùng pixel, phải khớp TUYỆT ĐỐI (0px) — chứng minh thuật toán đúng.
#   B. stitch-from-ts-jpegs: PIL decode downscaled JPEG của TS → stitch Python → split
#                           → thêm biến JPEG decode + stitch; kỳ vọng 0px (libjpeg-turbo 2 bên).
#   C. full-pipeline      : corpus gốc → downscale PIL (re-encode JPEG q80) → stitch → split
#                           → thêm biến JPEG ENCODE (PIL vs sharp); gate PASS nếu |Δ| ≤ 2px.

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

SKILL_SCRIPTS = Path.home() / ".claude" / "skills" / "manga-to-video" / "scripts"
sys.path.insert(0, str(SKILL_SCRIPTS))

from mtv.ingest_core import ingest_canvas, list_folder_images  # noqa: E402
from mtv.smart_split import SplitSettings, split_gray, to_gray  # noqa: E402

BASELINE_DIR = Path(__file__).resolve().parent / "baseline"
TOLERANCE_PX = 2


def region_boundaries(regions: list[dict]) -> list[int]:
    """Band regions → danh sách y biên nội bộ (điểm cắt CUỐI sau merge)."""
    return [r["y"] for r in regions[1:]]


def compare(label: str, py_regions: list[dict], baseline: dict, tolerance: int) -> bool:
    ts_regions = baseline["regions"]
    py_bounds = region_boundaries(py_regions)
    ts_bounds = region_boundaries(ts_regions)
    ok = True
    print(f"\n=== {label} ===")
    print(f"Band: TS={len(ts_regions)} / Py={len(py_regions)}", end="")
    if len(ts_regions) != len(py_regions):
        print("  ❌ SỐ BAND KHÁC NHAU")
        print(f"  TS bounds: {ts_bounds}\n  Py bounds: {py_bounds}")
        return False
    print()
    print(f"{'#':>3} {'y_TS':>7} {'y_Py':>7} {'Δ':>4}")
    for i, (t, p) in enumerate(zip(ts_bounds, py_bounds)):
        delta = abs(t - p)
        flag = "" if delta <= tolerance else "  ❌"
        if delta > tolerance:
            ok = False
        print(f"{i:>3} {t:>7} {p:>7} {delta:>4}{flag}")
    max_d = max((abs(t - p) for t, p in zip(ts_bounds, py_bounds)), default=0)
    print(f"→ {label}: {'PASS' if ok else 'FAIL'} (max |Δ| = {max_d}px, tolerance {tolerance}px)")
    return ok


def main() -> None:
    baseline = json.loads((BASELINE_DIR / "baseline-cuts.json").read_text())
    s = baseline["settings"]
    settings = SplitSettings(
        line_tolerance=s["lineTolerance"],
        ignorable_border=s["ignorableBorder"],
        min_gutter_height=s["minGutterHeight"],
        min_band_height=s["minBandHeight"],
        max_band_height=s["maxBandHeight"],
        min_ink_density=s["minInkDensity"],
    )
    corpus_dir = Path(baseline["source"]["dir"])
    results: dict[str, bool] = {}

    # --- Mode A: split trên chính canvas TS ---
    canvas = Image.open(BASELINE_DIR / "stitched.png")
    gray = to_gray(np.asarray(canvas))
    assert gray.shape == (baseline["stitched"]["height"], baseline["stitched"]["width"])
    results["A split-on-ts-canvas (kỳ vọng 0px)"] = compare(
        "A: split-on-ts-canvas", split_gray(gray, settings), baseline, tolerance=0
    )

    # --- Mode B: stitch Python từ downscaled JPEG của TS ---
    from mtv.stitch import stitch_slices

    jpegs = sorted((BASELINE_DIR / "downscaled").glob("*.jpg"))
    canvas_b = stitch_slices([Image.open(p) for p in jpegs])
    gray_b = to_gray(np.asarray(canvas_b))
    results["B stitch-from-ts-jpegs (kỳ vọng 0px)"] = compare(
        "B: stitch-from-ts-jpegs", split_gray(gray_b, settings), baseline, tolerance=0
    )

    # --- Mode C: full pipeline Python từ corpus gốc (GATE #1, ±2px) ---
    files = list_folder_images(corpus_dir)
    order_ok = [p.name for p in files] == baseline["source"]["files"]
    print(f"\nNatural sort khớp TS: {'✅' if order_ok else '❌'}")
    if not order_ok:
        print(f"  Py: {[p.name for p in files][:5]}...\n  TS: {baseline['source']['files'][:5]}...")
    _, _, regions_c = ingest_canvas(
        [p.read_bytes() for p in files],
        max_edge=s["maxEdge"],
        strip_ratio=s["stripRatio"],
        settings=settings,
    )
    results["C full-pipeline (GATE #1, ±2px)"] = (
        compare("C: full-pipeline", regions_c, baseline, tolerance=TOLERANCE_PX) and order_ok
    )

    print("\n===== TỔNG KẾT PARITY BANDING =====")
    for name, ok in results.items():
        print(f"  {'PASS ✅' if ok else 'FAIL ❌'}  {name}")
    sys.exit(0 if all(results.values()) else 1)


if __name__ == "__main__":
    main()
