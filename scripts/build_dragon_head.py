"""把 Tripo 生成的龙头（textures-src/dragon_head_tripo.glb）处理成网页用的模型 public/models/dragon_head.glb。

用法：python scripts/build_dragon_head.py        （需要 pip install fast-simplification）

0. 去掉模型上的长须（固定不动，换成网页里会飘的程序龙须）
1. 左右对称：原模型只有一侧有龙须。沿中线（z = 0）切开，保留有龙须的 +z 半边，镜像到另一侧；
   跨过中线的三角形把顶点压到中线上，两半在中线处共用顶点，不留缝
2. 减面：37 万三角面 → 约 4.5 万（网页里要每帧变换、做水下效果，面太多会卡）
3. 张嘴：原模型的嘴是半张着的，先把下颚向上合起 JAW_CLOSE（0.4）弧度作为基础姿势（嘴闭着）；再做一个形变目标（morph target）从合上的嘴张到最大，越靠近转轴转得越少，腮帮子是拉伸开的而不是撕开的
4. 摆正：吻端朝 +z、头顶朝 +y，原点放在头骨中心（和 src/wish.js 里程序生成的龙头一样），龙须、鬃毛都在原位
输出只有位置、形变目标和索引（法线、贴图坐标在网页里算），约 1 MB
"""
import json, struct
from pathlib import Path
import numpy as np
import fast_simplification

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "textures-src" / "dragon_head_tripo.glb"
TARGET_TRIS = 45000
ORIGIN = np.array([0.0, 0.3, 0.0])        # 头骨中心（原模型坐标）
HINGE = np.array([-0.04, 0.205])           # 下颚转轴（原模型的 x, y）
JAW_CLOSE = float(__import__('os').environ.get('JAW_CLOSE', 0.4))   # 把下颚向上合起的角度（弧度）：Tripo 的原模型嘴是半张着的，基础姿势要先合上
JAW_OPEN = 0.2                            # 在合上的基础上，张嘴的最大角度（弧度）
DST = Path(__import__('os').environ.get('DST', str(ROOT / 'public' / 'models' / 'dragon_head.glb')))


def load_glb(path):
    data = path.read_bytes()
    off, chunks = 12, []
    while off < len(data):
        clen, _ = struct.unpack_from("<II", data, off)
        chunks.append(data[off + 8: off + 8 + clen]); off += 8 + clen
    g, b = json.loads(chunks[0]), chunks[1]
    CT = {5126: np.float32, 5125: np.uint32, 5123: np.uint16}
    NC = {"SCALAR": 1, "VEC3": 3}
    def acc(i):
        a = g["accessors"][i]; bv = g["bufferViews"][a["bufferView"]]; n = NC[a["type"]]
        arr = np.frombuffer(b, dtype=CT[a["componentType"]], count=a["count"] * n, offset=bv.get("byteOffset", 0) + a.get("byteOffset", 0))
        return arr.reshape(-1, n) if n > 1 else arr
    p = g["meshes"][0]["primitives"][0]
    return acc(p["attributes"]["POSITION"]).astype(np.float64), acc(p["indices"]).reshape(-1, 3).astype(np.int64)


def drop_long_whisker(P, F):
    # 长须：从鼻头两侧往后拖到脖子后面的那一根，在脸的外侧（|z| > 0.145）、高度 0.15～0.38 之间。
    # 去掉它，换成网页里程序生成、会在水里飘动的龙须（龙角在更高处、颔下的短须在更低处，都不受影响）
    C = P[F].mean(1)
    whisker = (C[:, 2] > .145) & (C[:, 1] > .15) & (C[:, 1] < .38)
    return F[~whisker]


def mirror_half(P, F):
    keep = F[P[F].mean(1)[:, 2] >= 0]                 # 中心在 +z 一侧的三角形
    used = np.unique(keep)
    remap = -np.ones(len(P), np.int64); remap[used] = np.arange(len(used))
    H = P[used].copy(); H[:, 2] = np.maximum(H[:, 2], 0)   # 跨过中线的顶点压到中线上
    Fh = remap[keep]
    on_mid = H[:, 2] < 1e-6
    M = H.copy(); M[:, 2] *= -1
    # 镜像的顶点：在中线上的直接用原来那个（两半共用），其余的接在后面
    mid_map = np.where(on_mid, np.arange(len(H)), 0)
    extra = np.where(~on_mid)[0]
    idx_m = mid_map.copy(); idx_m[extra] = len(H) + np.arange(len(extra))
    Pm = np.vstack([H, M[extra]])
    Fm = idx_m[Fh][:, ::-1]                             # 镜像后绕向反过来，法线才朝外
    return Pm, np.vstack([Fh, Fm])


