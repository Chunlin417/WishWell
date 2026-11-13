// 小院里的古树：精简、重塑过的 Tripo 模型（scripts/build-tree.mjs 生成 public/models/ancient_tree.glb 和 .json）+ 树叶卡片。
// 模型没有 UV 和贴图：树皮用世界坐标贴图的材质（courtyardMats.js 的 triMat），苔藓顺着树根和朝上的面往上长。
// 树叶：素材包里的阔叶枝条图集（六枝，每张卡只取其中一枝），一张张平铺在枝条上方、朝外伸展，
// 叶片之间留着空隙——从树下抬头能看到天光、枝干和被阳光照透的叶子。院外的树林用的是同一套叶片。
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const rng = seed => () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const BASE = `${import.meta.env.BASE_URL}models/`;

// 一张平铺的叶片卡：小枝的根在原点，朝 -z 伸出去，越到枝梢越往下垂
function sprayGeo() {
  const g = new THREE.PlaneGeometry(1, 1, 2, 4); g.rotateX(-Math.PI / 2); g.translate(0, 0, -.5);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const d = -p.getZ(i), x = p.getX(i); p.setY(i, -d * d * .22 - x * x * .35); }   // 枝梢下垂，两侧也略微下卷
  g.computeVertexNormals();
  return g;
}

// 阔叶图集里每一枝的 uv 范围（v 朝上）和宽高比：scripts/pack_temple_textures.py 打印出来的
export const LEAF_CELLS = [[[0.0376, 0.5615, 0.3359, 0.9199], 0.832], [[0.3301, 0.5542, 0.6694, 0.9033], 0.972], [[0.6636, 0.5688, 0.9868, 0.9482], 0.852], [[0.0239, 0.1060, 0.3359, 0.4468], 0.915], [[0.3301, 0.0913, 0.6694, 0.4634], 0.912], [[0.6636, 0.1128, 0.9814, 0.4678], 0.895]];

// 叶片的材质 + 往场景里撒叶片卡的工具。古树、院外的树林、墙头垂下来的枝叶都用它。map：阔叶图集
export function createLeafKit(sunDir, map) {
  const uniforms = { uTime: { value: 0 }, uSun: { value: sunDir }, uSunCol: { value: new THREE.Color(1, .9, .5) } };
  const mat = new THREE.MeshStandardMaterial({ map, alphaTest: .4, side: THREE.DoubleSide, roughness: .7 });
  mat.customProgramCacheKey = () => 'court-leaf';
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aCell; uniform float uTime;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvMapUv = vMapUv * aCell.zw + aCell.xy;')
      .replace('#include <begin_vertex>', /* glsl */`#include <begin_vertex>
        {
          vec3 ip = instanceMatrix[3].xyz;
          float ph = ip.x * .9 + ip.z * 1.3 + ip.y * .5, k = -position.z;   // 越靠近枝梢摆得越多
          transformed.y += (sin(uTime * 1.3 + ph) * .04 + sin(uTime * 2.9 + ph * 2.) * .015) * k;
          transformed.x += cos(uTime * 1.0 + ph * 1.3) * .03 * k;
        }`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uSun; uniform vec3 uSunCol;')
      .replace('#include <opaque_fragment>', /* glsl */`
        {
          // 透光：从叶子背面看（阳光在叶子另一侧）时，叶片被照透，发出黄绿色的光
          vec3 Ls = normalize((viewMatrix * vec4(uSun, 0.)).xyz);
          float thru = max(dot(-normal, Ls), 0.);
          float back = pow(max(dot(-normalize(vViewPosition), Ls), 0.), 2.);
          outgoingLight += diffuseColor.rgb * uSunCol * (thru * .3 + back * .16);
        }
        #include <opaque_fragment>`);
  };
  const geo = sprayGeo();
  // cards：[{ p: Vector3, yaw, pitch, roll, s, tint: [h, s, l] }]
  function add(cards, { cast = true } = {}) {
    const g = geo.clone(), n = cards.length, cell = new Float32Array(n * 4);
    g.setAttribute('aCell', new THREE.InstancedBufferAttribute(cell, 4));
    const mesh = new THREE.InstancedMesh(g, mat, n), m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3(), col = new THREE.Color();
    cards.forEach((c, i) => {
      const [[u0, v0, u1, v1], aspect] = LEAF_CELLS[(i * 7 + 3) % LEAF_CELLS.length];
      q.setFromEuler(e.set(c.pitch, c.yaw, c.roll, 'YXZ')); m.compose(c.p, q, sc.set(c.s * aspect, c.s, c.s)); mesh.setMatrixAt(i, m);
      cell.set([u0, v0, u1 - u0, v1 - v0], i * 4);
      mesh.setColorAt(i, col.setHSL(...c.tint));
    });
    mesh.castShadow = cast; mesh.receiveShadow = false; mesh.frustumCulled = false;
    return mesh;
  }
  return { uniforms, material: mat, add, update(t) { uniforms.uTime.value = t; } };
}

