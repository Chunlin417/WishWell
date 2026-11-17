# -*- coding: utf-8 -*-
# 殿内云海的云团图集：textures-src/quality/cloud_*_atlas.png（4×4，透明底）→ public/textures/q/ 的 webp（电脑 2048、手机 _1k 1024），
# 并把每一格里云的实际范围写进 src/cloudAtlases.js（[u0, v0, u1, v1, 宽高比]，v 从下往上）。
# 用法：python scripts/pack_cloud_atlases.py
import io, json, os
from PIL import Image

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

js = '// 由 scripts/pack_cloud_atlases.py 生成：云团图集里每一格的实际范围 [u0, v0, u1, v1, 宽高比]（v 从下往上）\n'
js += 'export const CLOUD_ATLAS = ' + json.dumps(ATLAS, separators=(',', ':')) + ';\n'
io.open(os.path.join(ROOT, 'src', 'cloudAtlases.js'), 'w', encoding='utf-8', newline='\n').write(js)
for f in os.listdir(OUT):
    if f.startswith('cloud_cumulus') or f.startswith('cloud_strato'): print(f, os.path.getsize(os.path.join(OUT, f)))
