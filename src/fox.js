// 守愿石狐：Tripo 生成、经 scripts/optimize-glb.mjs 精简后的模型（public/models/shihu-tripo.glb），自带颜色 / 法线 / 粗糙度贴图。
// 横屏时立在池子左右两侧，侧身朝向池子、目视前方（右边那只镜像，两只的尾巴都在远离镜头的一侧）。
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { patch } from './patch.js';
import { fbm3 } from './noise.js';

const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };

// 石狐原来的颜色贴图（暖黄褐色、带烤进去的明暗）不再当颜色用：只取它的明暗，作为雕刻缝隙里的暗部和细节，
// 乘在花岗岩上；红项圈单独保留下来，改成褪色的暗红（像布被雨淋了很多年）
function detailFromMap(map) {
  const img = map.image, w = img.width, h = img.height;
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const g = cv.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, w, h), p = d.data;
  const isRed = i => p[i] > 60 && p[i] > p[i + 1] * 1.55 && p[i] > p[i + 2] * 1.55;
  let sum = 0, n = 0;
  for (let i = 0; i < p.length; i += 4) if (!isRed(i)) { sum += .3 * p[i] + .59 * p[i + 1] + .11 * p[i + 2]; n++; }
  const mean = sum / Math.max(n, 1);
  for (let i = 0; i < p.length; i += 4) {
    const L = (.3 * p[i] + .59 * p[i + 1] + .11 * p[i + 2]) / mean;
    if (isRed(i)) { const k = clamp(.75 + .35 * L, 0, 1.1) * 255; p[i] = Math.min(255, k * .95); p[i + 1] = k * .36; p[i + 2] = k * .32; }
    else { const v = clamp(.8 * Math.pow(L, 1.6)) * 255; p[i] = p[i + 1] = p[i + 2] = v; }
  }
  g.putImageData(d, 0, 0);
  const t = new THREE.CanvasTexture(cv);
  t.flipY = map.flipY; t.channel = map.channel; t.wrapS = map.wrapS; t.wrapT = map.wrapT; t.anisotropy = 8;
  t.colorSpace = THREE.NoColorSpace;   // 存的是乘数，不是颜色
  return t;
}

// 风化：底座下半截发暗、沾泥；朝上的面和底座脚下零星长苔
function weather(geo) {
  geo.computeBoundingBox();
  const { min, max } = geo.boundingBox, H = max.y - min.y, S = 6 / H;
  const p = geo.attributes.position, nr = geo.attributes.normal;
  const col = new Float32Array(p.count * 3), moss = new Float32Array(p.count);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), u = (y - min.y) / H;
    const b = (.55 + .45 * sstep(0, .24, u)) * (.9 + .2 * fbm3(x * S, y * S, z * S, 3));
    col[i * 3] = b * .98; col[i * 3 + 1] = b; col[i * 3 + 2] = b * 1.01;
    moss[i] = Math.max(sstep(.55, .92, nr.getY(i)) * sstep(.5, .66, fbm3(x * S * .8 + 7, y * S * .8, z * S * .8, 3)),
                       (1 - sstep(.04, .2, u)) * .8 * sstep(.42, .6, fbm3(x * S + 3, y * S, z * S + 3, 3)));
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('aMoss', new THREE.BufferAttribute(moss, 1));
}

const SCALE = 3.3;   // 比最初大约一半，是许愿入口，要一眼注意到
const YAW = -Math.PI / 2;   // 模型本身面朝 +x，转到 +z
export const FOX_Z = 1.3;   // 石狐所在的 z：池子最宽处稍靠镜头一侧；pool.js 会在这附近避开摆放零散的石头

export function buildFoxes(scene, { floorH, poolK, tex = null }) {
  const root = new THREE.Group(); scene.add(root);
  const items = [];
  let show = true, gap = 1.4, sizeK = 1, ready = false;
  // 池子不是正圆：分别找到这一侧池边（z = FOX_Z 处）的位置，两只石狐离各自的池边距离相同
  const rimX = side => { let x = 2.5; while (x < 9 && poolK(side * x, FOX_Z) < 1) x += .02; return x; };

  function place(it) {
    const x = it.side * (rimX(it.side) + gap), z = FOX_Z;
    it.g.position.set(x, floorH(x, z) - .03, z);
    // 侧身朝向池子、目视前方（不看镜头）；只朝镜头偏一点点，让脸的轮廓看得清
    it.g.rotation.y = -it.side * 1.0;
    it.g.scale.set(SCALE * sizeK * (it.side > 0 ? -1 : 1), SCALE * sizeK, SCALE * sizeK);
    it.g.visible = show;
  }

  new GLTFLoader().load(`${import.meta.env.BASE_URL}models/shihu-tripo.glb`, gltf => {
    let src = null;
    gltf.scene.traverse(o => { if (o.isMesh && !src) src = o; });
    const s = src.material;
    // 和池边的石头同一种花岗岩（同一套贴图、同样的冷灰色），颗粒细一点、颜色浅一点、裂纹少：
    // 看得出是被人雕出来、又被雨水磨了很多年的；雕刻的细节来自模型自带的法线贴图和原贴图的明暗
    const mat = tex?.rock && s.map
      ? (weather(src.geometry), patch(new THREE.MeshStandardMaterial({
          map: detailFromMap(s.map), normalMap: s.normalMap, vertexColors: true, roughness: 1, metalness: 0, envMapIntensity: .55,
        }), { underwater: false, tex: { mode: 'rock', sets: [tex.rock, tex.moss], scale: [2.2, 2.4], gray: .9, bright: 1.7, soft: .8, contrast: .45, tint: [.97, .98, 1.01], crack: 0 } }))
      : patch(new THREE.MeshStandardMaterial({   // 没有石材贴图时：还用模型自带的贴图
          map: s.map, normalMap: s.normalMap, roughnessMap: s.roughnessMap, metalnessMap: s.metalnessMap,
          roughness: 1, metalness: s.metalnessMap ? 1 : 0, envMapIntensity: .6,
        }), { underwater: false });
    for (const side of [-1, 1]) {
      const g = new THREE.Group();
      const m = new THREE.Mesh(src.geometry, mat); m.castShadow = m.receiveShadow = true; m.rotation.y = YAW; g.add(m);
      g.scale.set(SCALE * (side > 0 ? -1 : 1), SCALE, SCALE);
      root.add(g);
      const it = { g, side }; items.push(it); place(it);
    }
    ready = true;
  });

  return {
    objects: [root],   // 折射时要隐藏（都在水面以上）
    // 横屏时按屏幕宽度摆到两侧；竖屏没有空间就不显示
    // g：石狐离池边的距离；k：大小系数
    layout(s, g, k = 1) { show = s; gap = g; sizeK = k; if (ready) items.forEach(place); },
    // 点到了哪只石狐：返回 side（-1 / 1，模型所在的一侧）和点中的位置；没点到返回 null
    pick(raycaster) {
      if (!ready || !show) return null;
      const hit = raycaster.intersectObjects(items.map(it => it.g), true)[0];
      if (!hit) return null;
      const it = items.find(it => { let o = hit.object; while (o) { if (o === it.g) return true; o = o.parent; } return false; });
      return it ? { side: it.side, point: hit.point } : null;
    },
  };
}
