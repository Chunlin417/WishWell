// 小院的材质和贴图。和许愿池的材质（patch.js）分开：池子那套带着水下、积雪、雨湿、昼夜等状态，小院是固定的清晨，用不上。
// 石头、地面、木头都按世界坐标贴图（三个方向各贴一次再混合），所以方块、圆柱、树干不用展 UV，贴图的疏密到处一致
import * as THREE from 'three';
import { NOISE_GLSL } from './shaders.js';

const BASE = `${import.meta.env.BASE_URL}textures/`;

export function loadCourtTextures(renderer, manager) {
  const loader = new THREE.TextureLoader(manager), aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const load = (file, srgb, repeat = true) => {
    const t = loader.load(BASE + file);
    t.wrapS = t.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping; t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.anisotropy = aniso;
    return t;
  };
  const set = n => ({ diff: load(`${n}_diff.webp`, true), nor: load(`${n}_nor_gl.webp`, false), rough: load(`${n}_rough.webp`, false) });
  return {
    paving: set('rock_lichen'),      // 青石板：浅色地衣花岗岩
    wall: set('rock_mossy_a'),       // 院墙：大片苔藓的花岗岩
    rock: set('rock_mossy_b'),       // 散石、台基
    pebbles: set('ganges_river_pebbles'),   // 殿里水池边的卵石
    moss: { diff: load('moss_ground_diff.webp', true), nor: load('moss_ground_nor_gl.webp', false) },
    canopy: load('canopy_mask.webp', false),            // 叶影遮罩（R 粗 / G 细）：树荫光斑用
    plants: load('groundplants_atlas.webp', true, false),   // 三叶草 / 蕨 / 蜂斗菜 / 白花（带透明通道的图集）
    grass: load('grass_atlas.webp', true, false),           // 草丛图集
    // 东方寺庙素材包（scripts/pack_temple_textures.py 从 UE5 素材包转换）：古树皮、古殿旧木材、灰色筒瓦、阔叶枝条图集
    bark: set('temple_bark'), wood: set('temple_wood'), roof: set('temple_roof'),
    leaves: load('temple_leaves_diff.webp', true, false),
  };
}

// 顶点着色器里算出世界坐标和世界法线（vWp、vWn），片元着色器按它们贴图
function worldVary(sh) {
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vWp; varying vec3 vWn;')
    .replace('#include <project_vertex>', /* glsl */`
      {
        vec4 wp4 = vec4(transformed, 1.); vec3 wn3 = objectNormal;
        #ifdef USE_INSTANCING
          wp4 = instanceMatrix * wp4; wn3 = mat3(instanceMatrix) * wn3;
        #endif
        vWp = (modelMatrix * wp4).xyz; vWn = normalize(mat3(modelMatrix) * wn3);
      }
      #include <project_vertex>`);
}