def jaw_rotate(P, w, ang):
    dx, dy = P[:, 0] - HINGE[0], P[:, 1] - HINGE[1]
    a = ang * w; c, s_ = np.cos(a), np.sin(a)
    Q = P.copy()
    Q[:, 0] = HINGE[0] + dx * c - dy * s_
    Q[:, 1] = HINGE[1] + dx * s_ + dy * c
    return Q


def jaw_weight(P):
    # 下颚：转轴前面、嘴缝以下的部分；靠近转轴的地方按比例少转一些
    x, y = P[:, 0], P[:, 1]
    sm = lambda a, b, t: np.clip((t - a) / (b - a), 0, 1) ** 2 * (3 - 2 * np.clip((t - a) / (b - a), 0, 1))
    return sm(-0.02, -0.14, x) * sm(0.215, 0.185, y)


def to_local(V):
    # 原模型：吻端朝 -x。换成吻端朝 +z、原点在头骨中心：X = z, Y = y, Z = -x
    V = V.copy()
    return np.stack([V[:, 2], V[:, 1], -V[:, 0]], 1)


def write_glb(path, P, D, F):
    P = P.astype(np.float32); D = D.astype(np.float32)
    idx = F.astype(np.uint16 if P.shape[0] < 65536 else np.uint32).ravel()
    blobs = [P.tobytes(), D.tobytes(), idx.tobytes()]
    views, off = [], 0
    for b in blobs:
        views.append({"buffer": 0, "byteOffset": off, "byteLength": len(b)})
        off += (len(b) + 3) // 4 * 4
    bin_ = b"".join(b + b"\0" * ((-len(b)) % 4) for b in blobs)
    gltf = {
        "asset": {"version": "2.0", "generator": "WishWell build_dragon_head.py"},
        "scene": 0, "scenes": [{"nodes": [0]}],
        "nodes": [{"name": "dragon_head", "mesh": 0}],
        "meshes": [{"name": "dragon_head", "primitives": [{"attributes": {"POSITION": 0}, "indices": 2, "targets": [{"POSITION": 1}]}],
                    "weights": [0], "extras": {"targetNames": ["jawOpen"]}}],
        "buffers": [{"byteLength": len(bin_)}],
        "bufferViews": views,
        "accessors": [
            {"bufferView": 0, "componentType": 5126, "count": len(P), "type": "VEC3", "min": P.min(0).tolist(), "max": P.max(0).tolist()},
            {"bufferView": 1, "componentType": 5126, "count": len(D), "type": "VEC3", "min": D.min(0).tolist(), "max": D.max(0).tolist()},
            {"bufferView": 2, "componentType": 5123 if idx.dtype == np.uint16 else 5125, "count": len(idx), "type": "SCALAR"},
        ],
    }
    js = json.dumps(gltf).encode(); js += b" " * ((-len(js)) % 4)
    out = struct.pack("<III", 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(bin_))
    out += struct.pack("<II", len(js), 0x4E4F534A) + js + struct.pack("<II", len(bin_), 0x004E4942) + bin_
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(out)


def main():
    P, F = load_glb(SRC)
    print(f"原模型：{len(P)} 顶点，{len(F)} 三角面")
    F = drop_long_whisker(P, F)
    P, F = mirror_half(P, F)
    print(f"左右对称后：{len(P)} 顶点，{len(F)} 三角面")
    P, F = fast_simplification.simplify(P.astype(np.float32), F.astype(np.int32), target_reduction=1 - TARGET_TRIS / len(F))
    P = P.astype(np.float64); F = F.astype(np.int64)
    print(f"减面后：{len(P)} 顶点，{len(F)} 三角面")
    w = jaw_weight(P)
    Pc = jaw_rotate(P, w, -JAW_CLOSE)            # 基础姿势：嘴合上
    D = jaw_rotate(P, w, JAW_OPEN) - Pc          # 形变目标：从合上的嘴张到最大（总角度 = 合上的角度 + JAW_OPEN）
    L = to_local(Pc - ORIGIN)
    DL = to_local(D)
    write_glb(DST, L, DL, F)
    print(f"{DST.name}：{DST.stat().st_size / 1024:.0f} KB，局部范围 {L.min(0).round(3)} ~ {L.max(0).round(3)}")
    print(f"下颚顶点（会动的）：{(np.abs(D).sum(1) > 1e-5).sum()}")


if __name__ == "__main__":
    main()
