"""앱 아이콘 생성 (specs/features/F-115.md 3.2)

제품명 글자를 넣지 않는다 (design.md 3.2). 마크다운 `#` 기호 모양 막대 4개로 도형을 만든다.
색은 hex 를 여기 쓰지 않고 src/styles/tokens.css 에서 정규식으로 읽는다.

실행: python scripts/make-icons.py  (Pillow 12.1.1)
"""

import re
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
TOKENS_PATH = ROOT / "src" / "styles" / "tokens.css"
ICON_DIR = ROOT / "public" / "icons"


def read_token_color(name):
    css = TOKENS_PATH.read_text(encoding="utf-8")
    match = re.search(rf"--{name}:\s*(#[0-9a-fA-F]{{3,8}})", css)
    if not match:
        raise SystemExit(f"tokens.css 에서 --{name} 토큰을 찾을 수 없습니다")
    return match.group(1)


INK = read_token_color("ink")
PAPER = read_token_color("paper")


def draw_hash_bars(draw, box, color):
    """box=(x0,y0,x1,y1) 안에 마크다운 # 기호 모양 막대 4개(세로 2, 가로 2)를 그린다"""
    x0, y0, x1, y1 = box
    w = x1 - x0
    h = y1 - y0

    thickness_x = w * 0.16
    thickness_y = h * 0.16
    overhang_x = w * 0.06
    overhang_y = h * 0.06

    for vx in (x0 + w * 0.32, x0 + w * 0.68):
        draw.rounded_rectangle(
            [vx - thickness_x / 2, y0 - overhang_y, vx + thickness_x / 2, y1 + overhang_y],
            radius=thickness_x * 0.3,
            fill=color,
        )

    for hy in (y0 + h * 0.32, y0 + h * 0.68):
        draw.rounded_rectangle(
            [x0 - overhang_x, hy - thickness_y / 2, x1 + overhang_x, hy + thickness_y / 2],
            radius=thickness_y * 0.3,
            fill=color,
        )


def make_rounded_icon(size):
    """투명 바탕 위 반경 22% 둥근 사각형 (icon-192/512)"""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    radius = size * 0.22
    draw.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=INK)

    pad = size * 0.26
    draw_hash_bars(draw, (pad, pad, size - pad, size - pad), PAPER)
    return img


def make_maskable_icon(size):
    """바탕 전체를 칠하고 기호는 가운데 지름 80% 안전 영역 안에 둔다 (icon-maskable-512)"""
    img = Image.new("RGBA", (size, size), INK)
    draw = ImageDraw.Draw(img)

    half = size * 0.28  # 안전 영역(지름 80%)에 여유 있게 들어가는 정사각형 절반 폭
    cx = cy = size / 2
    draw_hash_bars(draw, (cx - half, cy - half, cx + half, cy + half), PAPER)
    return img


def main():
    ICON_DIR.mkdir(parents=True, exist_ok=True)
    make_rounded_icon(192).save(ICON_DIR / "icon-192.png")
    make_rounded_icon(512).save(ICON_DIR / "icon-512.png")
    make_maskable_icon(512).save(ICON_DIR / "icon-maskable-512.png")
    print(f"아이콘 생성 완료: {ICON_DIR}")


if __name__ == "__main__":
    main()