// 按世界坐标贴图的石头 / 地面 / 木头材质
// set：{ diff, nor?, rough? }；scale：每米重复几次；moss：苔藓贴图（给了才长苔）
// mossAmt：苔藓最多盖住多少；mossAt：越小苔藓越多（朝上的面、靠近地面的地方先长）；grime：墙脚的潮气和污迹
// paving：{ yard: [minX, maxX, minZ, maxZ], tree: [x, z, r] } 把地面切成一块块石板，石缝里是泥土和苔，墙根、树根周围长苔，院外全是苔地
// blocks：砌石墙——一层层错缝的石块，缝里更暗、更容易长苔
// weather：旧木头——大块的色差、竖向的雨痕、靠近地面受潮发暗、局部褪成灰白（0 = 没有，1 = 明显）；weatherY：木构件脚下的高度
export function triMat({ set, moss = null, scale = .5, color = 0xffffff, mossAmt = .8, mossAt = .5, mossScale = .7, grime = 0, wet = 0, roughMul = 1, norK = 1, roughness = 1, paving = null, blocks = false, weather = 0, weatherY = 0, wood = false }) {
  const mat = new THREE.MeshStandardMaterial({ color, roughness });
  const D = {};
  if (set.nor) D.HAS_NOR = ''; if (set.rough) D.HAS_ROUGH = ''; if (moss) D.HAS_MOSS = ''; if (paving) D.PAVING = ''; if (blocks) D.BLOCKS = ''; if (weather) D.WEATHER = '';
  if (wood) D.WOOD = '';
  mat.defines = { ...(mat.defines || {}), ...D };
  const U = {
    tDiff: { value: set.diff }, tNor: { value: set.nor || null }, tRough: { value: set.rough || null },
    tMossD: { value: moss?.diff || null }, tMossN: { value: moss?.nor || null },
    uTri: { value: new THREE.Vector4(scale, norK, roughMul, mossScale) },
    uMoss: { value: new THREE.Vector4(mossAmt, mossAt, grime, wet) },
    uWeather: { value: new THREE.Vector2(weather, weatherY) },
    uYard: { value: new THREE.Vector4(...(paving?.yard || [0, 0, 0, 0])) }, uTree: { value: new THREE.Vector3(...(paving?.tree || [0, 0, 0])) },
  };
  mat.customProgramCacheKey = () => 'court-tri-' + Object.keys(D).join('-');
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, U);
    worldVary(sh);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', /* glsl */`#include <common>
        varying vec3 vWp; varying vec3 vWn;
        uniform sampler2D tDiff; uniform vec4 uTri; uniform vec4 uMoss; uniform vec2 uWeather;
        #ifdef HAS_NOR
          uniform sampler2D tNor;
        #endif
        #ifdef HAS_ROUGH
          uniform sampler2D tRough;
        #endif
        #ifdef HAS_MOSS
          uniform sampler2D tMossD; uniform sampler2D tMossN;
        #endif
        #ifdef PAVING
          uniform vec4 uYard; uniform vec3 uTree;
        #endif
        ${NOISE_GLSL}
        vec3 gW; vec3 gWn; vec2 gUx; vec2 gUy; vec2 gUz; float gMoss = 0.; float gWet = 0.; float gPuddle = 0.;
        vec4 tri(sampler2D t){ return texture2D(t, gUx) * gW.x + texture2D(t, gUy) * gW.y + texture2D(t, gUz) * gW.z; }
      `)
      .replace('#include <map_fragment>', /* glsl */`#include <map_fragment>
        {
          gWn = normalize(vWn);
          gW = pow(abs(gWn), vec3(4.)); gW /= (gW.x + gW.y + gW.z);
          vec3 tp = vWp * uTri.x;
          gUx = tp.zy; gUy = tp.xz; gUz = tp.xy;
          float grime = uMoss.z * smoothstep(1., 0., vWp.y);
          float mossBias = 0.; float tint = 1.; float soil = 0.;
          #ifdef PAVING
            // 石板：一排排错缝铺，每排的石板宽窄不同，有的两块并成一长条；缝的边缘用噪声搅得参差不齐
            float inYard = step(uYard.x, vWp.x) * step(vWp.x, uYard.y) * step(uYard.z, vWp.z) * step(vWp.z, uYard.w);
            float slabH = .62, row = floor(vWp.z / slabH), fz = fract(vWp.z / slabH);
            float slabW = mix(.7, 1.5, hash12(vec2(row, 3.7)));
            float sx = (vWp.x + hash12(vec2(row, 9.1)) * 5.) / slabW, col = floor(sx), fx = fract(sx);
            float mergeR = step(.74, hash12(vec2(col, row) + 41.)), mergeL = step(.74, hash12(vec2(col - 1., row) + 41.));
            float edge = min(min(mix(fx, 1., mergeL), mix(1. - fx, 1., mergeR)) * slabW, min(fz, 1. - fz) * slabH) + (fbm2(vWp.xz * 7.) - .5) * .034;
            float gap = (1. - smoothstep(.006, .042, edge)) * inYard;
            soil = (1. - smoothstep(0., .017, edge)) * inYard;
            float slabId = hash12(vec2(col - mergeL, row) + 17.);
            gUy += vec2(slabId * 7.3, slabId * 3.1);   // 每块石板取贴图上不同的位置：花纹不会连着跨过石缝
            float edgeD = min(min(vWp.x - uYard.x, uYard.y - vWp.x), min(vWp.z - uYard.z, uYard.w - vWp.z));
            float treeD = length(vWp.xz - uTree.xy) - uTree.z;
            mossBias = max(smoothstep(1.9, .1, edgeD), smoothstep(2.2, .1, treeD)) * .45 + gap * 2. + (1. - inYard) * 2.;
            tint = mix(.72, 1.08, slabId) * mix(.7, 1., smoothstep(0., .1, edge));   // 每块石板深浅略不同；靠近石缝的一圈暗一些（磨圆的棱）
            float wn = fbm2(vWp.xz * .27 + 3.);
            gPuddle = smoothstep(.6, .66, wn + (slabId - .5) * .06) * inYard * (1. - gap) * uMoss.w;   // 低洼处一小滩积水
            gWet = max(smoothstep(.4, .6, wn) * .75, gPuddle) * uMoss.w * inYard;                      // 周围一片还没干的水迹
          #endif
          #ifdef BLOCKS
            // 砌石：一层层石块错缝垒起来（顶面不画缝）
            float along = gW.x > gW.z ? vWp.z : vWp.x;
            float bh = .31, brow = floor(vWp.y / bh), bfy = fract(vWp.y / bh);
            float bw = mix(.38, .9, hash12(vec2(brow, 5.3)));
            float bx = (along + hash12(vec2(brow, 1.9)) * 3.) / bw, bcol = floor(bx), bfx = fract(bx);
            float bedge = min(min(bfx, 1. - bfx) * bw, min(bfy, 1. - bfy) * bh) + (fbm2(vec2(along, vWp.y) * 8.) - .5) * .04;
            float joint = (1. - smoothstep(0., .04, bedge)) * (1. - gW.y);
            float bid = hash12(vec2(bcol, brow) + 3.);
            gUx += vec2(bid * 5., bid * 3.); gUz += vec2(bid * 4., bid * 6.);
            tint = mix(.7, 1.15, bid) * mix(1., .38, joint);
            mossBias += joint * .5;
          #endif
          vec3 base = tri(tDiff).rgb * tint;
          #ifdef WOOD
            // Desaturated old timber with subtle longitudinal fibres, not glossy red lacquer.
            float luminance = dot(base, vec3(.2126, .7152, .0722));
            base = mix(base, vec3(luminance) * vec3(1.14, 1.02, .85), .68);
            float grain = vnoise(vec2(dot(vWp.xz, vec2(.83, .55)) * 85., vWp.y * 2.6));
            base *= .9 + .14 * grain;
          #endif
          #ifdef WEATHER
          {
            float ws = fbm2(vWp.xz * 1.3 + vWp.y * 1.1);                                   // 大块的色差
            float wv = fbm2(vec2(dot(vWp.xz, vec2(.7, .71)) * 6., vWp.y * .6));            // 竖向的雨痕
            float damp = smoothstep(uWeather.y + 1.1, uWeather.y, vWp.y);                  // 靠近地面的一截受潮发暗
            vec3 w = base * mix(.6, 1.12, ws) * mix(.72, 1.06, wv) * (1. - .45 * damp);
            w = mix(w, vec3(dot(w, vec3(.34))) * vec3(1.06, 1.02, .94) * 1.25, smoothstep(.56, .8, ws) * .55);   // 局部褪成灰白（漆掉了、木头露出来）
            w = mix(w, w * vec3(.7, .85, .6), damp * smoothstep(.4, .7, wv) * .6);          // 脚下泛一点青
            base = mix(base, w, uWeather.x);
          }
          #endif
          diffuseColor.rgb *= base * (1. - .4 * grime);
          #ifdef HAS_MOSS
            float mn = fbm2(vWp.xz * 1.1 + vWp.y * 1.7);
            gMoss = smoothstep(uMoss.y - .12, uMoss.y + .12, gWn.y * .5 + mn * .9 - .5 + grime * .4 + mossBias) * uMoss.x;
            vec2 ms = vec2(uTri.w);
            vec3 mc = (texture2D(tMossD, vWp.zy * ms) * gW.x + texture2D(tMossD, vWp.xz * ms) * gW.y + texture2D(tMossD, vWp.xy * ms) * gW.z).rgb;
            diffuseColor.rgb = mix(diffuseColor.rgb, mc * vec3(2.1, 2.3, 1.7), gMoss);
          #endif
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.035, .026, .016) * (.7 + .6 * vnoise(vWp.xz * 60.)), soil * .85);   // 石缝正中露出泥土
          diffuseColor.rgb *= 1. - .5 * gWet * (1. - gMoss);   // 湿的石面颜色更深
        }`)
      .replace('#include <roughnessmap_fragment>', /* glsl */`
        float roughnessFactor = roughness;
        #ifdef HAS_ROUGH
          roughnessFactor *= tri(tRough).g;
        #endif
        roughnessFactor = clamp(roughnessFactor * uTri.z * mix(.82, 1.12, vnoise(vWp.xz * 2.3 + vWp.y)), .05, 1.);   // 粗糙度本身也有深浅
        roughnessFactor = mix(roughnessFactor, .92, gMoss);
        roughnessFactor = mix(roughnessFactor, .3, gWet * (1. - gMoss));
        roughnessFactor = mix(roughnessFactor, .04, gPuddle * (1. - gMoss));
        #ifdef WOOD
          roughnessFactor = max(.78, roughnessFactor);
        #endif`)
      .replace('#include <normal_fragment_maps>', /* glsl */`#include <normal_fragment_maps>
        #ifdef HAS_NOR
        {
          vec3 tx = texture2D(tNor, gUx).xyz * 2. - 1., ty = texture2D(tNor, gUy).xyz * 2. - 1., tz = texture2D(tNor, gUz).xyz * 2. - 1.;
          #ifdef HAS_MOSS
            ty = mix(ty, texture2D(tMossN, vWp.xz * uTri.w).xyz * 2. - 1., gMoss);
          #endif
          float nk = uTri.y * (1. - .5 * gWet * (1. - gMoss)) * (1. - gPuddle * (1. - gMoss));   // 积水的地方是平的
          tx.xy *= nk; ty.xy *= nk; tz.xy *= nk;
          tx = vec3(tx.xy + gWn.zy, abs(tx.z) * gWn.x);
          ty = vec3(ty.xy + gWn.xz, abs(ty.z) * gWn.y);
          tz = vec3(tz.xy + gWn.xy, abs(tz.z) * gWn.z);
          normal = normalize((viewMatrix * vec4(normalize(tx.zyx * gW.x + ty.xzy * gW.y + tz.xyz * gW.z), 0.)).xyz);
        }
        #endif`);
  };
  return mat;
}

