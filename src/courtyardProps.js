// 小院里的小模型（public/models/q/，scripts/strip_glb_textures.py 去掉了自带的贴图）和题字的匾额、楹联。
//   鸱吻（屋脊两头）、斗拱（檐柱柱头）、石栏（殿前台基边）、石灯（甬道两侧）、兽面门环、门钉。
// 搭场景时先在要放的地方留一个空的组（slot），模型下载完再按类型合成一批实例（每种模型、每种材质只画一次）。
// 材质用场景里按世界坐标贴图的那几种（石头、旧木、青铜），模型不需要 uv，颜色和院子里其它东西一致。
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const BASE = `${import.meta.env.BASE_URL}models/q/`;
export const PROP_TYPES = ['chiwen', 'dougong', 'stone_railing', 'lantern_outdoor', 'door_ring', 'door_stud'];

// 每个模型：材质名 → 几何体（已经换算到模型自己的原点：底面中心，+Y 向上，+Z 是正面）
export function loadProps(manager) {
  const loader = new GLTFLoader(manager);
  return Promise.all(PROP_TYPES.map(t => loader.loadAsync(BASE + t + '.glb').then(g => {
    const parts = {};
    g.scene.updateMatrixWorld(true);
    g.scene.traverse(o => {
      if (!o.isMesh) return;
      const geo = o.geometry.clone().applyMatrix4(o.matrixWorld);
      const name = o.material?.name || 'default';
      parts[name] = geo;
    });
    return [t, parts];
  }))).then(Object.fromEntries);
}

// slots：[{ type, obj }]（obj 是场景里留好的空组）；mats：{ 类型: { 材质名: 材质, default: 材质 } }
export function placeProps(scene, models, slots, mats, { layer = null } = {}) {
  scene.updateMatrixWorld(true);
  const out = [];
  for (const type of PROP_TYPES) {
    const list = slots.filter(s => s.type === type);
    if (!list.length || !models[type]) continue;
    for (const [name, geo] of Object.entries(models[type])) {
      const m = mats[type]?.[name] || mats[type]?.default;
      if (!m) continue;
      const im = new THREE.InstancedMesh(geo, m, list.length);
      list.forEach((s, i) => im.setMatrixAt(i, s.obj.matrixWorld));
      im.castShadow = type !== 'door_stud'; im.receiveShadow = true;
      im.computeBoundingSphere();
      if (layer !== null) im.layers.enable(layer);
      scene.add(im); out.push(im);
    }
  }
  return out;
}

// 匾额、楹联：空白的黑漆底板（textures/q/sign_*_blank.webp）上写金字。text：竖着写的楹联一字一行；横匾从右往左写
export function createSign(manager, file, text, { vertical = false, w, h }) {
  const c = document.createElement('canvas');
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: .5, metalness: .15 });
  new THREE.ImageLoader(manager).load(`${import.meta.env.BASE_URL}textures/q/${file}`, img => {
    c.width = img.width; c.height = img.height;
    const g = c.getContext('2d'); g.drawImage(img, 0, 0);
    const chars = [...text], n = chars.length;
    const font = '"STKaiti","KaiTi","Kaiti SC","Noto Serif SC","Songti SC",serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    const size = vertical ? Math.min(c.width * .66, c.height * .8 / n) : Math.min(c.height * .6, c.width * .74 / n);
    g.font = `${Math.round(size)}px ${font}`;
    chars.forEach((ch, i) => {
      const x = vertical ? c.width / 2 : c.width / 2 + (n / 2 - i - .5) * size * 1.12;   // 横匾：从右往左
      const y = vertical ? c.height / 2 + (i - (n - 1) / 2) * size * 1.08 : c.height / 2;
      // 金字：先画一层暗的描边当作刻进去的阴影，再画渐变的金色
      g.fillStyle = 'rgba(20,12,4,.85)'; g.fillText(ch, x + size * .03, y + size * .04);
      const gr = g.createLinearGradient(0, y - size / 2, 0, y + size / 2);
      gr.addColorStop(0, '#e9cf8a'); gr.addColorStop(.5, '#c39a4c'); gr.addColorStop(1, '#8c6a2e');
      g.fillStyle = gr; g.fillText(ch, x, y);
    });
    tex.needsUpdate = true;
  });
  const board = new THREE.Mesh(new THREE.BoxGeometry(w, h, .05), [null, null, null, null, mat, null].map(m => m || new THREE.MeshStandardMaterial({ color: 0x1b1410, roughness: .6 })));
  board.castShadow = board.receiveShadow = true;
  return board;
}
