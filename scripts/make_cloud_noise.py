# -*- coding: utf-8 -*-
# 生成殿内云海用的噪声图 public/textures/q/cloud_noise.webp（512×512，可无缝平铺）：
#   R：云的大形（1/f^2.2 的频谱噪声，蓬松成团）  G：另一张不同种子的噪声（用来扭曲 R 的采样位置，让云自己慢慢卷动）
# 频谱合成天然是周期性的，所以四边可以无缝相接。用法：python scripts/make_cloud_noise.py
import os
import numpy as np
from PIL import Image

N = 512
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def spectral(seed, beta):
    rng = np.random.default_rng(seed)
    fx = np.fft.fftfreq(N)[:, None]; fy = np.fft.fftfreq(N)[None, :]
    f = np.sqrt(fx * fx + fy * fy); f[0, 0] = 1
    amp = f ** (-beta / 2); amp[0, 0] = 0
    amp[f < 2 / N] = 0                                  # 去掉最大的那一两个波：不要整张图一边亮一边暗
    phase = rng.uniform(0, 2 * np.pi, (N, N))
    img = np.real(np.fft.ifft2(amp * np.exp(1j * phase)))
    img = (img - img.mean()) / img.std()
    return np.clip(img * .22 + .5, 0, 1)                # 平均 0.5，大约 ±2.3σ 落在 0～1 之间

r, g = spectral(11, 2.2), spectral(29, 2.6)
rgb = np.stack([r, g, np.full_like(r, .5)], -1)
out = os.path.join(ROOT, 'public', 'textures', 'q', 'cloud_noise.webp')
Image.fromarray((rgb * 255).astype(np.uint8)).save(out, 'WEBP', quality=92, method=6)
print(out, os.path.getsize(out))
