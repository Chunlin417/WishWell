"""把第二批夜景模型（textures-src/*.glb，由 scripts/build-night-assets.mjs 生成）转成网页能直接用的小文件。

用法：python scripts/pack_night_models.py

- rocks_mossy.glb（76 MB，大部分是内嵌的 9 张 2K 贴图——这些贴图项目里已经有了）：只取 10 块岩石的形状，
  合并重复顶点后写成 src/rockShapes.js（位置 + 三角形索引，base64），石头的材质还用现有的三平面贴图
- broadleaf_plants.glb：8 株植物的网格（位置 / 法线 / uv / 顶点色）写成 public/models/broadleaf_plants.bin + .json，
  叶脉法线图压成 public/textures/leaf_veins_nor_gl.webp
- night_canopy_panorama.png → public/textures/night_canopy_panorama.webp（2048×1024）：夜里水面的倒影
- ripple_rings_nor_gl.png → public/textures/ripple_rings_nor_gl.webp（1024）：夜里水面局部的同心圆涟漪
"""
import base64, json, struct
from pathlib import Path
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "textures-src"
TEX = ROOT / "public" / "textures"
MOD = ROOT / "public" / "models"

COMP = {5126: np.float32, 5125: np.uint32, 5123: np.uint16}
NCOMP = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}


def read_glb(path):
    b = path.read_bytes()
    jl = struct.unpack("<I", b[12:16])[0]
    j = json.loads(b[20:20 + jl])
    bin_start = 20 + jl + 8
    def acc(i):
        a = j["accessors"][i]; v = j["bufferViews"][a["bufferView"]]
        dt = COMP[a["componentType"]]; n = NCOMP[a["type"]]
        off = bin_start + v.get("byteOffset", 0) + a.get("byteOffset", 0)
        return np.frombuffer(b, dt, a["count"] * n, off).reshape(a["count"], n) if n > 1 else np.frombuffer(b, dt, a["count"], off)
    def image(i):
        im = j["images"][i]; v = j["bufferViews"][im["bufferView"]]
        off = bin_start + v.get("byteOffset", 0)
        return b[off:off + v["byteLength"]]
    return j, acc, image


def rocks():
    j, acc, _ = read_glb(SRC / "rocks_mossy.glb")
    out = []
    for node in j["nodes"]:
        prim = j["meshes"][node["mesh"]]["primitives"][0]
        p = acc(prim["attributes"]["POSITION"]).astype(np.float64)
        idx = acc(prim["indices"]).astype(np.int64)
        # 合并重复顶点（原文件每个三角形各自三个顶点，是平面着色）：之后在网页里算平滑法线
        key = np.round(p, 5)
        uniq, inv = np.unique(key, axis=0, return_inverse=True)
        idx = inv.reshape(-1)[idx]
        out.append({"name": node["name"], "dims": node.get("extras", {}).get("dimensions_m"),
                    "pos": base64.b64encode(uniq.astype(np.float32).tobytes()).decode(),
                    "idx": base64.b64encode(idx.astype(np.uint16).tobytes()).decode()})
        print(f"  {node['name']}: {len(p)} -> {len(uniq)} 个顶点, {len(idx) // 3} 个三角形")
    js = ("// 由 scripts/pack_night_models.py 从 textures-src/rocks_mossy.glb 生成，不要手改\n"
          "// 10 块岩石的形状：pos = Float32Array（xyz，单位米，原点在底面中心），idx = Uint16Array（三角形）\n"
          f"export const ROCK_SHAPES = {json.dumps(out)};\n")
    (ROOT / "src" / "rockShapes.js").write_text(js, encoding="utf-8")
    print(f"src/rockShapes.js  {len(js) / 1024:.0f} KB")


def plants():
    j, acc, image = read_glb(SRC / "broadleaf_plants.glb")
    chunks, meta, off = [], [], 0
    for node in j["nodes"]:
        prim = j["meshes"][node["mesh"]]["primitives"][0]
        a = prim["attributes"]
        arrs = {"pos": acc(a["POSITION"]), "nrm": acc(a["NORMAL"]), "uv": acc(a["TEXCOORD_0"]), "col": acc(a["COLOR_0"])[:, :3], "idx": acc(prim["indices"]).astype(np.uint32)}
        m = {"name": node["name"], "species": node.get("extras", {}).get("species"), "material": prim["material"], "count": len(arrs["pos"])}
        for k, v in arrs.items():
            v = np.ascontiguousarray(v, np.uint32 if k == "idx" else np.float32)
            m[k] = [off, v.size]; chunks.append(v.tobytes()); off += v.nbytes
        meta.append(m)
    mats = [{"name": mm["name"], "color": mm["pbrMetallicRoughness"].get("baseColorFactor", [1, 1, 1, 1])[:3],
             "roughness": mm["pbrMetallicRoughness"].get("roughnessFactor", .6)} for mm in j["materials"]]
    MOD.mkdir(parents=True, exist_ok=True)
    (MOD / "broadleaf_plants.bin").write_bytes(b"".join(chunks))
    (MOD / "broadleaf_plants.json").write_text(json.dumps({"meshes": meta, "materials": mats}), encoding="utf-8")
    print(f"public/models/broadleaf_plants.bin  {off / 1024:.0f} KB, {len(meta)} 株")
    if j.get("images"):
        from io import BytesIO
        im = Image.open(BytesIO(image(0))).convert("RGB").resize((1024, 1024), Image.LANCZOS)
        im.save(TEX / "leaf_veins_nor_gl.webp", "WEBP", quality=90, method=6)
        print("public/textures/leaf_veins_nor_gl.webp")


def textures():
    Image.open(SRC / "night_canopy_panorama.png").convert("RGB").resize((2048, 1024), Image.LANCZOS).save(TEX / "night_canopy_panorama.webp", "WEBP", quality=86, method=6)
    Image.open(SRC / "ripple_rings_nor_gl.png").convert("RGB").resize((1024, 1024), Image.LANCZOS).save(TEX / "ripple_rings_nor_gl.webp", "WEBP", quality=92, method=6)
    print("public/textures/night_canopy_panorama.webp, ripple_rings_nor_gl.webp")


if __name__ == "__main__":
    rocks(); plants(); textures()
