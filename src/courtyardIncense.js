// 香炉里的香：最多 100 炷，按点燃的时间戳算已经烧了多少——香身越来越短，香头一点红火，烧完就消失。
// 每炷香插在炉灰里固定的位置（向日葵式的螺旋排开，100 个位置不挤在一起）；只给最新的几炷画烟，其余的合成炉口一层淡淡的香雾。
// 所有位置都在香炉自己的坐标里（香炉整体缩放过），parent 就是那个组
import * as THREE from 'three';

export function createIncense({ parent, ashY, stickMat, slots = 100, smokeCols = 24, stickLen = .4, ashR = .43, duration = 30 * 60e3 }) {
  // 插位：golden angle 螺旋，半径按 sqrt 铺开
  const slotPos = Array.from({ length: slots }, (_, i) => {
    const r = ashR * Math.sqrt((i + .5) / slots), a = i * 2.39996;
    return [Math.cos(a) * r, Math.sin(a) * r];
  });
  const stickGeo = new THREE.CylinderGeometry(.0032, .0032, 1, 5).translate(0, .5, 0);
  const sticks = new THREE.InstancedMesh(stickGeo, stickMat, slots);
  const emberMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 1.5, .4) });
  const embers = new THREE.InstancedMesh(new THREE.SphereGeometry(.0055, 8, 6), emberMat, slots);
  for (const m of [sticks, embers]) { m.count = 0; m.frustumCulled = false; m.castShadow = false; m.receiveShadow = false; parent.add(m); }
  // 炉口上方一层淡淡的香雾：香多了（超过画烟的数量）才明显
  const hc = document.createElement('canvas'); hc.width = hc.height = 64; const hg = hc.getContext('2d'), gr = hg.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,.9)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); hg.fillStyle = gr; hg.fillRect(0, 0, 64, 64);
  const haze = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(hc), color: 0xcfd8e0, transparent: true, depthWrite: false, opacity: 0, fog: false }));
  haze.scale.set(1.6, 1.2, 1); haze.position.set(0, ashY + .5, 0); haze.renderOrder = 6; parent.add(haze);

  let list = [];
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), one = new THREE.Vector3(), sc = new THREE.Vector3(), p = new THREE.Vector3(), tip = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

  return {
    // list：[{ id, slot, t（点燃的时间，毫秒）, mine }]
    set(l) { list = l; },
    get count() { return list.length; },
    // now：当前时间（毫秒）；smoke：createSmoke 的返回值
    update(now, smoke) {
      let n = 0;
      const live = [];
      for (const it of list) {
        const age = now - it.t, rest = duration - age;
        if (rest <= 0 || age < 0) continue;
        live.push([it, age, rest]);
        const s = it.slot % slots, [x, z] = slotPos[s];
        const lean = Math.sin(s * 12.9898) * .07, lean2 = Math.sin(s * 78.233) * .07;   // 每炷略微歪一点
        q.setFromEuler(e.set(lean, 0, lean2));
        const grow = smooth(0, 1400, age), frac = Math.max(.05, rest / duration), len = Math.max(.02, stickLen * frac * grow);   // 刚点上时从炉灰里"长"出来
        m.compose(p.set(x, ashY, z), q, sc.set(1, len, 1)); sticks.setMatrixAt(n, m);
        tip.copy(up).applyQuaternion(q).multiplyScalar(len).add(p);
        m.compose(tip, q.identity(), one.setScalar(1 + 1.8 * (1 - smooth(0, 1500, age)))); embers.setMatrixAt(n, m);   // 刚点着的一瞬间火星大一些
        n++;
      }
      sticks.count = embers.count = n; sticks.instanceMatrix.needsUpdate = embers.instanceMatrix.needsUpdate = true;
      // 画烟：最新点的几炷；烟的浓淡——刚点着时慢慢浓起来，快烧完时慢慢淡下去
      live.sort((a, b) => b[0].t - a[0].t);
      for (let i = 0; i < smokeCols; i++) {
        const v = live[i];
        if (!v) { smoke.setTip(i, 0, 0, 0, 0); continue; }
        const [it, age, rest] = v, s = it.slot % slots, [x, z] = slotPos[s];
        const lean = Math.sin(s * 12.9898) * .07, lean2 = Math.sin(s * 78.233) * .07;
        const len = Math.max(.02, stickLen * Math.max(.05, rest / duration) * smooth(0, 1400, age));
        q.setFromEuler(e.set(lean, 0, lean2)); tip.copy(up).applyQuaternion(q).multiplyScalar(len).add(p.set(x, ashY, z));
        parent.localToWorld(tip);
        smoke.setTip(i, tip.x, tip.y, tip.z, smooth(300, 4500, age) * smooth(0, 90e3, rest));
      }
      haze.material.opacity = Math.min(.3, Math.max(0, live.length - smokeCols) * .02 + (live.length > 0 ? .03 : 0));
    },
  };
}
