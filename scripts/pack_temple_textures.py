# -*- coding: utf-8 -*-
"""把 UE5 东方寺庙素材包（textures-src/temple/，由 output/ue5-oriental-temple-material-pack.zip 解压）压成网页用的 WebP。

- 法线：素材是 UE5 用的 DirectX 法线（绿色通道朝下），three.js 要 OpenGL 法线，这里把绿色通道翻转
- 颜色贴图：AO 按 60% 的强度乘进去（网页里不再单独采样 AO），1024×1024
- 粗糙度：512×512 单通道存成灰度
- 阔叶图集：保留透明通道；顺便打印每一枝在图集里的 uv 范围和宽高比（填到 src/courtyardTree.js 的 LEAF_CELLS）

用法：python scripts/pack_temple_textures.py
"""
import os
from PIL import Image, ImageChops

SRC = 'textures-src/temple'
OUT = 'public/textures'
SETS = {   # 输出前缀：素材目录 / 文件名前缀
    'temple_bark': 'Ancient_Bark/Ancient_Bark',
    'temple_wood': 'Temple_Wood/Temple_Wood',
    'temple_roof': 'Grey_Roof_Tile/Grey_Roof_Tile',
}
SIZE, RSIZE, AO_K = 1024, 512, .6


def flip_green(im):
    r, g, b = im.convert('RGB').split()
    return Image.merge('RGB', (r, ImageChops.invert(g), b))


def save(im, name, **kw):
    path = os.path.join(OUT, name)
    im.save(path, 'WEBP', **kw)
    print('  ', name, im.size, im.mode, os.path.getsize(path) // 1024, 'KB')


for out, src in SETS.items():
    print(out)
    base = os.path.join(SRC, src)
    diff = Image.open(base + '_BaseColor_2K.png').convert('RGB')
    ao = Image.open(base + '_AO_2K.png').convert('L').resize(diff.size)
    ao = ao.point(lambda v: int(255 - (255 - v) * AO_K))
    diff = ImageChops.multiply(diff, Image.merge('RGB', (ao, ao, ao)))
    save(diff.resize((SIZE, SIZE), Image.LANCZOS), out + '_diff.webp', quality=88, method=6)
    nor = flip_green(Image.open(base + '_Normal_DX_2K.png'))
    save(nor.resize((SIZE, SIZE), Image.LANCZOS), out + '_nor_gl.webp', quality=92, method=6)
    rough = Image.open(base + '_Roughness_2K.png').convert('L')
    save(rough.resize((RSIZE, RSIZE), Image.LANCZOS).convert('RGB'), out + '_rough.webp', quality=85, method=6)

print('temple_leaves')
leaf = Image.open(os.path.join(SRC, 'Broadleaf_Atlas/Broadleaf_Atlas_BaseColorAlpha_2K.png')).convert('RGBA')
W, H = leaf.size
# 透明处的颜色换成叶子的平均色：缩小（mipmap）时叶子边缘不会混进黑边或杂色
a = leaf.getchannel('A')
mask = a.point(lambda v: 255 if v > 128 else 0)
rgb = leaf.convert('RGB')
px = [0, 0, 0]; n = 0
small_rgb, small_m = rgb.resize((256, 256)), mask.resize((256, 256))
for (r, g, b), m in zip(small_rgb.get_flattened_data(), small_m.get_flattened_data()):
    if m > 128: px[0] += r; px[1] += g; px[2] += b; n += 1
fill = Image.new('RGB', leaf.size, tuple(v // max(n, 1) for v in px))
fill.paste(rgb, mask=a.point(lambda v: 255 if v > 8 else 0))
fill.putalpha(a)
save(fill.resize((SIZE, SIZE), Image.LANCZOS), 'temple_leaves_diff.webp', quality=90, method=6)
# 图集是 3 列 × 2 行，每格一枝：打印每枝的 uv 范围（v 朝上）和宽高比
cells = []
for r in range(2):
    for c in range(3):
        box = (c * W // 3, r * H // 2, (c + 1) * W // 3, (r + 1) * H // 2)
        bb = a.crop(box).point(lambda v: 255 if v > 80 else 0).getbbox()
        x0, y0, x1, y1 = bb[0] + box[0] - 6, bb[1] + box[1] - 6, bb[2] + box[0] + 6, bb[3] + box[1] + 6
        cells.append('[[%.4f, %.4f, %.4f, %.4f], %.3f]' % (x0 / W, 1 - y1 / H, x1 / W, 1 - y0 / H, (x1 - x0) / (y1 - y0)))
print('LEAF_CELLS = [' + ', '.join(cells) + ']')
