"""把 textures-src/ 里的地面贴图（2K WebP 原图）打包成运行时用的 1K WebP，输出到 public/textures/。

用法：python scripts/pack_ground_textures.py

- <名字>_diff.webp   ：颜色
- <名字>_nor_gl.webp ：OpenGL 法线
不带粗糙度贴图：地面要同时用 6 套贴图，每套 3 张会超过 WebGL 的 16 个贴图单元；
把粗糙度塞进颜色贴图的 alpha 又会让文件大两三倍。所以这里只打印粗糙度的平均值，
着色器里用"平均粗糙度 + 颜色明暗的微调"代替（GROUND_ROUGH）。
同时打印每套颜色贴图的平均颜色（线性空间），填到 src/textures.js 的 GROUND_MEAN，
着色器用它把贴图"归一化"，再乘上随季节变化的草坪颜色。
"""
from pathlib import Path
from PIL import Image
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "textures-src"
DST = ROOT / "public" / "textures"
NAMES = ["lawn_grass", "wet_soil", "wet_sand", "moss_ground", "leaf_litter"]
SIZE = 1024


def to_linear(c):
    c = c / 255.0
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def main():
    DST.mkdir(parents=True, exist_ok=True)
    total = 0
    for name in NAMES:
        diff = Image.open(SRC / f"{name}_diff_2k.webp").convert("RGB").resize((SIZE, SIZE), Image.LANCZOS)
        rough = np.asarray(Image.open(SRC / f"{name}_rough_2k.webp").convert("L"), dtype=np.float64) / 255.0
        nor = Image.open(SRC / f"{name}_nor_gl_2k.webp").convert("RGB").resize((SIZE, SIZE), Image.LANCZOS)

        out_dr, out_n = DST / f"{name}_diff.webp", DST / f"{name}_nor_gl.webp"
        diff.save(out_dr, "WEBP", quality=84, method=6)
        nor.save(out_n, "WEBP", quality=90, method=6)

        mean = to_linear(np.asarray(diff, dtype=np.float64)).reshape(-1, 3).mean(0)
        size = out_dr.stat().st_size + out_n.stat().st_size
        total += size
        print(f"{name:12s} {size / 1024:6.0f} KB   mean(linear) = [{mean[0]:.4f}, {mean[1]:.4f}, {mean[2]:.4f}]   rough = {rough.mean():.3f}")
    print(f"total {total / 1048576:.2f} MB")


if __name__ == "__main__":
    main()
