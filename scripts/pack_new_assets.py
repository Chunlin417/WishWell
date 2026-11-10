"""把 textures-src/ 里新交付的 PNG 素材压成 WebP，输出到 public/textures/。

用法：python scripts/pack_new_assets.py

- 树荫光斑遮罩：粗的叶影放 R 通道、细的放 G 通道、水底焦散放 B 通道，合成一张 canopy_mask.webp（1024，q88）——
  着色器里贴图单元只有 16 个，地面着色器已经用到 15 个，两张图合成一张才放得下
- 河床卵石 / 石狐石材 / 水波法线：颜色 1024（q82）、法线 1024（q90）、粗糙度 512（q80）
- 植物图集 groundplants_atlas（4×4）、落叶花瓣图集 leaves_atlas（3×5）：保留透明通道；
  透明处的 RGB 填上周围植物的颜色（远处 mipmap 缩小后边缘不发黑），
  并找出每一个独立元素的包围盒，打印成可以直接贴到 src/pool.js 的 UV 范围 / 宽高比 / 平均颜色（线性）
"""
from pathlib import Path
from PIL import Image, ImageFilter
import numpy as np
from scipy import ndimage

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "textures-src"
DST = ROOT / "public" / "textures"


def save(img, name, q, method=6, lossless=False):
    out = DST / f"{name}.webp"
    img.save(out, "WEBP", quality=q, method=method, lossless=lossless)
    print(f"{name:34s} {img.size}  {out.stat().st_size / 1024:6.0f} KB")


def plain(name, size, q, gray=False):
    im = Image.open(SRC / f"{name}.png")
    im = im.convert("L" if gray else "RGB")
    if im.width != size:
        im = im.resize((size, size), Image.LANCZOS)
    if gray:
        im = im.convert("RGB")   # three.js 读 .r；灰度 WebP 浏览器解码成 RGB 也一样
    save(im, name, q)


def to_linear(c):
    c = c / 255.0
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def bleed(img):
    """透明处的 RGB 换成周围元素颜色的加权平均（多级模糊，近处优先）；alpha 不变"""
    a = np.asarray(img, dtype=np.float64)
    rgb, al = a[..., :3], a[..., 3:] / 255.0
    out = rgb.copy()
    filled = al[..., 0] > .5
    for r in (2, 6, 16, 48, 128):
        num = np.asarray(Image.fromarray(np.uint8(np.clip(rgb * al, 0, 255))).filter(ImageFilter.GaussianBlur(r)), dtype=np.float64)
        den = np.asarray(Image.fromarray(np.uint8(al[..., 0] * 255)).filter(ImageFilter.GaussianBlur(r)), dtype=np.float64)[..., None] / 255.0
        ok = (den[..., 0] > .02) & ~filled
        out[ok] = num[ok] / den[ok]
        filled |= ok
    out[~filled] = rgb[al[..., 0] > .5].mean(0)
    return Image.fromarray(np.uint8(np.clip(np.concatenate([out, a[..., 3:]], -1), 0, 255)), "RGBA")


