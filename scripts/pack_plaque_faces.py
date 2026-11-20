"""Pack the generated wish-plaque face images into web textures.

Inputs  (textures-src/quality):  plaque_face_new_src.webp (light raw wood, pond + fresh courtyard plaques)
                                  plaque_face_old_src.webp (dark weathered wood, old courtyard plaques)
Outputs (public/textures):        plaque_face_{new,old}.webp      RGBA: white background (corners, hole) -> alpha,
                                                                   colour bled into the transparent area (no white fringe)
                                  plaque_face_new_nor.webp         OpenGL normal map from the grain (pond plaque)
                                  plaque_face.json                 hole centre / radius in UV (v from the top)

Run: python scripts/pack_plaque_faces.py
"""
import json
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'textures-src' / 'quality'
OUT = ROOT / 'public' / 'textures'
W, H = 512, 1536   # 1:3 like the sources; the code stretches it to the plaque's own proportions


def background_mask(rgb):
    """White generator background: very bright, almost unsaturated. Keep only regions touching the border (corners)
    or the largest interior blob near the top (the drilled hole), so bright wood never turns transparent."""
    f = rgb.astype(np.float32)
    bright = (f.min(axis=2) > 205) & ((f.max(axis=2) - f.min(axis=2)) < 40)
    lab, n = ndimage.label(bright)
    keep = np.zeros_like(bright)
    h, w = bright.shape
    border = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
    for i in border:
        keep |= lab == i
    hole = None
    best = 0
    for i in range(1, n + 1):
        if i in border:
            continue
        ys, xs = np.nonzero(lab == i)
        if ys.mean() < h * .1 and len(ys) > best:   # the hole sits near the top
            best, hole = len(ys), (xs.mean() / w, ys.mean() / h, np.sqrt(len(ys) / np.pi) / w)
            keep_i = lab == i
    if hole:
        keep |= keep_i
    return keep, hole


def pack(name):
    im = Image.open(SRC / f'plaque_face_{name}_src.webp').convert('RGB')
    rgb = np.asarray(im)
    bg, hole = background_mask(rgb)
    # soft alpha edge (1 px feather at source res), then bleed wood colour outward under the transparent area
    alpha = 1 - ndimage.gaussian_filter(ndimage.binary_dilation(bg, iterations=1).astype(np.float32), .8)
    idx = ndimage.distance_transform_edt(ndimage.binary_dilation(bg, iterations=3), return_distances=False, return_indices=True)
    bled = rgb[idx[0], idx[1]]
    rgba = np.dstack([bled, (np.clip(alpha, 0, 1) * 255).astype(np.uint8)])
    out = Image.fromarray(rgba, 'RGBA').resize((W, H), Image.LANCZOS)
    out.save(OUT / f'plaque_face_{name}.webp', quality=90, method=6)
    return out, hole


def normal_map(img, strength=2.2):
    """Grain normal map: darker grain lines are slightly lower. OpenGL convention (+Y up)."""
    rgb = np.asarray(img.convert('RGB')).astype(np.float32) / 255
    lum = rgb @ np.array([.2126, .7152, .0722], np.float32)
    hgt = lum - ndimage.gaussian_filter(lum, 12)          # keep only fine relief, not the big colour patches
    hgt = ndimage.gaussian_filter(hgt, .7)
    dx = ndimage.sobel(hgt, axis=1) * strength
    dy = ndimage.sobel(hgt, axis=0) * strength
    n = np.dstack([-dx, dy, np.ones_like(hgt)])           # image y runs down -> flip for GL
    n /= np.linalg.norm(n, axis=2, keepdims=True)
    return Image.fromarray(((n * .5 + .5) * 255).astype(np.uint8), 'RGB')


if __name__ == '__main__':
    new, hole = pack('new')
    pack('old')
    normal_map(new).save(OUT / 'plaque_face_new_nor.webp', quality=90, method=6)
    meta = {'hole': {'u': round(hole[0], 4), 'v': round(hole[1], 4), 'r': round(hole[2], 4)} if hole else None, 'aspect': W / H}
    (OUT / 'plaque_face.json').write_text(json.dumps(meta, indent=1))
    print(meta)
