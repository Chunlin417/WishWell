// 洞天里一团团立体的厚云：浮在云海照片的前面，离殿 18～100 米，近的大、远的小。人一走动，近处的云和远处的云错开，
// 这种视差就是"厚"的来源。图集是两张透明底的云团照片（积云、层积云，textures-src/quality/cloud_*_atlas.png）。
// 图集里的云是均匀的冷灰色，光在这里补：
//   - 云团本身的明暗（图上亮的地方是云顶）压成夜里的深青灰；
//   - 在月亮那一侧的云是逆光：往月亮方向（屏幕上）查一下透明度，透明度往月亮那边掉下去的地方就是朝着月亮的边，染一圈暖金色；
//   - 云底渐隐到透明：云团是"泡"在云海里的，不是一块块剪下来贴上去的；
//   - 越远越融进雾里。
// 每张图集一个实例化的网格（一次绘制），位置、大小、飘的速度都在顶点着色器里算。
import * as THREE from 'three';
import { CLOUD_ATLAS } from './cloudAtlases.js';

const T = `${import.meta.env.BASE_URL}textures/q/`;

// center：殿的中心；eye：门口的眼睛位置（定云的高度）；moonDir：指向月亮；count：一共多少团（两张图集各一半）
export function createRealmClouds({ manager, low, center, eye, moonDir, haze, deep, layer = null, count = low ? 22 : 40 }) {
  const loader = new THREE.TextureLoader(manager), uTime = { value: 0 };
  const moonFlat = new THREE.Vector2(moonDir.x, moonDir.z).normalize(), base = Math.atan2(moonFlat.y, moonFlat.x);
  const group = new THREE.Group();
  let k = 11; const r = () => (k = (k * 16807) % 2147483647) / 2147483647;

  for (const [key, share] of [['cumulus', .5], ['strato', .5]]) {
    const n = Math.round(count * share), cells = CLOUD_ATLAS[key];
    const map = loader.load(T + `cloud_${key}${low ? '_1k' : ''}.webp`); map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 4;
    // 每团云：方位、距离、高度、宽、高、格子、漂移速度、相位
    const items = [];
    for (let i = 0; i < n; i++) {
      const moonSide = r() < .6;                                                   // 六成在月亮那一边（后墙敞开的方向）
      const a = moonSide ? base + (r() - .5) * 2.4 : r() * Math.PI * 2;
      const d = 22 + Math.pow(r(), 1.2) * 80;
      const c = cells[Math.floor(r() * cells.length)];
      const w = (key === 'strato' ? 1.25 : 1) * (7 + d * .28) * (.75 + r() * .5), h = w / c[4];
      // 云顶压在地平线下面 1.5°～6°：从殿里是微微俯看一片云海，云不会挡住月亮和天空
      const top = eye.y - d * Math.tan((1.5 + r() * 4.5) * Math.PI / 180);
      const y = top - h * .92;
      items.push({ a, d, y, w, h, c, speed: (r() < .8 ? 1 : -1) * (.45 + r() * .55), ph: r() * 30 });   // 米/秒：大多顺着一个方向吹（风），少数逆着，速度各不相同
    }
    items.sort((p, q) => q.d - p.d);                                                // 远的先画（透明的东西要从远到近叠）
    const geo = new THREE.PlaneGeometry(1, 1); geo.translate(0, .5, 0);            // 原点在云底中间
    const A = (sz, f) => { const arr = new Float32Array(n * sz); items.forEach((it, i) => arr.set(f(it), i * sz)); return new THREE.InstancedBufferAttribute(arr, sz); };
    geo.setAttribute('aPolar', A(4, it => [it.a, it.d, it.y, it.speed]));
    geo.setAttribute('aSize', A(3, it => [it.w, it.h, it.ph]));
    geo.setAttribute('aCell', A(4, it => [it.c[0], it.c[1], it.c[2] - it.c[0], it.c[3] - it.c[1]]));
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, fog: false,
      uniforms: { tMap: { value: map }, uTime, uCenter: { value: center }, uMoon: { value: moonDir }, uMoonFlat: { value: moonFlat }, uHaze: { value: haze }, uDeep: { value: deep } },
      vertexShader: /* glsl */`
        attribute vec4 aPolar, aCell; attribute vec3 aSize;
        uniform float uTime; uniform vec3 uCenter, uMoon; uniform vec2 uMoonFlat;
        varying vec2 vUv, vLocal, vMoonUv; varying float vToward, vDist;
        void main(){
          float a = aPolar.x + uTime * aPolar.w / aPolar.y;                            // 极慢地绕着殿横着漂
          float br = sin(uTime * .05 + aSize.z);
          vec3 c = uCenter + vec3(cos(a) * aPolar.y, aPolar.z + br * .3, sin(a) * aPolar.y);
          vec2 size = aSize.xy * vec2(1. + .04 * br, 1. + .06 * sin(uTime * .043 + aSize.z * 1.7));
          vec4 mv = viewMatrix * vec4(c, 1.);
          mv.xy += position.xy * size;                                                 // 始终正对镜头
          gl_Position = projectionMatrix * mv;
          vLocal = position.xy + vec2(.5, 0.);
          vUv = aCell.xy + vLocal * aCell.zw;
          // 月亮在屏幕上的方向（用来找朝着月亮的那条边），换算成这一格贴图里的一小步
          vec3 md = (viewMatrix * vec4(uMoon, 0.)).xyz;
          vec2 sd = length(md.xy) > 1e-4 ? normalize(md.xy) : vec2(0., 1.);
          vMoonUv = sd / size * 1.1 * aCell.zw;                                       // 往月亮那边挪约 1 米（取三个点的平均，边是柔的）
          vToward = pow(max(dot(normalize(c.xz - uCenter.xz), uMoonFlat), 0.), 1.5);   // 这团云在不在月亮那一边（逆光）
          vDist = -mv.z;
        }`,
      fragmentShader: /* glsl */`
        uniform sampler2D tMap; uniform vec3 uHaze, uDeep; varying vec2 vUv, vLocal, vMoonUv; varying float vToward, vDist;
        void main(){
          vec4 t = texture2D(tMap, vUv);
          float a = t.a * smoothstep(0., .32, vLocal.y);                               // 云底渐隐：泡在云海里
          if (a < .01) discard;
          float lum = dot(t.rgb, vec3(.2126, .7152, .0722));
          vec3 col = mix(uDeep * 1.2, vec3(.085, .13, .16), smoothstep(.06, .5, lum));     // 夜里的云：暗青灰，亮处是云顶（保留图上的蓬松起伏）
          // 逆光的金边：往月亮那边，透明度掉下去的地方。取三个距离的平均，边是一圈渐变的光晕，不是描边
          float aOut = (texture2D(tMap, vUv + vMoonUv * .35).a + texture2D(tMap, vUv + vMoonUv * .7).a + texture2D(tMap, vUv + vMoonUv).a) / 3.;
          float edge = clamp(t.a - aOut, 0., 1.) * smoothstep(.15, .9, t.a);
          col += vec3(1., .7, .36) * edge * vToward * .45;
          col += vec3(.9, .62, .3) * vToward * .05 * smoothstep(.3, .8, lum);         // 朝月亮一侧的云整体暖一点点
          float hz = smoothstep(25., 110., vDist);
          col = mix(col, uHaze, hz * .6);
          gl_FragColor = vec4(col, a * (1. - .35 * hz));
        }`,
    });
    const mesh = new THREE.InstancedMesh(geo, mat, n);
    mesh.frustumCulled = false; mesh.renderOrder = -16;                              // 在云海照片之后、殿里的薄雾之前
    if (layer !== null) mesh.layers.enable(layer);
    group.add(mesh);
  }
  return { group, update(t) { uTime.value = t; } };
}
