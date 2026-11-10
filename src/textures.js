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
  grass:  { file: 'ground_mossgrass', scale: 1.1, mean: [.0684, .1448, .0041], rough: .88 },   // 苔藓草地（原来的 lawn_grass 不再用）
  soil:   { file: 'wet_soil',    scale: .9,  mean: [.0294, .0183, .0137], rough: .62 },
  sand:   { file: 'shore_mud',   scale: .8,  mean: [.1261, .0642, .0294], rough: .78 },   // 水边一圈湿泥（原来的 wet_sand 不再用）
  moss:   { file: 'moss_ground', scale: 1.0, mean: [.0220, .0328, .0078], rough: .86 },
  litter: { file: 'leaf_litter', scale: .7,  mean: [.0688, .0401, .0283], rough: .82 },
};

// 草的图集（带透明通道，scripts/pack_grass_atlas.py 生成）：图集里各格不能互相"串"，所以不平铺
function loadGrassAtlas(renderer) {
  const t = load('grass_atlas.webp', true, renderer);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

// 带透明通道的图集（不平铺）：植物、落叶
function loadAtlas(file, renderer) {
  const t = load(file, true, renderer);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

export function loadAll(renderer, { dragon = true } = {}) {
  const ground = {};
  for (const [k, g] of Object.entries(GROUND)) {
    ground[k] = { ...g, diff: load(`${g.file}_diff.webp`, true, renderer), nor: load(`${g.file}_nor_gl.webp`, false, renderer) };
  }
  return {
    rock: loadSet('lichen_rock', renderer),
    rocks: ['rock_mossy_a', 'rock_mossy_b', 'rock_lichen'].map(n => loadSet(n, renderer)),   // 围池石块：大片苔藓花岗岩 / 细苔深色花岗岩 / 浅色地衣花岗岩
    foxStone: loadSet('fox_stone', renderer),               // 石狐：浅米色风化花岗岩
    riverbed: loadSet('riverbed_pebbles', renderer),        // 水下的河床卵石
    plants: loadAtlas('groundplants_atlas.webp', renderer), // 三叶草 / 蕨 / 蜂斗菜 / 白花
    leaves: loadAtlas('leaves_atlas.webp', renderer),
    broadleaf: loadAtlas('broadleaf_groundplants_atlas.webp', renderer),   // 夜景：石圈外的阔叶地被
    moonflowers: loadAtlas('whiteflowers_moonglow_atlas.webp', renderer),  // 夜景：月光下发亮的小白花
    wetRock: load('wet_rock_detail_nor_gl.webp', false, renderer),
    leafVeins: load('leaf_veins_nor_gl.webp', false, renderer),             // 夜景近景大叶（3D 模型）的叶脉法线
    nightPano: (t => { t.wrapT = THREE.ClampToEdgeWrapping; return t; })(load('night_canopy_panorama.webp', true, renderer)),   // 夜里水面的倒影：夜空、月亮和四周的树冠
    ripplesRings: load('ripple_rings_nor_gl.webp', false, renderer),        // 夜里水面局部的同心圆涟漪          // 夜里石头表面的湿润细节（法线）       // 枫叶 / 花瓣
    waterNormal: load('water_ripple_nor_gl.webp', false, renderer),   // 水面细小的波纹法线
    canopy: load('canopy_mask.webp', false, renderer),   // 树荫光斑遮罩（R 粗 / G 细）
    moss: loadSet('mossy_rock', renderer),
    pebbles: loadSet('ganges_river_pebbles', renderer),
    ground,
    grass: loadGrassAtlas(renderer),
    // 龙鳞（scripts/pack_dragon_textures.py 生成）：背部大鳞、腹部横纹甲、龙头细鳞
    dragon: dragon ? { back: loadSet('dragon_scales', renderer), belly: loadSet('dragon_belly', renderer), head: loadSet('dragon_head', renderer) } : null,   // 龙关掉时不下载龙鳞贴图
  };
}
