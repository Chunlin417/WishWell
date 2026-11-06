"""把 textures-src/dragon_*.webp（2K 无损 WebP 的龙鳞贴图）压成网页用的 WebP，输出到 public/textures/。

用法：python scripts/pack_dragon_textures.py

- 颜色：1024，质量 84
- 法线：1024，质量 90（法线对压缩瑕疵更敏感）
- 粗糙度：512，灰度，质量 80
三套：dragon_scales（背部大鳞）、dragon_belly（腹部横纹甲）、dragon_head（龙头细鳞）
"""
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "textures-src"
DST = ROOT / "public" / "textures"
SETS = ["dragon_scales", "dragon_belly", "dragon_head"]
RULES = {"diff": (1024, 84, "RGB"), "nor_gl": (1024, 90, "RGB"), "rough": (512, 80, "L")}


def main():
    total = 0
    for name in SETS:
        for kind, (size, q, mode) in RULES.items():
            img = Image.open(SRC / f"{name}_{kind}.webp").convert(mode).resize((size, size), Image.LANCZOS)
            out = DST / f"{name}_{kind}.webp"
            img.save(out, "WEBP", quality=q, method=6)
            total += out.stat().st_size
            print(f"{out.name:32s} {out.stat().st_size / 1024:6.0f} KB")
    print(f"total {total / 1048576:.2f} MB")


if __name__ == "__main__":
    main()
