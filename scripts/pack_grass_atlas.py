"""把 textures-src/grass_*.png（1024 透明背景的草丛）拼成一张草的图集 public/textures/grass_atlas.webp。

用法：python scripts/pack_grass_atlas.py

- 每张先裁到草实际占的范围（底边贴着根部），省掉大片透明区域（透明像素也要花 GPU 画）
- 2×2 排进 2048×2048：左上 short、右上 medium、左下 tall_seed、右下 sedge
- 透明区域填上附近草叶的颜色（只改 RGB，alpha 不变），远处 mipmap 缩小后草叶边缘不会发黑
- 打印每种草在图集里的 UV 范围、宽高比和平均颜色（线性），填到 src/pool.js 的 GRASS_CARDS
"""
from pathlib import Path
from PIL import Image, ImageFilter
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "textures-src"
OUT = ROOT / "public" / "textures" / "grass_atlas.webp"
NAMES = ["short", "medium", "tall_seed", "sedge"]
ATLAS, CELL, PAD = 2048, 1024, 6


def to_linear(c):
    c = c / 255.0
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def bleed(img):
    """透明处的 RGB 换成周围草叶颜色的加权平均（多级模糊，近处优先）"""
    a = np.asarray(img, dtype=np.float64)
    rgb, al = a[..., :3], a[..., 3:] / 255.0
    out = rgb.copy()
    filled = al[..., 0] > .5
    for r in (2, 6, 16, 48, 128):
        num = np.asarray(Image.fromarray(np.uint8(np.clip(rgb * al, 0, 255))).filter(ImageFilter.GaussianBlur(r)), dtype=np.float64)
        den = np.asarray(Image.fromarray(np.uint8(al[..., 0] * 255)).filter(ImageFilter.GaussianBlur(r)), dtype=np.float64)[..., None] / 255.0
        ok = (den[..., 0] > .02) & ~filled
        out[ok] = (num[ok] / den[ok])
        filled |= ok
    mean = rgb[al[..., 0] > .5].mean(0)
    out[~filled] = mean
    return Image.fromarray(np.uint8(np.clip(np.concatenate([out, a[..., 3:]], -1), 0, 255)), "RGBA")


def main():
    atlas = Image.new("RGBA", (ATLAS, ATLAS), (0, 0, 0, 0))
    print("export const GRASS_CARDS = {")
    for i, name in enumerate(NAMES):
        im = Image.open(SRC / f"grass_{name}.png").convert("RGBA")
        al = np.asarray(im)[..., 3]
        ys, xs = np.nonzero(al > 8)
        x0, x1 = max(xs.min() - PAD, 0), min(xs.max() + PAD + 1, im.width)
        y0, y1 = max(ys.min() - PAD, 0), im.height          # 底边保留：根部贴着卡片底边
        crop = im.crop((x0, y0, x1, y1))
        w, h = crop.size
        cx, cy = (i % 2) * CELL, (i // 2) * CELL
        ox, oy = cx + (CELL - w) // 2, cy + CELL - h         # 在格子里水平居中、贴底
        atlas.paste(crop, (ox, oy))
        px = np.asarray(crop)
        mean = to_linear(px[px[..., 3] > 128][:, :3].astype(np.float64)).mean(0)
        # UV：three 的纹理 v 轴朝上（flipY），所以 v = 1 - y / ATLAS
        u0, u1 = ox / ATLAS, (ox + w) / ATLAS
        v0, v1 = 1 - (oy + h) / ATLAS, 1 - oy / ATLAS
        name_js = {"tall_seed": "tall"}.get(name, name)
        print(f"  {name_js}: {{ uv: [{u0:.4f}, {v0:.4f}, {u1:.4f}, {v1:.4f}], aspect: {w / h:.3f}, "
              f"mean: [{mean[0]:.4f}, {mean[1]:.4f}, {mean[2]:.4f}] }},")
    print("};")
    atlas = bleed(atlas)
    atlas.save(OUT, "WEBP", quality=88, alpha_quality=100, method=6, exact=True)   # exact：保留透明处的颜色，否则编码器会改掉
    print(f"{OUT.name}: {OUT.stat().st_size / 1024:.0f} KB")


if __name__ == "__main__":
    main()
