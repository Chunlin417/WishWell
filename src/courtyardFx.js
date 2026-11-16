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

// 远景：四圈"剪影"（最远的山、远山、近处的山坡、院外的树林），越远越淡、越偏蓝灰；层与层之间夹着一条条雾带，把山腰切断。
// 朝着太阳的那一半，空气里的雾被照亮：山更淡、偏暖；背着太阳的一半山色更深更冷。山坡朝阳的一面亮一些，看得出山的起伏。
// mistBands：要不要画层间的雾带（手机上可以少画）
export function createBackdrop(haze, sunDir, { mistBands = 2 } = {}) {
  const group = new THREE.Group(), uniforms = { uTime: { value: 0 } };
  const sunXZ = new THREE.Vector2(sunDir.x, sunDir.z).normalize();
  const layers = [
    // 半径、高度、颜色、[山脊基准高度, 起伏, 起伏的疏密, 树冠的鼓包], 雾的浓度
    { r: 96, h: 70, col: 0x8193a3, shape: [.44, .2, 1.1, .006], haze: .8, seed: 21.4 },
    { r: 80, h: 60, col: 0x627883, shape: [.47, .23, 1.6, .012], haze: .66, seed: 3.1 },
    { r: 56, h: 42, col: 0x485e44, shape: [.54, .2, 2.4, .035], haze: .5, seed: 7.7 },
    { r: 33, h: 28, col: 0x2b3f25, shape: [.64, .12, 4.2, .075], haze: .26, seed: 12.3 },
  ];
  const vert = /* glsl */`varying vec2 vUv; varying vec2 vXZ; void main(){ vUv = uv; vXZ = normalize(position.xz); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`;
  layers.forEach((L, i) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(L.r, L.r, L.h, 128, 1, true), new THREE.ShaderMaterial({
      side: THREE.BackSide, transparent: true, depthWrite: false, fog: false,
      uniforms: { uCol: { value: new THREE.Color(L.col) }, uHaze: { value: haze }, uShape: { value: new THREE.Vector4(...L.shape) }, uK: { value: new THREE.Vector2(L.haze, L.seed) }, uSun: { value: sunXZ } },
      vertexShader: vert,
      fragmentShader: /* glsl */`
        uniform vec3 uCol, uHaze; uniform vec4 uShape; uniform vec2 uK, uSun; varying vec2 vUv, vXZ;
        ${NOISE_GLSL}
        void main(){
          float a = vUv.x * 6.2831853;
          vec2 q = vec2(cos(a), sin(a)) * uShape.z + uK.y;
          float ridge = uShape.x + uShape.y * (fbm2(q) - .5) * 2.;
          // 树冠：一团团圆润的鼓包（两种大小叠在一起），不是尖顶——远看是阔叶林的轮廓
          vec2 qa = vec2(cos(a), sin(a));
          float tops = fbm2(qa * 24. + uK.y * 1.7) * .65 + vnoise(qa * 61. + uK.y) * .35;
          float body = ridge;   // 不含树梢的山脊线：雾按它算，才不会一条条竖纹
          ridge += uShape.w * tops;
          float alpha = 1. - smoothstep(ridge - .01, ridge + .01, vUv.y);   // 边缘虚一些，像隔着雾
          if (alpha < .01) discard;
          float sunward = pow(max(dot(vXZ, uSun), 0.), 2.);
          // 山坡的朝向：山脊线往太阳那边是下坡（亮）还是上坡（暗）。用屏幕上相邻像素的差算坡度（不用再查噪声，几乎不花时间）
          float da = dFdx(a);
          float slope = abs(da) > 1e-5 ? dFdx(body) / da : 0.;
          float side = dot(vec2(-vXZ.y, vXZ.x), uSun);
          float lit = clamp(.5 - slope * side * 1.6, 0., 1.);
          // 山体里一道道顺着坡往下的沟（深浅不一），让一块平涂的剪影有体积
          float gully = fbm2(vec2(a * uShape.z * 9., vUv.y * 3. + uK.y));
          vec3 c = uCol * (.78 + .34 * vnoise(q * 5.)) * (.82 + .3 * gully) * mix(.85, 1.12, lit) * mix(.8, 1.08, smoothstep(0., body, vUv.y));
          c *= mix(vec3(.94, .98, 1.06), vec3(1.06, 1.02, .94), sunward);           // 背光偏冷，向光偏暖
          // 山脚埋在雾里：雾的上沿不是一条直线，跟着噪声起伏
          float foot = smoothstep(.62 + .18 * (vnoise(vec2(a * 6., uK.y)) - .5), 0., vUv.y / max(body, .01));
          vec3 airCol = mix(uHaze * vec3(.96, 1., 1.05), uHaze * vec3(1.1, 1.04, .94), sunward);
          c = mix(c, airCol, clamp(uK.x + sunward * .14 + foot * .5, 0., 1.));
          gl_FragColor = vec4(c, alpha);
        }`,
    }));
    m.position.y = L.h / 2 - 3; m.renderOrder = -10 + i * 2;
    group.add(m);
  });
  // 层与层之间的雾带：一圈薄薄的、上下边缘都虚掉的雾，横向被噪声撕成一团一团，极慢地漂
  const bands = [{ r: 68, y: 9, h: 14, o: .45, seed: 2.3 }, { r: 44, y: 4.5, h: 9, o: .32, seed: 8.1 }].slice(0, mistBands);
  bands.forEach((b, i) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(b.r, b.r, b.h, 96, 1, true), new THREE.ShaderMaterial({
      side: THREE.BackSide, transparent: true, depthWrite: false, fog: false,
      uniforms: { uHaze: { value: haze }, uSun: { value: sunXZ }, uK: { value: new THREE.Vector2(b.o, b.seed) }, uTime: uniforms.uTime },
      vertexShader: vert,
      fragmentShader: /* glsl */`
        uniform vec3 uHaze; uniform vec2 uSun, uK; uniform float uTime; varying vec2 vUv, vXZ;
        ${NOISE_GLSL}
        void main(){
          float a = vUv.x * 6.2831853, y = vUv.y;
          vec2 p = vec2(a * 7. + uTime * .004 + uK.y, y * 2.2);
          float n = fbm2(p) * .7 + fbm2(p * 2.7 + vec2(uTime * .009, 0.)) * .3;
          float body = smoothstep(0., .45, y) * (1. - smoothstep(.35 + .3 * n, .95, y));   // 中间厚，上沿跟着噪声起伏
          float a2 = body * smoothstep(.3, .75, n) * uK.x;
          if (a2 < .004) discard;
          float sunward = pow(max(dot(vXZ, uSun), 0.), 2.);
          vec3 c = mix(uHaze * vec3(.98, 1.01, 1.04), uHaze * vec3(1.14, 1.07, .96), sunward) * (.95 + .1 * n);
          gl_FragColor = vec4(c, a2);
        }`,
    }));
    m.position.y = b.y; m.renderOrder = -7 + i * 2;   // 第一条夹在远山和近山之间，第二条夹在近山和树林之间
    group.add(m);
  });
  group.userData.uniforms = uniforms;
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
// beams：[[落地点 x, z, 宽, 长, { dir, y, k }?], …]；sunDir：指向太阳的方向。
// 第五项可选：dir 这道光自己的方向（比如从殿的东窗斜照进去的那一道）、y 落地点的高度、k 亮度倍数
// 每道光柱由三片错开一点角度、宽窄不同的长片叠成：中间一片窄而亮，两边各一片宽而淡——看起来有厚度，不是一张纸
const beamDir = (b, sunDir) => b[4]?.dir || sunDir;
// noise：一张可平铺的灰度噪声图（光柱里雾气的浓淡），没有就用程序噪声
export function createShafts(beams, sunDir, noise = null) {
  const pos = [], par = [], seed = [], dir = [], idx = [];
  beams.forEach((beam, i) => {
    const [x, z, w, len, o = {}] = beam, d = beamDir(beam, sunDir), k = o.k ?? 1;
    const top = new THREE.Vector3(x, o.y ?? 0, z).addScaledVector(d, len);
    // [宽度倍数, 亮度, 绕光轴错开的角度]
    for (const [wm, br, tw] of [[.55, .75 * k, 0], [1.25, .38 * k, .5], [1.6, .22 * k, -.6]]) {
      const b = pos.length / 3;
      for (const [s, t] of [[-1, 0], [1, 0], [-1, 1], [1, 1]]) { pos.push(top.x, top.y, top.z); par.push(s, t, w * wm, len); seed.push(i * 1.37 + wm * 3.1, br, tw); dir.push(d.x, d.y, d.z); }
      idx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3);
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aP', new THREE.Float32BufferAttribute(par, 4));
  g.setAttribute('aSeed', new THREE.Float32BufferAttribute(seed, 3));
  g.setAttribute('aDir', new THREE.Float32BufferAttribute(dir, 3));
  g.setIndex(idx);
  const uniforms = { uTime: { value: 0 }, uCol: { value: new THREE.Color(1, .88, .64).multiplyScalar(.11) }, tNoise: { value: noise } };
  const mesh = new THREE.Mesh(g, new THREE.ShaderMaterial({
    uniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
    defines: noise ? { NOISE_TEX: '' } : {},
    vertexShader: /* glsl */`
      attribute vec4 aP; attribute vec3 aSeed, aDir;
      varying vec2 vQ; varying vec3 vSeed; varying float vDist, vFace;
      void main(){
        vec3 p = position - aDir * aP.w * aP.y;
        vec3 toCam = normalize(cameraPosition - p);
        vec3 side = normalize(cross(aDir, toCam));
        vec3 nrm = cross(side, aDir);
        side = normalize(side * cos(aSeed.z) + nrm * sin(aSeed.z));   // 三片绕光轴错开一点
        p += side * aP.x * aP.z * .5 * (.75 + aP.y * .5);
        vQ = aP.xy; vSeed = aSeed;
        vFace = abs(dot(toCam, aDir));   // 顺着光柱看过去（光从身后照来，或者正对着太阳）：光柱该更"浓"一些
        vec4 mv = viewMatrix * vec4(p, 1.); vDist = -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform float uTime; uniform vec3 uCol; uniform sampler2D tNoise; varying vec2 vQ; varying vec3 vSeed; varying float vDist, vFace;
      ${NOISE_GLSL}
      void main(){
        float a = pow(max(1. - abs(vQ.x), 0.), 1.8);                                    // 横向：中间亮、两边淡
        a *= smoothstep(0., .22, vQ.y) * (1. - smoothstep(.72, 1., vQ.y));      // 两头淡出（落地那头也是虚的，不是一刀切）
        // 一道光里有几缕更亮的细光，细光的位置沿着光柱缓缓错动——像是树叶在晃，缝隙在变
        float strands = vnoise(vec2(vQ.x * 5. + vSeed.x * 7. + sin(uTime * .21 + vSeed.x) * .35, vSeed.x));
        a *= .3 + .7 * strands * strands * 1.6;
        // 雾气不均匀：一团团的浓淡顺着光柱慢慢往上飘
        #ifdef NOISE_TEX
          a *= .45 + .65 * texture2D(tNoise, vec2(vQ.x * .45 + vSeed.x * .37, vQ.y * 1.1 - uTime * .011)).r;
        #else
          a *= .55 + .45 * fbm2(vec2(vQ.x * 1.6 + vSeed.x, vQ.y * 4. - uTime * .045));
        #endif
        a *= .85 + .15 * sin(uTime * .37 + vSeed.x * 3.);                        // 整道光极慢地一明一暗（云从太阳前面飘过）
        a *= 1. + vFace * .6;
        a *= smoothstep(.8, 4.5, vDist);                                        // 走到光柱里时淡掉，不会糊在眼前
        gl_FragColor = vec4(uCol * a * vSeed.y, 1.);
      }`,
  }));
  mesh.frustumCulled = false; mesh.renderOrder = 5;
  return { mesh, uniforms };
}

// 光柱里的浮尘：只有落在光里的那几粒是亮的（一闪一闪地转着），出了光就几乎看不见——这是"空气里有光"最直接的证据。
// 尘粒的位置在光柱附近随机撒开，在着色器里缓慢地飘（往上浮一点、左右晃），飘出范围就从另一头绕回来。
export function createDust(beams, sunDir, count = 900) {
  const R = (s => () => (s = (s * 16807) % 2147483647) / 2147483647)(7);
  const weights = beams.map(b => b[2] * b[3] * (b[4]?.k ?? 1)), total = weights.reduce((a, b) => a + b, 0);
  const pos = new Float32Array(count * 3), axis = new Float32Array(count * 4), dirs = new Float32Array(count * 3), seed = new Float32Array(count);
  const v = new THREE.Vector3(), side = new THREE.Vector3(), nrm = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    let r = R() * total, bi = 0; while (r > weights[bi] && bi < beams.length - 1) r -= weights[bi++];
    const [x, z, w, len, o = {}] = beams[bi], d = beamDir(beams[bi], sunDir), y = o.y ?? 0;
    side.crossVectors(d, UP_V).normalize(); nrm.crossVectors(side, d);
    const t = .04 + R() * Math.min(len * .55, 4.5), a = R() * Math.PI * 2, rr = Math.sqrt(R()) * w * .9;   // 只撒在光柱下段（人眼高度附近）
    v.set(x, y, z).addScaledVector(d, t).addScaledVector(side, Math.cos(a) * rr).addScaledVector(nrm, Math.sin(a) * rr);
    pos.set([v.x, v.y, v.z], i * 3); axis.set([x, y, z, w * .5], i * 4); dirs.set([d.x, d.y, d.z], i * 3); seed[i] = R();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aAxis', new THREE.BufferAttribute(axis, 4));
  g.setAttribute('aDir', new THREE.BufferAttribute(dirs, 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  const uniforms = { uTime: { value: 0 }, uPx: { value: 600 }, uCol: { value: new THREE.Color(1, .9, .7) } };
  const mesh = new THREE.Points(g, new THREE.ShaderMaterial({
    uniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    vertexShader: /* glsl */`
      attribute vec4 aAxis; attribute vec3 aDir; attribute float aSeed;
      uniform float uTime, uPx; varying float vA;
      void main(){
        float s = aSeed * 43.7, t = uTime;
        // 飘：慢慢往上浮（绕回来），左右、前后晃
        vec3 p = position + vec3(sin(t * .13 + s) * .22 + sin(t * .37 + s * 2.1) * .06,
                                 mod(t * .018 * (.5 + aSeed) + aSeed * 1.3, 1.3) - .65,
                                 cos(t * .11 + s * 1.3) * .22 + cos(t * .41 + s) * .05);
        // 到光轴的距离：越靠近光柱中心越亮，出了光柱只剩一点点
        vec3 q = p - aAxis.xyz;
        float along = dot(q, aDir);
        float dAx = length(q - aDir * along);
        float inBeam = 1. - smoothstep(aAxis.w * .35, aAxis.w * 1.1, dAx);
        float spark = pow(.5 + .5 * sin(t * (1.2 + aSeed * 2.3) + s), 6.);   // 尘粒转到某个角度时反一下光
        vec4 mv = viewMatrix * vec4(p, 1.);
        float dist = -mv.z;
        float sizeM = .0045 + .0045 * aSeed;   // 实际只有几毫米
        float px = sizeM * uPx / max(dist, .05);
        gl_PointSize = max(px, 1.6);
        vA = (inBeam * (.35 + .65 * spark) + .015) * min(1., px / 1.6)        // 小于 1.6 像素时按面积减淡，不会忽大忽小地闪
           * smoothstep(.25, .8, dist) * (1. - smoothstep(5., 11., dist));     // 太近、太远都不画
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uCol; varying float vA;
      void main(){
        if (vA < .004) discard;
        vec2 c = gl_PointCoord - .5;
        float a = exp(-dot(c, c) * 14.) * vA;
        gl_FragColor = vec4(uCol * a * 1.4, 1.);
      }`,
  }));
  mesh.frustumCulled = false; mesh.renderOrder = 6;
  return { mesh, uniforms };
}
const UP_V = new THREE.Vector3(0, 1, 0);

// 香烟：每炷香上方一缕细烟，贴着香头很细，越往上越散、越淡，缓缓扭动。
// maxCols：最多同时画几缕（香多了只给最新的几炷画烟）；香头的位置和浓淡由 setTip(i, x, y, z, 浓度) 每帧给，浓度为 0 = 这一缕不画
export function createSmoke(maxCols = 24, height = 2.8) {
  const pos = [], par = [], idx = [], ROWS = 28;
  for (let i = 0; i < maxCols; i++) {
    const b = pos.length / 3;
    for (let j = 0; j <= ROWS; j++) for (const s of [-1, 1]) { pos.push(0, 0, 0); par.push(s, j / ROWS, i * 3.71 + 1.3, i); }
    for (let j = 0; j < ROWS; j++) { const p = b + j * 2; idx.push(p, p + 1, p + 2, p + 1, p + 3, p + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aP', new THREE.Float32BufferAttribute(par, 4));
  g.setIndex(idx);
  const tips = Array.from({ length: maxCols }, () => new THREE.Vector4(0, 0, 0, 0));
  const uniforms = { uTime: { value: 0 }, uSize: { value: new THREE.Vector2(1.2, height) }, uTip: { value: tips } };
  const mesh = new THREE.Mesh(g, new THREE.ShaderMaterial({
    uniforms, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false,
    vertexShader: /* glsl */`
      attribute vec4 aP; uniform vec2 uSize; uniform vec4 uTip[${maxCols}]; varying vec3 vP; varying float vAct;
      void main(){
        vec4 tip = uTip[int(aP.w + .5)];
        vec3 toCam = cameraPosition - tip.xyz;
        vec3 side = normalize(vec3(toCam.z, 0., -toCam.x));
        vec3 p = tip.xyz + side * aP.x * uSize.x * .5 + vec3(0., aP.y * uSize.y, 0.);
        vP = aP.xyz; vAct = tip.w;
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.);
      }`,
    fragmentShader: /* glsl */`
      uniform float uTime; varying vec3 vP; varying float vAct;
      ${NOISE_GLSL}
      float wisp(float x, float h, float seed, float t){
        float c = (fbm2(vec2(h * 2.4 - t * .26, seed)) - .5) * (.02 + 1.5 * smoothstep(.04, .7, h)) + (vnoise(vec2(h * 8. - t * .8, seed + 5.)) - .5) * .14 * h;
        float w = .005 + .17 * h * h;
        float d = (x - c) / w;
        return exp(-d * d) * mix(1., .22, smoothstep(0., .8, h));
      }
      void main(){
        if (vAct < .01) discard;
        float h = vP.y, x = vP.x;
        float t = uTime * .55;   // 缓缓上升
        float a = wisp(x, h, vP.z, t) + .4 * wisp(x, h, vP.z + 13., t * 1.15) * smoothstep(.05, .3, h);
        a *= smoothstep(0., .015, h) * (1. - smoothstep(.45, 1., h)) * vAct;
        gl_FragColor = vec4(vec3(.8, .88, .96) * 1.15, clamp(a * .22, 0., 1.));
      }`,
  }));
  mesh.frustumCulled = false; mesh.renderOrder = 6;
  return { mesh, uniforms, setTip(i, x, y, z, w) { tips[i].set(x, y, z, w); } };
}

// 薄雾：院墙外、殿后低低地浮着几团雾（始终朝向镜头的柔边片）。
// puffs：{ map, cells } 雾团图集（每团形状不同、里面有浓淡）；没有就用一个柔边圆
export function createMist(haze, spots, puffs = null) {
  let map = puffs?.map;
  if (!map) {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d'), grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(.5, 'rgba(255,255,255,.45)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
    map = new THREE.CanvasTexture(c);
  }
  const group = new THREE.Group(), list = [];
  spots.forEach(([x, y, z, w, h, o], i) => {
    let m = map;
    if (puffs) {   // 每团雾取图集里的一格（贴图对象各自一份，图像数据共用）
      const c = puffs.cells[i % puffs.cells.length]; m = map.clone();
      m.offset.set(c[0], c[1]); m.repeat.set(c[2] - c[0], c[3] - c[1]); m.needsUpdate = true;
    }
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: m, color: haze, opacity: o * (puffs ? 1.25 : 1), depthWrite: false, fog: false, transparent: true }));
    s.position.set(x, y, z); s.scale.set(w, h, 1); s.renderOrder = 2;
    group.add(s); list.push({ s, x, ph: i * 1.9 });
  });
  return { group, update(t) { for (const m of list) m.s.position.x = m.x + Math.sin(t * .05 + m.ph) * 1.2; } };
}
