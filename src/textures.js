// 载入 Poly Haven 的 CC0 PBR 贴图（颜色 / 法线 / 粗糙度）
// public/textures 里是压缩后的 WebP；原始 JPG 在 textures-src/，改了之后运行 scripts/compress_textures.py 重新生成
import * as THREE from 'three';

const loader = new THREE.TextureLoader();
const BASE = `${import.meta.env.BASE_URL}textures/`;

function load(file, srgb, renderer) {
  const t = loader.load(BASE + file);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  return t;
}

export function loadSet(name, renderer) {
  return {
    diff: load(`${name}_diff.webp`, true, renderer),
    nor: load(`${name}_nor_gl.webp`, false, renderer),
    rough: load(`${name}_rough.webp`, false, renderer),
  };
}

export function loadAll(renderer) {
  return {
    rock: loadSet('lichen_rock', renderer),
    moss: loadSet('mossy_rock', renderer),
    pebbles: loadSet('ganges_river_pebbles', renderer),
    ground: loadSet('forest_ground_04', renderer),
  };
}
