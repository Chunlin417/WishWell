// 小院里的气氛：天空、远山、树荫光斑、光柱、香烟、薄雾
import * as THREE from 'three';
import { NOISE_GLSL } from './shaders.js';

// 天空：地平线是薄雾色，往上渐渐变成淡蓝，太阳方向有一团暖光
export function createSky(haze, sunDir) {
  return new THREE.Mesh(new THREE.SphereGeometry(100, 24, 12), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { uHaze: { value: haze }, uZen: { value: new THREE.Color(0x6f8fae) }, uSunDir: { value: sunDir } },
    vertexShader: /* glsl */`varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
    fragmentShader: /* glsl */`
      uniform vec3 uHaze, uZen, uSunDir; varying vec3 vDir;
      void main(){
        vec3 d = normalize(vDir);
        vec3 c = mix(uHaze, uZen, pow(clamp(d.y, 0., 1.), .6));
        float s = max(dot(d, uSunDir), 0.);
        c = mix(c, c * vec3(1.12, 1.02, .86), pow(s, 2.) * .7);   // 朝着太阳的半边天偏暖
        c += vec3(1., .84, .58) * (pow(s, 24.) * .4 + pow(s, 5.) * .1);
        gl_FragColor = vec4(c * .8, 1.);
      }`,
  }));
}

// 远景：三圈"剪影"（近处的树林、中间的山坡、远处的山），越远越淡、越偏雾色；每一圈的底部都埋在雾里
export function createBackdrop(haze) {
  const group = new THREE.Group();
  const layers = [
    // 半径、高度、颜色、[山脊基准高度, 起伏, 起伏的疏密, 树冠的鼓包], 雾的浓度
    { r: 88, h: 66, col: 0x6c8088, shape: [.5, .24, 1.4, .012], haze: .76, seed: 3.1 },
    { r: 56, h: 42, col: 0x49603f, shape: [.56, .2, 2.4, .035], haze: .54, seed: 7.7 },
    { r: 33, h: 28, col: 0x2d4226, shape: [.64, .12, 4.2, .075], haze: .28, seed: 12.3 },
  ];
  layers.forEach((L, i) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(L.r, L.r, L.h, 96, 1, true), new THREE.ShaderMaterial({
      side: THREE.BackSide, transparent: true, depthWrite: false, fog: false,
      uniforms: { uCol: { value: new THREE.Color(L.col) }, uHaze: { value: haze }, uShape: { value: new THREE.Vector4(...L.shape) }, uK: { value: new THREE.Vector2(L.haze, L.seed) } },
      vertexShader: /* glsl */`varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
      fragmentShader: /* glsl */`
        uniform vec3 uCol, uHaze; uniform vec4 uShape; uniform vec2 uK; varying vec2 vUv;
        ${NOISE_GLSL}
        void main(){
          float a = vUv.x * 6.2831853;
          vec2 q = vec2(cos(a), sin(a)) * uShape.z + uK.y;
          float ridge = uShape.x + uShape.y * (fbm2(q) - .5) * 2.;
          // 树梢：一个个尖顶（把角度切成小格，每格一个高低不同的尖）
          // 树冠：一团团圆润的鼓包（两种大小叠在一起），不是尖顶——远看是阔叶林的轮廓
          vec2 qa = vec2(cos(a), sin(a));
          float tops = fbm2(qa * 24. + uK.y * 1.7) * .65 + vnoise(qa * 61. + uK.y) * .35;
          float body = ridge;   // 不含树梢的山脊线：雾按它算，才不会一条条竖纹
          ridge += uShape.w * tops;
          float alpha = 1. - smoothstep(ridge - .012, ridge + .012, vUv.y);   // 边缘虚一些，像隔着雾
          if (alpha < .01) discard;
          vec3 c = uCol * (.8 + .4 * fbm2(q * 5.)) * mix(.8, 1.08, smoothstep(0., body, vUv.y));
          float mist = smoothstep(.6, 0., vUv.y / max(body, .01));   // 山脚埋在雾里
          c = mix(c, uHaze, clamp(uK.x + mist * .45, 0., 1.));
          gl_FragColor = vec4(c, alpha);
        }`,
    }));
    m.position.y = L.h / 2 - 3; m.renderOrder = -10 + i;
    group.add(m);
  });
  return group;
}

