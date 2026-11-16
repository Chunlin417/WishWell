# -*- coding: utf-8 -*-
# 把 textures-src/quality/ 里的素材（无损 PNG，约 360MB）压成网页用的 webp，放进 public/textures/q/，
# 并把透明图集里每一格植物 / 贴花的实际范围算出来，写成 src/qualityAtlases.js（场景里按格子取图）。
#   无缝贴图：_diff / _nor_gl 出两档——2048（电脑）和 1024（手机，文件名加 _1k）；_rough、_height 只出 1024
#   透明图集：2048（电脑）和 1024（手机）
# 用法：python scripts/pack_quality_textures.py
import io, json, os
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'textures-src', 'quality')
OUT = os.path.join(ROOT, 'public', 'textures', 'q')
os.makedirs(OUT, exist_ok=True)
total = 0

def save(im, name, q):
    global total
    p = os.path.join(OUT, name)
    im.save(p, 'WEBP', quality=q, method=6)
    total += os.path.getsize(p)

def src(name):
    return Image.open(os.path.join(SRC, name + '.png'))

# 无缝的材质组：名字、要不要 2048 档、有没有高度图
SETS = [
    ('red_lacquer_peeled', True, False),   # 檐柱、门扇、窗框：剥落的旧红漆
    ('tile_mossy', True, False),           # 屋瓦
    ('paving_old', True, True),            # 院子里的青石板（高度图用来找石缝）
    ('wall_drystone', True, True),         # 院墙
    ('stone_worn', True, False),           # 台基、石阶、散石
    ('moss_dense', False, False),          # 苔藓
    ('bark_ancient_v2', False, False),     # 古树皮（备用）
    ('soil_gravel', False, False),         # 泥土碎石（院外地面）
]
for name, big, height in SETS:
    for ch, q in (('diff', 84), ('nor_gl', 90)):
        im = src(f'{name}_{ch}').convert('RGB')
        if big: save(im.resize((2048, 2048), Image.LANCZOS), f'{name}_{ch}.webp', q)
        save(im.resize((1024, 1024), Image.LANCZOS), f'{name}_{ch}_1k.webp', q)
    save(src(f'{name}_rough').convert('RGB').resize((1024, 1024), Image.LANCZOS), f'{name}_rough_1k.webp', 85)
    if height: save(src(f'{name}_height').convert('L').resize((1024, 1024), Image.LANCZOS).convert('RGB'), f'{name}_height_1k.webp', 88)

# 木牌木材（本来就是 1024）
for name in ('plaque_wood_new', 'plaque_wood_old'):
    for ch, q in (('diff', 86), ('nor_gl', 90), ('rough', 85)):
        save(src(f'{name}_{ch}').convert('RGB').resize((512, 512), Image.LANCZOS), f'{name}_{ch}.webp', q)

# 透明图集：算出每一格里实际有内容的范围（alpha > 40），给场景用
def cells(im, cols, rows):
    a = im.getchannel('A'); W, H = im.size; cw, ch = W // cols, H // rows; out = []
    for r in range(rows):
        for c in range(cols):
            box = a.crop((c * cw, r * ch, (c + 1) * cw, (r + 1) * ch)).point(lambda v: 255 if v > 40 else 0).getbbox()
            if not box: out.append(None); continue
            x0, y0, x1, y1 = c * cw + box[0], r * ch + box[1], c * cw + box[2], r * ch + box[3]
            out.append([round(x0 / W, 4), round(1 - y1 / H, 4), round(x1 / W, 4), round(1 - y0 / H, 4), round((x1 - x0) / max(1, y1 - y0), 3)])
    return out

ATLAS = {}
for name, cols, rows, q in (('plants_atlas_v2', 4, 4, 86), ('vines_atlas', 4, 4, 86), ('grass_clumps_atlas', 4, 4, 86),
                            ('decal_leaves_atlas', 4, 4, 86), ('decal_moss_atlas', 4, 4, 86), ('maple_branch_atlas', 3, 2, 86),
                            ('fog_puffs', 4, 2, 80)):
    im = src(name).convert('RGBA')
    ATLAS[name] = cells(im, cols, rows)
    if name == 'fog_puffs':
        save(im.resize((1024, 512), Image.LANCZOS), f'{name}.webp', q); continue
    save(im, f'{name}.webp', q)
    save(im.resize((1024, 1024), Image.LANCZOS), f'{name}_1k.webp', q)

# 灰度小图：光柱噪声、雨水冲刷痕迹
save(src('shaft_noise').convert('L').resize((512, 512), Image.LANCZOS).convert('RGB'), 'shaft_noise.webp', 85)
save(src('grime_rain_streaks').convert('L').resize((1024, 1024), Image.LANCZOS).convert('RGB'), 'grime_rain_streaks.webp', 85)
save(src('grime_edge_wear').convert('L').resize((1024, 1024), Image.LANCZOS).convert('RGB'), 'grime_edge_wear.webp', 85)
# 匾额、楹联的空白底板（字在场景里写）
save(src('sign_plaque_blank').convert('RGB'), 'sign_plaque_blank.webp', 88)
save(src('sign_couplet_blank').convert('RGB'), 'sign_couplet_blank.webp', 88)

js = '// 由 scripts/pack_quality_textures.py 生成：透明图集里每一格的实际范围 [u0, v0, u1, v1, 宽高比]（v 从下往上），null = 空格\n'
js += 'export const ATLAS = ' + json.dumps(ATLAS, separators=(',', ':')) + ';\n'
io.open(os.path.join(ROOT, 'src', 'qualityAtlases.js'), 'w', encoding='utf-8', newline='\n').write(js)
print('written %.1f MB to public/textures/q' % (total / 1e6))
