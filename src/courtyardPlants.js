// 小院里的地面植物：石缝里的小草、院子边角的蕨类和三叶草。贴图是许愿池已有的两张植物图集（照片抠出来的草丛、蕨）。
// 每株是三张交叉的竖直面片（从哪个方向看都有叶子），法线一律朝上（受光和地面一致，不会一张亮一张暗），随风轻轻摆
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// 图集里的格子：[u0, v0, u1, v1]、宽高比（数值来自 pool.js 里同一张图集的定义）
export const CELLS = {
  fern: [[[0.0142, 0.5195, 0.2407, 0.7339], 1.057], [[0.2534, 0.5327, 0.4976, 0.6851], 1.603], [[0.5068, 0.5190, 0.7349, 0.7378], 1.042], [[0.7388, 0.5054, 0.9951, 0.7119], 1.241]],
  clover: [[[0.0063, 0.7729, 0.2407, 0.9609], 1.247], [[0.2485, 0.7822, 0.4883, 0.9209], 1.729], [[0.5029, 0.7739, 0.7314, 0.9634], 1.206]],
  grass: [[[0.0469, 0.5000, 0.4531, 0.7681], 1.515]],          // grass_atlas.webp 里的矮草丛
};

function cardGeo(planes = 3) {
  const parts = [];
  for (let k = 0; k < planes; k++) {
    const g = new THREE.PlaneGeometry(1, 1, 1, 2); g.translate(0, .5, 0); g.rotateY(k * Math.PI / planes);
    const n = g.attributes.normal; for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0);
    parts.push(g);
  }
  return mergeGeometries(parts);
}

// items：[{ x, y?, z, h: 高度（米）, cell: [[u0,v0,u1,v1], 宽高比], yaw?, tint?: [r,g,b] }]
export function createPlantCards(map, items, { sway = .04 } = {}) {
  const uTime = { value: 0 };
  const mat = new THREE.MeshStandardMaterial({ map, alphaTest: .42, side: THREE.DoubleSide, roughness: .85 });
  mat.customProgramCacheKey = () => 'court-plant';
  mat.onBeforeCompile = sh => {
    sh.uniforms.uTime = uTime; sh.uniforms.uSway = { value: sway };
    // 面片是双面的：背面的法线会被翻到朝下、整片发黑——这里一律按朝上算，正反两面受光一样
    sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal = normalize((viewMatrix * vec4(0., 1., 0., 0.)).xyz);');
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aCell; uniform float uTime; uniform float uSway;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvMapUv = vMapUv * aCell.zw + aCell.xy;')
      .replace('#include <begin_vertex>', /* glsl */`#include <begin_vertex>
        {
          vec3 ip = instanceMatrix[3].xyz; float ph = ip.x * 1.7 + ip.z * 2.3, k = position.y * position.y;
          transformed.x += (sin(uTime * 1.6 + ph) + .4 * sin(uTime * 3.7 + ph * 1.9)) * uSway * k;
          transformed.z += cos(uTime * 1.2 + ph * 1.4) * uSway * .7 * k;
        }`);
  };
  const geo = cardGeo(), n = items.length, cell = new Float32Array(n * 4);
  geo.setAttribute('aCell', new THREE.InstancedBufferAttribute(cell, 4));
  const mesh = new THREE.InstancedMesh(geo, mat, n), m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3(), col = new THREE.Color();
  items.forEach((it, i) => {
    const [[u0, v0, u1, v1], aspect] = it.cell;
    cell.set([u0, v0, u1 - u0, v1 - v0], i * 4);
    m.compose(p.set(it.x, (it.y || 0) - it.h * .04, it.z), q.setFromEuler(e.set(0, it.yaw ?? i * 2.4, 0)), s.set(it.h * aspect, it.h, it.h * aspect));
    mesh.setMatrixAt(i, m); mesh.setColorAt(i, col.setRGB(...(it.tint || [.8, .85, .75])));
  });
  mesh.castShadow = false; mesh.receiveShadow = true; mesh.frustumCulled = false;
  return { mesh, update(t) { uTime.value = t; } };
}