// 树荫：树冠上方一张看不见的"叶影"片，只用来投影——阳光穿过它，在地面、墙面上落下斑驳的光斑。
// center / radius：树冠的范围；出了这个范围就没有影子
export function createCanopyShade(tex, center, radius, height = 10) {
  const size = radius * 2.3;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, side: THREE.DoubleSide }));
  mesh.rotation.x = -Math.PI / 2; mesh.position.set(center.x, height, center.z);
  mesh.castShadow = true; mesh.frustumCulled = false;
  mesh.customDepthMaterial = new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    uniforms: { tCanopy: { value: tex }, uSize: { value: size }, uRadius: { value: radius } },
    vertexShader: /* glsl */`varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
    fragmentShader: /* glsl */`
      #include <packing>
      uniform sampler2D tCanopy; uniform float uSize, uRadius; varying vec2 vUv;
      void main(){
        vec2 p = (vUv - .5) * uSize;   // 米
        float c = texture2D(tCanopy, p / 9. + vec2(.13, .41)).r;
        float f = texture2D(tCanopy, mat2(.8, .6, -.6, .8) * p / 3.6 + vec2(.57, .22)).g;
        // 粗的一张决定大块的树影和光斑，细的一张是叶片大小的碎影；越靠近树冠边缘，叶子越稀
        float lit = smoothstep(.42, .58, c) * (.6 + .4 * smoothstep(.34, .6, f)) + (1. - smoothstep(.42, .58, c)) * .3 * smoothstep(.5, .7, f);
        lit += smoothstep(uRadius * .72, uRadius, length(p));
        if (lit > .5) discard;
        gl_FragColor = packDepthToRGBA(gl_FragCoord.z);
      }`,
  });
  return mesh;
}

// 光柱：阳光穿过树冠的缝隙，在薄雾里显出一道道光。每道是一条沿着阳光方向的长片，始终把宽面转向镜头
// beams：[[落地点 x, z, 宽, 长], …]；sunDir：指向太阳的方向
export function createShafts(beams, sunDir) {
  const pos = [], par = [], seed = [], idx = [];
  beams.forEach(([x, z, w, len], i) => {
    const top = new THREE.Vector3(x, 0, z).addScaledVector(sunDir, len), b = pos.length / 3;
    for (const [s, t] of [[-1, 0], [1, 0], [-1, 1], [1, 1]]) { pos.push(top.x, top.y, top.z); par.push(s, t, w, len); seed.push(i * 1.37 + .2); }
    idx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3);
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aP', new THREE.Float32BufferAttribute(par, 4));
  g.setAttribute('aSeed', new THREE.Float32BufferAttribute(seed, 1));
  g.setIndex(idx);
  const uniforms = { uSun: { value: sunDir }, uTime: { value: 0 }, uCol: { value: new THREE.Color(1, .9, .68).multiplyScalar(.12) } };
  const mesh = new THREE.Mesh(g, new THREE.ShaderMaterial({
    uniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
    vertexShader: /* glsl */`
      attribute vec4 aP; attribute float aSeed; uniform vec3 uSun;
      varying vec2 vQ; varying float vSeed; varying float vDist;
      void main(){
        vec3 p = position - uSun * aP.w * aP.y;
        vec3 side = normalize(cross(uSun, cameraPosition - p));
        p += side * aP.x * aP.z * .5 * (.75 + aP.y * .5);
        vQ = aP.xy; vSeed = aSeed;
        vec4 mv = viewMatrix * vec4(p, 1.); vDist = -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform float uTime; uniform vec3 uCol; varying vec2 vQ; varying float vSeed; varying float vDist;
      ${NOISE_GLSL}
      void main(){
        float a = pow(max(1. - abs(vQ.x), 0.), 1.6);                                    // 横向：中间亮、两边淡
        a *= smoothstep(0., .18, vQ.y) * (1. - smoothstep(.8, 1., vQ.y));       // 两头淡出
        a *= .45 + .55 * vnoise(vec2(vQ.x * 4. + vSeed * 7., vSeed));           // 一道光里还有几缕更亮的
        a *= .75 + .25 * vnoise(vec2(vQ.x * 2. + vSeed, vQ.y * 3. - uTime * .05));   // 雾气缓缓飘过
        a *= smoothstep(.8, 4., vDist);                                         // 走到光柱里时淡掉，不会糊在眼前
        gl_FragColor = vec4(uCol * a, 1.);
      }`,
  }));
  mesh.frustumCulled = false; mesh.renderOrder = 5;
  return { mesh, uniforms };
}

// 香烟：每炷香上方一缕细烟，贴着香头很细，越往上越散、越淡，缓缓扭动。tips：香头的位置
export function createSmoke(tips, height = 2.8) {
  const pos = [], par = [], idx = [], ROWS = 28;
  tips.forEach((tip, i) => {
    const b = pos.length / 3;
    for (let j = 0; j <= ROWS; j++) for (const s of [-1, 1]) { pos.push(tip.x, tip.y, tip.z); par.push(s, j / ROWS, i * 3.71 + 1.3); }
    for (let j = 0; j < ROWS; j++) { const p = b + j * 2; idx.push(p, p + 1, p + 2, p + 1, p + 3, p + 2); }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aP', new THREE.Float32BufferAttribute(par, 3));
  g.setIndex(idx);
  const uniforms = { uTime: { value: 0 }, uSize: { value: new THREE.Vector2(1.2, height) } };
  const mesh = new THREE.Mesh(g, new THREE.ShaderMaterial({
    uniforms, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false,
    vertexShader: /* glsl */`
      attribute vec3 aP; uniform vec2 uSize; varying vec3 vP;
      void main(){
        vec3 toCam = cameraPosition - position;
        vec3 side = normalize(vec3(toCam.z, 0., -toCam.x));
        vec3 p = position + side * aP.x * uSize.x * .5 + vec3(0., aP.y * uSize.y, 0.);
        vP = aP;
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.);
      }`,
    fragmentShader: /* glsl */`
      uniform float uTime; varying vec3 vP;
      ${NOISE_GLSL}
      float wisp(float x, float h, float seed, float t){
        float c = (fbm2(vec2(h * 2.4 - t * .26, seed)) - .5) * (.02 + 1.5 * smoothstep(.04, .7, h)) + (vnoise(vec2(h * 8. - t * .8, seed + 5.)) - .5) * .14 * h;
        float w = .005 + .17 * h * h;
        float d = (x - c) / w;
        return exp(-d * d) * mix(1., .22, smoothstep(0., .8, h));
      }
      void main(){
        float h = vP.y, x = vP.x;
        float t = uTime * .55;   // 缓缓上升
        float a = wisp(x, h, vP.z, t) + .4 * wisp(x, h, vP.z + 13., t * 1.15) * smoothstep(.05, .3, h);
        a *= smoothstep(0., .015, h) * (1. - smoothstep(.45, 1., h));
        gl_FragColor = vec4(vec3(.8, .88, .96) * 1.15, clamp(a * .22, 0., 1.));
      }`,
  }));
  mesh.frustumCulled = false; mesh.renderOrder = 6;
  return { mesh, uniforms };
}

// 薄雾：院墙外、殿后低低地浮着几团雾（始终朝向镜头的柔边圆片）
export function createMist(haze, spots) {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d'), grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(.5, 'rgba(255,255,255,.45)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  const map = new THREE.CanvasTexture(c);
  const group = new THREE.Group(), list = [];
  spots.forEach(([x, y, z, w, h, o], i) => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map, color: haze, opacity: o, depthWrite: false, fog: false, transparent: true }));
    s.position.set(x, y, z); s.scale.set(w, h, 1); s.renderOrder = 2;
    group.add(s); list.push({ s, x, ph: i * 1.9 });
  });
  return { group, update(t) { for (const m of list) m.s.position.x = m.x + Math.sin(t * .05 + m.ph) * 1.2; } };
}
