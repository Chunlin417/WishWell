# -*- coding: utf-8 -*-
# 殿内云海的云团图集：textures-src/quality/cloud_*_atlas.png（4×4，透明底）→ public/textures/q/ 的 webp（电脑 2048、手机 _1k 1024），
# 并把每一格里云的实际范围写进 src/cloudAtlases.js（[u0, v0, u1, v1, 宽高比]，v 从下往上）。
# 用法：python scripts/pack_cloud_atlases.py
import io, json, os
from PIL import Image, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC, OUT = os.path.join(ROOT, 'textures-src', 'quality'), os.path.join(ROOT, 'public', 'textures', 'q')

def cells(im, cols=4, rows=4):
    a = im.getchannel('A'); W, H = im.size; cw, ch = W // cols, H // rows; out = []
    for r in range(rows):
        for c in range(cols):
            box = a.crop((c * cw, r * ch, (c + 1) * cw, (r + 1) * ch)).point(lambda v: 255 if v > 24 else 0).getbbox()
            x0, y0, x1, y1 = c * cw + box[0], r * ch + box[1], c * cw + box[2], r * ch + box[3]
            out.append([round(x0 / W, 4), round(1 - y1 / H, 4), round(x1 / W, 4), round(1 - y0 / H, 4), round((x1 - x0) / (y1 - y0), 3)])
    return out

ATLAS = {}
for name, key in (('cloud_cumulus_atlas', 'cumulus'), ('cloud_stratocumulus_atlas', 'strato')):
    im = Image.open(os.path.join(SRC, name + '.png')).convert('RGBA')
    ATLAS[key] = cells(im)
    im.save(os.path.join(OUT, f'cloud_{key}.webp'), 'WEBP', quality=86, method=6)
    im.resize((1024, 1024), Image.LANCZOS).save(os.path.join(OUT, f'cloud_{key}_1k.webp'), 'WEBP', quality=86, method=6)

# 风卷云：原图每团云带着一圈生硬的边（方块状的色块），不能直接当透明云用。这里重做 alpha：
# 丢掉原来的边，换成一个柔和的椭圆羽化（越往中心越实），再按图上的明暗调浓淡（暗的卷纹更浓，亮的底更透），得到边缘全是渐变的薄云。
import numpy as np
wisp = Image.open(os.path.join(SRC, 'cloud_wispy_atlas_optional.png')).convert('RGBA')
W = wisp.size[0]; C = W // 4
arr = np.asarray(wisp).astype(np.float32); out = np.zeros_like(arr)
yy, xx = np.mgrid[0:C, 0:C].astype(np.float32)
for r in range(4):
    for c in range(4):
        cell = arr[r * C:(r + 1) * C, c * C:(c + 1) * C]
        a0 = cell[..., 3] / 255.
        ys, xs = np.where(a0 > .3); cy, cx = (ys.min() + ys.max()) / 2, (xs.min() + xs.max()) / 2   # 云体中心
        ry, rx = (ys.max() - ys.min()) * .5 * .86, (xs.max() - xs.min()) * .5 * .86              # 比原来的范围小一圈，裁掉毛边
        d = np.sqrt(((xx - cx) / rx) ** 2 + ((yy - cy) / ry) ** 2)
        mask = np.clip(1 - (d - .35) / .65, 0, 1); mask = mask * mask * (3 - 2 * mask)             # 中心实、边缘渐隐
        lum = cell[..., :3].mean(-1) / 255.; l0, l1 = np.percentile(lum[a0 > .5], [8, 92])
        dens = np.clip(1 - (lum - l0) / max(l1 - l0, 1e-3), 0, 1)                                  # 越暗越浓
        solid = np.asarray(Image.fromarray((a0 * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(10))).astype(np.float32) / 255.   # 原图的小缺口模糊掉，不留毛刺
        solid = np.clip((solid - .5) / .35, 0, 1)
        alpha = mask * (.35 + .65 * dens) * solid
        out[r * C:(r + 1) * C, c * C:(c + 1) * C, :3] = cell[..., :3]; out[r * C:(r + 1) * C, c * C:(c + 1) * C, 3] = alpha * 255
wimg = Image.fromarray(out.astype(np.uint8), 'RGBA')
ATLAS['wisp'] = cells(wimg)
wimg.save(os.path.join(OUT, 'cloud_wisp.webp'), 'WEBP', quality=86, method=6)
wimg.resize((1024, 1024), Image.LANCZOS).save(os.path.join(OUT, 'cloud_wisp_1k.webp'), 'WEBP', quality=86, method=6)
wimg.save(os.path.join(os.environ.get('TEMP', '.'), 'wisp_fixed.png'))

js = '// 由 scripts/pack_cloud_atlases.py 生成：云团图集里每一格的实际范围 [u0, v0, u1, v1, 宽高比]（v 从下往上）\n'
js += 'export const CLOUD_ATLAS = ' + json.dumps(ATLAS, separators=(',', ':')) + ';\n'
io.open(os.path.join(ROOT, 'src', 'cloudAtlases.js'), 'w', encoding='utf-8', newline='\n').write(js)
for f in os.listdir(OUT):
    if f.startswith('cloud_cumulus') or f.startswith('cloud_strato') or f.startswith('cloud_wisp'): print(f, os.path.getsize(os.path.join(OUT, f)))
