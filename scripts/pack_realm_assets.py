# -*- coding: utf-8 -*-
# 洞天（殿里的月夜云海）第二档的素材：textures-src/quality/ 里的原图 → public/textures/q/ 的 webp（电脑一档、手机 _1k 一档）
#   curtain_gauze_gold.png   黑底金线云纹 → 薄纱：金线是实的、发光的，纱本身是一层很淡的暗色（透明度从亮度算）
#   ginkgo_leaves_atlas.png  透明底 16 片银杏叶（原图的格子没对齐）→ 按空隙切出每一片，重新居中排成整齐的 4×4
#   lantern_lotus_glow.png   黑底莲花光 → 石灯笼灯室四面的发光图
#   plinth_relief_diff/height.png  中间一条云纹莲花浮雕带 → 只裁出那一条，高度图换算成法线图（OpenGL：绿色朝上）
# 用法：python scripts/pack_realm_assets.py
import os
import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC, OUT = os.path.join(ROOT, 'textures-src', 'quality'), os.path.join(ROOT, 'public', 'textures', 'q')
src = lambda n: Image.open(os.path.join(SRC, n))
def save(im, name, size, size_low):
    im.resize(size, Image.LANCZOS).save(os.path.join(OUT, name + '.webp'), 'WEBP', quality=88, method=6)
    if size_low: im.resize(size_low, Image.LANCZOS).save(os.path.join(OUT, name + '_1k.webp'), 'WEBP', quality=88, method=6)

# ---------- 薄纱 ----------
c = np.asarray(src('curtain_gauze_gold.png').convert('RGB')).astype(np.float32) / 255.
lum = c.mean(-1)
alpha = np.clip(.3 + lum * 1.6, 0, 1)                          # 纱底子留一层淡淡的（.3），金线越亮越实
body = np.array([.3, .3, .28], np.float32)                       # 纱的底色：暗的灰青（夜里），金线处换成原图的金色
k = np.clip(lum * 3, 0, 1)[..., None]
rgb = body * (1 - k) + np.clip(c * 1.15, 0, 1) * k
out = np.dstack([rgb, alpha]) * 255
save(Image.fromarray(out.astype(np.uint8), 'RGBA'), 'curtain_gauze', (1024, 2048), (512, 1024))

# ---------- 银杏叶：按空隙切开，重新排成 4×4 ----------
g = src('ginkgo_leaves_atlas.png').convert('RGBA'); ga = np.asarray(g)[..., 3] > 8
def runs(mask1d):
    out, start = [], None
    for i, v in enumerate(mask1d):
        if v and start is None: start = i
        if not v and start is not None: out.append((start, i)); start = None
    if start is not None: out.append((start, len(mask1d)))
    return [r for r in out if r[1] - r[0] > 40]
leaves = []
for y0, y1 in runs(ga.any(1)):
    for x0, x1 in runs(ga[y0:y1].any(0)):
        sub = ga[y0:y1, x0:x1]; ys = np.where(sub.any(1))[0]
        leaves.append(g.crop((x0, y0 + ys.min(), x1, y0 + ys.max() + 1)))
print('ginkgo leaves', len(leaves))
CELL = 512; atlas = Image.new('RGBA', (CELL * 4, CELL * 4), (0, 0, 0, 0))
for i, lf in enumerate(leaves[:16]):
    s = CELL * .9 / max(lf.size); lf = lf.resize((round(lf.size[0] * s), round(lf.size[1] * s)), Image.LANCZOS)
    atlas.paste(lf, ((i % 4) * CELL + (CELL - lf.size[0]) // 2, (i // 4) * CELL + (CELL - lf.size[1]) // 2), lf)
# 透明处的颜色填成叶子的金色：缩小、mipmap 时边缘不会混进黑边
arr = np.asarray(atlas).copy(); arr[arr[..., 3] < 8, :3] = (200, 150, 40)
save(Image.fromarray(arr, 'RGBA'), 'ginkgo_atlas', (1024, 1024), (512, 512))

# ---------- 莲花灯 ----------
save(src('lantern_lotus_glow.png').convert('RGB'), 'lantern_lotus', (512, 512), None)

# ---------- 浮雕带 ----------
Y0, Y1 = 812, 1180                                               # 原图里浮雕那一条（含上沿的压边），量出来的
diff = src('plinth_relief_diff.png').convert('RGB').crop((0, Y0, 2000, Y1))
h = np.asarray(src('plinth_relief_height.png').convert('L').crop((0, Y0, 2000, Y1))).astype(np.float32) / 255.
dx = np.zeros_like(h); dy = np.zeros_like(h)
dx[:, 1:-1] = (h[:, 2:] - h[:, :-2]) / 2; dy[1:-1] = (h[2:] - h[:-2]) / 2
S = 9.                                                           # 起伏的强度
n = np.dstack([-dx * S, dy * S, np.ones_like(h)]); n /= np.linalg.norm(n, axis=-1, keepdims=True)   # 图像 y 向下 → 法线的绿色朝上要反一下
nor = Image.fromarray(((n * .5 + .5) * 255).astype(np.uint8), 'RGB')
save(diff, 'plinth_relief_diff', (2048, 384), (1024, 192))
save(nor, 'plinth_relief_nor_gl', (2048, 384), (1024, 192))

for f in sorted(os.listdir(OUT)):
    if f.startswith(('curtain_gauze', 'ginkgo_atlas', 'lantern_lotus', 'plinth_relief')): print(f, os.path.getsize(os.path.join(OUT, f)))