// pos：树干中心落在院子里的位置；S：缩放（重塑后的模型高 0.704 → ×6.6 约 4.6 米）；yaw：绕树干转多少
export async function loadTree({ manager, barkMat, kit, pos, S = 6.6, yaw = 0, leafCount = 700 }) {
  const [gltf, meta] = await Promise.all([new GLTFLoader(manager).loadAsync(BASE + 'ancient_tree.glb'), fetch(BASE + 'ancient_tree.json').then(r => r.json())]);
  const group = new THREE.Group(), [cx, cz] = meta.trunk;
  group.position.set(pos.x, -.1, pos.z); group.rotation.y = yaw; group.scale.setScalar(S);
  const mesh = gltf.scene.children[0] || gltf.scene;
  mesh.traverse(o => { if (o.isMesh) { o.material = barkMat; o.castShadow = true; o.receiveShadow = true; } });
  mesh.position.set(-cx, 0, -cz);
  group.add(mesh);
  group.updateMatrixWorld(true);
  const toWorld = (x, y, z) => new THREE.Vector3(x, y, z).applyMatrix4(group.matrixWorld);
  // 挂牌点（世界坐标）：顺序是脚本排好的——前面十来个就已经分散在各根枝上
  const slots = meta.slots.map(s => toWorld(...s));

  // 树叶：锚点在枝条的上面和侧面；小枝朝离开树干的方向伸出去，略微上扬或下垂
  const r = rng(77), cards = [], n = Math.min(leafCount, meta.leaves.length), v = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    const [x, y, z, nx, ny, nz] = meta.leaves[i], p = toWorld(x, y, z);
    p.add(v.set(nx, Math.max(ny, 0) + .5, nz).multiplyScalar(.12 + r() * .22)).add(v.set((r() - .5) * .3, r() * .3, (r() - .5) * .3));
    const dx = p.x - pos.x, dz = p.z - pos.z;
    cards.push({ p, yaw: Math.atan2(-dx, -dz) + (r() - .5) * 2.2, pitch: (r() - .35) * .7, roll: (r() - .5) * .7, s: .5 + r() * .45, tint: [.2 + (r() - .5) * .05, .32 + r() * .14, .78 + r() * .32] });
  }
  const leaves = kit.add(cards);
  const trunk = { x: pos.x, z: pos.z, r: meta.trunkR * S };
  return { group, leaves, slots, trunk };
}

// 院外的树林：每棵树的树冠是一团叶片卡（外层密、里面也有，远看是一团透着空隙的枝叶），下面一截细树干。
// 把院墙后面的天空和地图边界挡住；离得远，罩在晨雾里
// trees：[[x, z, 树冠中心高度, 树冠半径], …]
export function createGrove(kit, trees, { perTree = 200, seed = 5 } = {}) {
  const r = rng(seed), cards = [], group = new THREE.Group();
  const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(.06, .11, 1, 7), new THREE.MeshStandardMaterial({ color: 0x6a6356, roughness: 1 }), trees.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
  trees.forEach(([x, z, h, rad], i) => {
    for (let k = 0; k < perTree; k++) {
      const a = r() * 6.283, el = (r() - .5) * 2.2, d = rad * Math.pow(r(), .45);   // 越靠外越密
      const p = new THREE.Vector3(x + Math.cos(a) * Math.cos(el) * d, h + Math.sin(el) * d * .8, z + Math.sin(a) * Math.cos(el) * d);
      const inner = 1 - d / rad;   // 树冠里面的叶子照不到光：压暗
      cards.push({ p, yaw: Math.atan2(-Math.cos(a), -Math.sin(a)) + (r() - .5) * 2.6, pitch: (r() - .4) * 1.2, roll: (r() - .5) * 1., s: 1.0 + r() * .7, tint: [.2 + (r() - .5) * .06, .26 + r() * .14, (.34 + r() * .26) * (1 - .5 * inner)] });
    }
    const th = Math.max(1, h - rad * .5);
    trunks.setMatrixAt(i, m.compose(new THREE.Vector3(x, th / 2, z), q, sc.set(1 + rad * .2, th, 1 + rad * .2)));
  });
  trunks.castShadow = false;
  group.add(kit.add(cards, { cast: false }), trunks);
  return group;
}