def atlas(name, size, q, rows, cols, var, merge=14, grid=False):
    """var：JS 里的变量名。元素按"行（从上到下）、行内从左到右"排序"""
    im = Image.open(SRC / f"{name}.png").convert("RGBA")
    al = np.asarray(im)[..., 3]
    boxes = []
    if grid:   # 元素排得很紧、连通域会连在一起时：按等分的格子取每格里不透明像素的包围盒
        ch, cw = im.height // rows, im.width // cols
        for r in range(rows):
            for c in range(cols):
                sub = al[r * ch:(r + 1) * ch, c * cw:(c + 1) * cw] > 8
                ys, xs = np.nonzero(sub)
                boxes.append((c * cw + xs.min(), r * ch + ys.min(), c * cw + xs.max() + 1, r * ch + ys.max() + 1))
                if xs.min() == 0 or xs.max() == cw - 1 or ys.min() == 0 or ys.max() == ch - 1: print(f"  警告：{name} 第 {r + 1} 行第 {c + 1} 个碰到了格子边缘")
        lab, n = None, 0
    else:
        lab, n = ndimage.label(ndimage.binary_dilation(al > 8, iterations=merge))
    for i, sl in enumerate([] if grid else ndimage.find_objects(lab)):
        m = (lab[sl] == i + 1) & (al[sl] > 8)
        ys, xs = np.nonzero(m)
        y0, y1 = sl[0].start + ys.min(), sl[0].start + ys.max() + 1
        x0, x1 = sl[1].start + xs.min(), sl[1].start + xs.max() + 1
        boxes.append((x0, y0, x1, y1))
    assert len(boxes) == rows * cols, f"{name}: 找到 {len(boxes)} 个元素，应为 {rows * cols}"
    boxes.sort(key=lambda b: (round((b[1] + b[3]) / 2 / (im.height / rows) - .5), b[0]))
    W, H = im.size
    px = np.asarray(im)
    print(f"export const {var} = [")
    for r in range(rows):
        row = []
        for c in range(cols):
            x0, y0, x1, y1 = boxes[r * cols + c]
            pad = 3
            x0, y0, x1, y1 = max(x0 - pad, 0), max(y0 - pad, 0), min(x1 + pad, W), min(y1 + pad, H)
            sel = px[y0:y1, x0:x1]
            mean = to_linear(sel[sel[..., 3] > 128][:, :3].astype(np.float64)).mean(0)
            # three 的纹理 v 轴朝上（flipY）：v = 1 - y / H
            row.append(f"{{ uv: [{x0 / W:.4f}, {1 - y1 / H:.4f}, {x1 / W:.4f}, {1 - y0 / H:.4f}], aspect: {(x1 - x0) / (y1 - y0):.3f}, mean: [{mean[0]:.4f}, {mean[1]:.4f}, {mean[2]:.4f}] }}")
        print("  [" + ", ".join(row) + "],")
    print("];")
    out = bleed(im)
    if im.width != size:
        out = out.resize((size, size), Image.LANCZOS)
    save(out, name, q)


def main():
    DST.mkdir(parents=True, exist_ok=True)
    chans = [Image.open(SRC / f"{n}.png").convert("L").resize((1024, 1024), Image.LANCZOS) for n in ("canopy_shadow", "canopy_shadow_fine")]
    caus = Image.open(SRC / "caustics.png").convert("L").resize((1024, 1024), Image.LANCZOS)
    save(Image.merge("RGB", [chans[0], chans[1], caus]), "canopy_mask", 90)
    plain("shore_mud_diff", 1024, 82)
    plain("shore_mud_nor_gl", 1024, 90)
    for n in ("riverbed_pebbles", "fox_stone"):
        plain(f"{n}_diff", 1024, 82)
        plain(f"{n}_nor_gl", 1024, 90)
        plain(f"{n}_rough", 512, 80, gray=True)
    plain("water_ripple_nor_gl", 1024, 90)
    for n in ("rock_mossy_a", "rock_mossy_b", "rock_lichen", "ground_mossgrass"):
        plain(f"{n}_diff", 1024, 82)
        plain(f"{n}_nor_gl", 1024, 90)
        plain(f"{n}_rough", 512, 80, gray=True)
    atlas("groundplants_atlas", 1536, 85, 4, 4, "GROUND_PLANTS")
    atlas("leaves_atlas", 1024, 85, 3, 5, "LEAF_CARDS", merge=3)
    atlas("broadleaf_groundplants_atlas", 1536, 85, 4, 4, "BROADLEAF_PLANTS", grid=True)
    atlas("whiteflowers_moonglow_atlas", 1024, 85, 4, 4, "MOONFLOWERS", grid=True)
    plain("wet_rock_detail_nor_gl", 1024, 90)


if __name__ == "__main__":
    main()
