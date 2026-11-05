// 守愿石狐：Tripo 生成、经 scripts/optimize-glb.mjs 精简后的模型（public/models/shihu-tripo.glb），自带颜色 / 法线 / 粗糙度贴图。
// 横屏时立在池子左右两侧，侧身朝向池子、目视前方（右边那只镜像，两只的尾巴都在远离镜头的一侧）。
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { patch } from './patch.js';

const SCALE = 2.85;   // 约放大三成，和设计图里石狐的分量接近
const YAW = -Math.PI / 2;   // 模型本身面朝 +x，转到 +z
export const FOX_Z = .5;   // 石狐所在的 z（池子两侧略靠后）；pool.js 会在这附近避开摆放零散的石头

export function buildFoxes(scene, { floorH, poolK }) {
  const root = new THREE.Group(); scene.add(root);
  const items = [];
  let show = true, gap = 1.4, sizeK = 1, ready = false;
  // 池子不是正圆：分别找到这一侧池边（z = FOX_Z 处）的位置，两只石狐离各自的池边距离相同
  const rimX = side => { let x = 2.5; while (x < 9 && poolK(side * x, FOX_Z) < 1) x += .02; return x; };

  function place(it) {
    const x = it.side * (rimX(it.side) + gap), z = FOX_Z;
    it.g.position.set(x, floorH(x, z) - .03, z);
    // 侧身朝向池子、目视前方（不看镜头）；只朝镜头偏一点点，让脸的轮廓看得清
    it.g.rotation.y = -it.side * 1.35;
    it.g.scale.set(SCALE * sizeK * (it.side > 0 ? -1 : 1), SCALE * sizeK, SCALE * sizeK);
    it.g.visible = show;
  }

  new GLTFLoader().load(`${import.meta.env.BASE_URL}models/shihu-tripo.glb`, gltf => {
    let src = null;
    gltf.scene.traverse(o => { if (o.isMesh && !src) src = o; });
    const s = src.material;
    // 用模型自带的贴图，再接上场景的积雪和雨湿效果
    const mat = patch(new THREE.MeshStandardMaterial({
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
  };
}
