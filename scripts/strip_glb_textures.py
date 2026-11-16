# -*- coding: utf-8 -*-
# 去掉 GLB 里内嵌的贴图（场景里这些模型用的是按世界坐标贴图的石头 / 木头 / 青铜材质，用不上模型自带的贴图），文件小很多。
# 只保留网格数据（顶点、法线、索引）和材质名；uv、切线也去掉。
# 用法：python scripts/strip_glb_textures.py in.glb out.glb
import json, struct, sys

def read(p):
    b = open(p, 'rb').read()
    assert b[:4] == b'glTF'
    n = struct.unpack_from('<I', b, 12)[0]
    js = json.loads(b[20:20 + n])
    off = 20 + n
    bl = struct.unpack_from('<I', b, off)[0]
    return js, b[off + 8: off + 8 + bl]

def write(p, js, bin_):
    j = json.dumps(js, separators=(',', ':')).encode()
    j += b' ' * (-len(j) % 4); bin_ += b'\0' * (-len(bin_) % 4)
    out = struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(j) + 8 + len(bin_))
    out += struct.pack('<II', len(j), 0x4E4F534A) + j + struct.pack('<II', len(bin_), 0x004E4942) + bin_
    open(p, 'wb').write(out)

js, bin_ = read(sys.argv[1])
for m in js.get('materials', []):
    pbr = m.get('pbrMetallicRoughness', {})
    for k in ('baseColorTexture', 'metallicRoughnessTexture'): pbr.pop(k, None)
    for k in ('normalTexture', 'occlusionTexture', 'emissiveTexture'): m.pop(k, None)
for k in ('images', 'textures', 'samplers'): js.pop(k, None)
for mesh in js['meshes']:
    for pr in mesh['primitives']:
        for a in ('TEXCOORD_0', 'TEXCOORD_1', 'TANGENT'): pr['attributes'].pop(a, None)
# 只留还被用到的 accessor 和 bufferView，重新排进一个 buffer
used = set()
for mesh in js['meshes']:
    for pr in mesh['primitives']:
        used.update(pr['attributes'].values())
        if 'indices' in pr: used.add(pr['indices'])
amap, new_acc, vmap, new_views, out = {}, [], {}, [], bytearray()
for i, acc in enumerate(js['accessors']):
    if i not in used: continue
    v = acc['bufferView']
    if v not in vmap:
        bv = js['bufferViews'][v]
        out += b'\0' * (-len(out) % 4)
        nb = dict(bv); nb['byteOffset'] = len(out); nb['buffer'] = 0
        out += bin_[bv.get('byteOffset', 0): bv.get('byteOffset', 0) + bv['byteLength']]
        vmap[v] = len(new_views); new_views.append(nb)
    a = dict(acc); a['bufferView'] = vmap[v]; amap[i] = len(new_acc); new_acc.append(a)
for mesh in js['meshes']:
    for pr in mesh['primitives']:
        pr['attributes'] = {k: amap[v] for k, v in pr['attributes'].items()}
        if 'indices' in pr: pr['indices'] = amap[pr['indices']]
js['accessors'], js['bufferViews'] = new_acc, new_views
js['buffers'] = [{'byteLength': len(out)}]
write(sys.argv[2], js, bytes(out))
print(sys.argv[2], len(out), 'bytes of mesh data')
