#!/usr/bin/env python3
# Harness parity Phase 5: in chuỗi filtergraph kenburns.py cho CÙNG ma trận config với
# dump-filters.mts — diff hai output phải byte-identical.
# Chạy: ~/.claude/skills/.venv/bin/python3 tools/parity-port/compare_filters.py

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path.home() / ".claude" / "skills" / "manga-to-video" / "scripts"))

from mtv.kenburns import kenburns  # noqa: E402

CASES = [
    ("pan-v tall 9:16", {"img_w": 720, "img_h": 2100, "region": None, "aspect": "9:16", "duration_sec": 4.567, "fps": 30, "zoom": 1.12}),
    ("zoom blur tall 16:9", {"img_w": 720, "img_h": 2100, "region": None, "aspect": "16:9", "duration_sec": 4.567, "fps": 30, "zoom": 1.12}),
    ("zoom square 1:1", {"img_w": 720, "img_h": 720, "region": None, "aspect": "1:1", "duration_sec": 3.0, "fps": 30, "zoom": 1.12}),
    ("zoom blur nearsq 9:16", {"img_w": 720, "img_h": 800, "region": None, "aspect": "9:16", "duration_sec": 2.5, "fps": 30, "zoom": 1.12}),
    ("pan-h wide 16:9", {"img_w": 2000, "img_h": 700, "region": None, "aspect": "16:9", "duration_sec": 5.123, "fps": 30, "zoom": 1.12}),
    ("static forced blur", {"img_w": 720, "img_h": 800, "region": None, "aspect": "16:9", "duration_sec": 2, "fps": 30, "zoom": 1.12, "motion": {"mode": "static"}}),
    ("zoom forced reverse", {"img_w": 720, "img_h": 720, "region": None, "aspect": "1:1", "duration_sec": 3.25, "fps": 30, "zoom": 1.12, "motion": {"mode": "zoom", "reverse": True}}),
    ("pan-v forced reverse", {"img_w": 720, "img_h": 2100, "region": None, "aspect": "9:16", "duration_sec": 4.0, "fps": 30, "zoom": 1.12, "motion": {"mode": "pan-v", "reverse": True}}),
    ("dur clamp 0.05", {"img_w": 720, "img_h": 720, "region": None, "aspect": "1:1", "duration_sec": 0.05, "fps": 30, "zoom": 1.12}),
    ("region crop pan-v", {"img_w": 720, "img_h": 3000, "region": {"x": 10, "y": 200, "w": 700, "h": 2500}, "aspect": "9:16", "duration_sec": 6.789, "fps": 30, "zoom": 1.12}),
    # Slice manhwa thật trong khung ngang: trung vị + cực đoan của corpus 720px.
    ("tall median 16:9", {"img_w": 720, "img_h": 1418, "region": None, "aspect": "16:9", "duration_sec": 2.5, "fps": 30, "zoom": 1.12}),
    ("tall extreme 16:9", {"img_w": 720, "img_h": 2240, "region": None, "aspect": "16:9", "duration_sec": 2.82, "fps": 30, "zoom": 1.12}),
    # fill 'cover' (full màn hình, không blur): static + zoom lệch tỉ lệ, static vừa khít, pan giữ nguyên.
    ("static cover wide 9:16", {"img_w": 720, "img_h": 800, "region": None, "aspect": "9:16", "duration_sec": 2, "fps": 30, "zoom": 1.12, "motion": {"mode": "static"}, "fill": "cover"}),
    ("static cover tall 9:16", {"img_w": 720, "img_h": 1600, "region": {"x": 0, "y": 100, "w": 720, "h": 1500}, "aspect": "9:16", "duration_sec": 2, "fps": 30, "zoom": 1.12, "motion": {"mode": "static"}, "fill": "cover"}),
    ("static cover exact 9:16", {"img_w": 720, "img_h": 1280, "region": None, "aspect": "9:16", "duration_sec": 2, "fps": 30, "zoom": 1.12, "motion": {"mode": "static"}, "fill": "cover"}),
    ("zoom cover nearsq 9:16", {"img_w": 720, "img_h": 800, "region": None, "aspect": "9:16", "duration_sec": 2.5, "fps": 30, "zoom": 1.12, "fill": "cover"}),
    ("pan-v cover 9:16", {"img_w": 720, "img_h": 2100, "region": None, "aspect": "9:16", "duration_sec": 4.567, "fps": 30, "zoom": 1.12, "fill": "cover"}),
]

for label, input in CASES:
    print(f"### {label}")
    print(kenburns(input))