// 青铜：铜褐色的底，上面一片片铜绿（按世界坐标的噪声分布）；铜绿处粗糙、不反光，露铜处有金属光泽
export function bronzeMat() {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .5, metalness: .9 });
  mat.customProgramCacheKey = () => 'court-bronze';
  mat.onBeforeCompile = sh => {
    worldVary(sh);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vWp; varying vec3 vWn;\n${NOISE_GLSL}\nfloat gPat = 0.;`)
      .replace('#include <map_fragment>', /* glsl */`#include <map_fragment>
        {
          float n = fbm2(vWp.xy * 4. + vWp.z * 3.) * .6 + fbm2(vWp.zy * 3.5 + vWp.x * 2.5 + 9.) * .4;
          gPat = smoothstep(.3, .7, n + (1. - abs(normalize(vWn).y)) * .08);
          diffuseColor.rgb = mix(vec3(.16, .105, .05), vec3(.085, .165, .13), gPat) * (.8 + .4 * vnoise(vWp.xz * 40. + vWp.y * 31.));
        }`)
      .replace('#include <metalnessmap_fragment>', /* glsl */`#include <metalnessmap_fragment>
        metalnessFactor = mix(.9, .35, gPat); roughnessFactor = mix(.42, .8, gPat);`);
  };
  return mat;
}

// 殿里猫像的青铜：和香炉一样的铜底、铜绿，但更旧——铜绿更多；凸起的纹饰（模型里的 _relief）被摸得发亮，露出铜色；
// 模型的顶点色里烘了凹处的暗部
export function statueMat() {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .72, metalness: .55, vertexColors: true, envMapIntensity: .32 });
  mat.customProgramCacheKey = () => 'court-statue-aged';
  mat.onBeforeCompile = sh => {
    worldVary(sh);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float _relief; varying float vRelief;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRelief = _relief;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vWp; varying vec3 vWn; varying float vRelief;\n${NOISE_GLSL}\nfloat gPat = 0.;`)
      .replace('#include <map_fragment>', /* glsl */`#include <map_fragment>
        {
          float n = fbm2(vWp.xy * 3.2 + vWp.z * 2.4) * .6 + fbm2(vWp.zy * 2.8 + vWp.x * 2. + 9.) * .4;
          gPat = smoothstep(.3, .62, n + (1. - abs(normalize(vWn).y)) * .08) * (1. - .62 * vRelief);
          vec3 c = mix(vec3(.155, .112, .067), vec3(.105, .155, .128), gPat);
          c = mix(c, vec3(.34, .245, .125), vRelief * .68);
          diffuseColor.rgb *= c * (.86 + .2 * vnoise(vWp.xz * 23. + vWp.y * 17.));
        }`)
      .replace('#include <metalnessmap_fragment>', /* glsl */`#include <metalnessmap_fragment>
        metalnessFactor = mix(.58, .18, gPat);
        roughnessFactor = max(roughnessFactor, mix(.66, .91, gPat));`);
  };
  return mat;
}

