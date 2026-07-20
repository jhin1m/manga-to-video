#!/usr/bin/env python3
# Harness parity: in region các mảnh mà shot_split.py cắt ra từ CÙNG corpus với
# dump-shot-split.mts — diff hai output phải byte-identical.
# Chạy: ~/.claude/skills/.venv/bin/python3 tools/parity-port/compare_shot_split.py

from __future__ import annotations

import os
import sys
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path.home() / ".claude" / "skills" / "manga-to-video" / "scripts"))

from mtv.shot_split import read_shot_split_settings, split_shot  # noqa: E402
from mtv.smart_split import to_gray  # noqa: E402

SLICES = Path(
    os.environ.get(
        "SHOT_SPLIT_CORPUS",
        "/Users/jhin1m/Downloads/Standard of Reincarnation/.mtv/workdirs/"
        "Read Standard of Reincarnation Chapter 1 Online - ToonGod/slices",
    )
)

# Pin tường minh — khớp dump-shot-split.mts.
os.environ.setdefault("SHOT_MAX_HEIGHT", "1100")
settings = read_shot_split_settings()

for f in sorted(p for p in SLICES.glob("*.png")):
    with Image.open(f) as im:
        gray = to_gray(np.asarray(im.convert("RGB")))
    parts = split_shot({"source_index": 0, "region": None, "weight": 1}, gray, settings)
    cells = []
    for p in parts:
        r = p.get("region")
        box = f"{r['x']},{r['y']},{r['w']},{r['h']}" if r else "null"
        cells.append(f"{box}@{p['weight']:.6f}")
    print(f"{f.name} {' '.join(cells)}")
