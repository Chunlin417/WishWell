// 载入 PBR 贴图（颜色 / 法线 / 粗糙度）：石头和池底来自 Poly Haven（CC0），岸上地面是自己生成的
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

// 岸上地面的 5 套贴图（自己生成的，原图在 textures-src/*_2k.webp，改了之后运行 scripts/pack_ground_textures.py）
// 只有颜色 + 法线，没有粗糙度贴图（见那个脚本的说明）；mean 是颜色贴图的平均色（线性），rough 是平均粗糙度
export const GROUND = {
  grass:  { file: 'lawn_grass',  scale: 1.1, mean: [.0389, .0536, .0180], rough: .89 },
  soil:   { file: 'wet_soil',    scale: .9,  mean: [.0294, .0183, .0137], rough: .62 },
  sand:   { file: 'wet_sand',    scale: .8,  mean: [.0649, .0543, .0398], rough: .59 },
  moss:   { file: 'moss_ground', scale: 1.0, mean: [.0220, .0328, .0078], rough: .86 },
  litter: { file: 'leaf_litter', scale: .7,  mean: [.0688, .0401, .0283], rough: .82 },
};

export function loadAll(renderer) {
  const ground = {};
  for (const [k, g] of Object.entries(GROUND)) {
    ground[k] = { ...g, diff: load(`${g.file}_diff.webp`, true, renderer), nor: load(`${g.file}_nor_gl.webp`, false, renderer) };
  }
  return {
    rock: loadSet('lichen_rock', renderer),
    moss: loadSet('mossy_rock', renderer),
    pebbles: loadSet('ganges_river_pebbles', renderer),
    ground,
  };
}
