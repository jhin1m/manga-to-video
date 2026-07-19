#!/usr/bin/env python3
# Harness parity Phase 5 (Gate nghiệm thu #2): đo shake bằng phase-correlation FFT giữa
# frame liên tiếp — displacement sub-pixel. Gate: p95 video Python ≤ 1.1 × p95 baseline TS.
# Chạy: ~/.claude/skills/.venv/bin/python3 tools/parity-port/measure_shake.py \
#         --video X.mp4 --timeline X.timeline.json [--windows 3] [--label ten]
#
# Phương pháp: chọn N cửa sổ segment từ timeline (trim 0.3s hai đầu), extract frame PNG
# bằng ffmpeg, gray hoá, center-crop 75% + Hann window, phase-correlation → shift đỉnh
# + nội suy parabol sub-pixel. Zoom vào tâm có translation ≈ 0 → displacement đo được
# chính là jitter (shake).

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image

FFMPEG = "/opt/homebrew/bin/ffmpeg"


def extract_frames(video: Path, start: float, dur: float, fps: int, out_dir: Path) -> list[Path]:
    out_dir.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        [FFMPEG, "-y", "-v", "error", "-ss", f"{start:.3f}", "-t", f"{dur:.3f}",
         "-i", str(video), "-vf", f"fps={fps}", str(out_dir / "f-%04d.png")],
        check=True, capture_output=True,
    )
    return sorted(out_dir.glob("f-*.png"))


def load_gray_windowed(path: Path) -> np.ndarray:
    im = np.asarray(Image.open(path).convert("L"), dtype=np.float64)
    h, w = im.shape
    # center-crop 75% — giảm ảnh hưởng biên (blur-fill/expansion của zoom)
    ch, cw = int(h * 0.75), int(w * 0.75)
    y0, x0 = (h - ch) // 2, (w - cw) // 2
    im = im[y0 : y0 + ch, x0 : x0 + cw]
    win = np.outer(np.hanning(im.shape[0]), np.hanning(im.shape[1]))
    return (im - im.mean()) * win


def phase_correlation_shift(f1: np.ndarray, f2: np.ndarray) -> tuple[float, float]:
    """Shift (dy, dx) sub-pixel giữa 2 frame — đỉnh cross-power spectrum + parabol fit."""
    F1 = np.fft.fft2(f1)
    F2 = np.fft.fft2(f2)
    cross = F1 * np.conj(F2)
    cross /= np.abs(cross) + 1e-12
    r = np.real(np.fft.ifft2(cross))
    peak = np.unravel_index(np.argmax(r), r.shape)
    h, w = r.shape

    def subpixel(axis_vals: np.ndarray, idx: int, n: int) -> float:
        # nội suy parabol quanh đỉnh (wrap-around)
        c = axis_vals[idx]
        left = axis_vals[(idx - 1) % n]
        right = axis_vals[(idx + 1) % n]
        denom = 2 * c - left - right
        offset = 0.5 * (right - left) / denom if abs(denom) > 1e-12 else 0.0
        pos = idx + offset
        return pos - n if pos > n / 2 else pos

    dy = subpixel(r[:, peak[1]], peak[0], h)
    dx = subpixel(r[peak[0], :], peak[1], w)
    return dy, dx


def measure_windows(video: Path, timeline: dict, n_windows: int, fps: int) -> dict:
    segments = timeline["segments"]
    # Chọn segment trải đều, đủ dài (≥ 1.6s sau khi trim 0.3s hai đầu)
    usable = [s for s in segments if (s["end"] - s["start"]) >= 2.2]
    if not usable:
        usable = segments
    step = max(1, len(usable) // n_windows)
    chosen = usable[::step][:n_windows]

    all_disp: list[float] = []
    per_window = []
    with tempfile.TemporaryDirectory() as td:
        for i, seg in enumerate(chosen):
            start = seg["start"] + 0.3
            dur = min(seg["end"] - 0.3 - start, 4.0)
            frames = extract_frames(video, start, dur, fps, Path(td) / f"w{i}")
            grays = [load_gray_windowed(p) for p in frames]
            disp = []
            for a, b in zip(grays, grays[1:]):
                dy, dx = phase_correlation_shift(a, b)
                disp.append(float(np.hypot(dy, dx)))
            all_disp.extend(disp)
            per_window.append({
                "segId": seg.get("segId", f"w{i}"), "start": round(start, 2), "dur": round(dur, 2),
                "frames": len(frames), "median": round(float(np.median(disp)), 4),
                "p95": round(float(np.percentile(disp, 95)), 4),
            })
    return {
        "windows": per_window,
        "n_samples": len(all_disp),
        "median": round(float(np.median(all_disp)), 4),
        "p95": round(float(np.percentile(all_disp, 95)), 4),
        "max": round(float(np.max(all_disp)), 4),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Đo shake video bằng phase-correlation")
    parser.add_argument("--video", required=True, type=Path)
    parser.add_argument("--timeline", required=True, type=Path)
    parser.add_argument("--windows", type=int, default=3)
    parser.add_argument("--fps", type=int, default=30)
    parser.add_argument("--label", default="")
    args = parser.parse_args()

    timeline = json.loads(args.timeline.read_text())
    result = measure_windows(args.video, timeline, args.windows, args.fps)
    label = args.label or args.video.name
    print(f"=== Shake: {label} ===")
    for w in result["windows"]:
        print(f"  {w['segId']}: start {w['start']}s dur {w['dur']}s "
              f"({w['frames']} frame) median {w['median']} p95 {w['p95']}")
    print(f"→ TỔNG ({result['n_samples']} mẫu): median {result['median']}px | "
          f"p95 {result['p95']}px | max {result['max']}px")
    print(json.dumps({"label": label, **{k: result[k] for k in ('median', 'p95', 'max', 'n_samples')}}))


if __name__ == "__main__":
    main()