// 屋瓦材质：素材包里的灰色筒瓦（颜色、法线、粗糙度）+ 瓦面上零星的苔藓、深浅不匀的水渍。
// 屋顶的贴图坐标按"一列瓦 = 1、一排瓦长 = 1.6"算（见 roofGeo）；素材里一张图横着 13 列、竖着约 14.4 排，瓦片近似方形
export function roofMat(set, { cols = 13, rows = 14.4, rowLen = 1.6 * 79 / 71 } = {}) {
  for (const t of [set.diff, set.nor, set.rough]) t.repeat.set(1 / cols, rowLen / rows);
  const mat = new THREE.MeshStandardMaterial({ map: set.diff, normalMap: set.nor, roughnessMap: set.rough, roughness: 1, side: THREE.DoubleSide });
  mat.customProgramCacheKey = () => 'court-roof';
  mat.onBeforeCompile = sh => {
    worldVary(sh);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vWp; varying vec3 vWn;\n${NOISE_GLSL}`)
      .replace('#include <map_fragment>', /* glsl */`#include <map_fragment>
        {
          float m = smoothstep(.6, .78, fbm2(vWp.xz * .55 + 5.) + .15 * vnoise(vWp.xz * 6.));
          diffuseColor.rgb *= .8 + .35 * fbm2(vWp.xz * 1.3);   // 瓦面深浅不匀（也打散贴图的重复）
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.06, .09, .028) * (.7 + .6 * vnoise(vWp.xz * 23.)), m * .5);
        }`);
  };
  return mat;
}

// 四面坡屋顶：w × d 是檐口的长和宽，h 是屋顶高，ridge 是正脊长度占 w 的比例，lift 是檐角起翘的高度（飞檐）。
// 坡面是凹的（靠近屋脊陡、靠近檐口缓）；贴图坐标按米算（tile 米一列瓦），瓦垄互相平行、在戗脊处被裁开。
// geometry.userData.eave：檐口上每一垄筒瓦末端的位置和朝外的方向（放瓦当用）
export function roofGeo(w, d, h, { ridge = .45, lift = .35, seg = 16, rows = 8, tile = .26 } = {}) {
  const pos = [], uv = [], idx = [], eavePts = [];
  const eave = [[-w / 2, d / 2], [w / 2, d / 2], [w / 2, -d / 2], [-w / 2, -d / 2]];
  const top = [[-w * ridge / 2, d * .02], [w * ridge / 2, d * .02], [w * ridge / 2, -d * .02], [-w * ridge / 2, -d * .02]];
  const out = [[0, 1], [1, 0], [0, -1], [-1, 0]];
  const liftAt = f => lift * Math.pow(Math.abs(2 * f - 1), 2.6);
  for (let k = 0; k < 4; k++) {
    const e0 = eave[k], e1 = eave[(k + 1) % 4], t0 = top[k], t1 = top[(k + 1) % 4], base = pos.length / 3;
    const alongX = k % 2 === 0;   // 前后两坡的瓦垄沿 z 往下流（u 取 x）；左右两坡取 z
    const run = alongX ? d / 2 : w / 2 * (1 - ridge), slope = Math.hypot(run, h);
    for (let i = 0; i <= seg; i++) {
      const f = i / seg;
      for (let j = 0; j <= rows; j++) {
        const a = j / rows;
        const x = (e0[0] + (e1[0] - e0[0]) * f) * (1 - a) + (t0[0] + (t1[0] - t0[0]) * f) * a;
        const z = (e0[1] + (e1[1] - e0[1]) * f) * (1 - a) + (t0[1] + (t1[1] - t0[1]) * f) * a;
        pos.push(x, h * Math.pow(a, 1.7) + liftAt(f) * (1 - a) * (1 - a), z);
        uv.push((alongX ? x : z) / tile, a * slope / (tile * 1.6));
      }
    }
    for (let i = 0; i < seg; i++) for (let j = 0; j < rows; j++) {
      const p = base + i * (rows + 1) + j, q = p + rows + 1;
      idx.push(p, q, p + 1, q, q + 1, p + 1);
    }
    // 瓦当：每垄筒瓦的中线（贴图里筒瓦占一列的前 42%）落在檐口上的点
    const c0 = alongX ? e0[0] : e0[1], c1 = alongX ? e1[0] : e1[1], lo = Math.min(c0, c1), hi = Math.max(c0, c1);
    for (let n = Math.ceil(lo / tile - .21); (n + .21) * tile < hi; n++) {
      const c = (n + .21) * tile, f = (c - c0) / (c1 - c0);
      eavePts.push({ x: alongX ? c : e0[0], y: liftAt(f), z: alongX ? e0[1] : c, nx: out[k][0], nz: out[k][1] });
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  g.userData.eave = eavePts;
  return g;
}
