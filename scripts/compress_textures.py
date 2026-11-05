"""把 textures-src/ 里的原始 JPG 贴图压成 WebP，输出到 public/textures/。

用法：python scripts/compress_textures.py
- 颜色贴图：1024px，质量 82
- 法线贴图：1024px，质量 90（法线对压缩瑕疵更敏感）
- 粗糙度贴图：512px，质量 80（细节不明显，缩小一半）
"""
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "textures-src"
DST = ROOT / "public" / "textures"

RULES = [  # (文件名包含, 尺寸, 质量)
    ("_nor_gl_", 1024, 90),
    ("_rough_", 512, 80),
    ("_diff_", 1024, 82),
]


def main():
    DST.mkdir(parents=True, exist_ok=True)
    total_in = total_out = 0
    for src in sorted(SRC.glob("*.jpg")):
        size, quality = next((s, q) for key, s, q in RULES if key in src.name)
        img = Image.open(src)
        img = img.convert("L" if "_rough_" in src.name else "RGB")
        if img.width != size:
            img = img.resize((size, size), Image.LANCZOS)
        out = DST / (src.stem.replace("_1k", "") + ".webp")
        img.save(out, "WEBP", quality=quality, method=6)
        a, b = src.stat().st_size, out.stat().st_size
        total_in += a
        total_out += b
        print(f"{src.name:42s} {a / 1024:7.0f} KB -> {out.name:36s} {b / 1024:6.0f} KB")
    print(f"total {total_in / 1048576:.2f} MB -> {total_out / 1048576:.2f} MB")


if __name__ == "__main__":
    main()
