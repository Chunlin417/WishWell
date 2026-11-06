// 水面：GPU 波动方程涟漪模拟 + 折射 / 反射 / 菲涅尔 / 高光
import * as THREE from 'three';
import { NOISE_GLSL } from './shaders.js';

const QUAD_VS = /* glsl */`varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }`;

const SIM_FS = /* glsl */`
uniform sampler2D tPrev; uniform vec2 delta; uniform float uE; varying vec2 vUv;
float Rb(float t){ return 3.7 + .3 * sin(3. * t + .8) + .18 * sin(5. * t + 2.1) + .1 * sin(8. * t + .3); }
void main(){
  vec2 w = (vUv * 2. - 1.) * uE;
  float k = length(w) / Rb(atan(w.y, w.x));
  vec4 info = texture2D(tPrev, vUv);
  float avg = (texture2D(tPrev, vUv - vec2(delta.x, 0.)).r + texture2D(tPrev, vUv + vec2(delta.x, 0.)).r +
               texture2D(tPrev, vUv - vec2(0., delta.y)).r + texture2D(tPrev, vUv + vec2(0., delta.y)).r) * .25;
  info.g += (avg - info.r) * 2.;
  info.g *= .993;
  info.r += info.g;
  info.r *= .998;
  if (k > .97) info = vec4(0.);   // 池壁：反射
  gl_FragColor = info;
}`;

const DROP_FS = /* glsl */`
uniform sampler2D tPrev; uniform vec4 drops[16]; uniform int uCount; varying vec2 vUv;
void main(){
  vec4 info = texture2D(tPrev, vUv);
  for (int i = 0; i < 16; i++) {
    if (i >= uCount) break;
    vec4 d = drops[i];
    float a = max(0., 1. - length(vUv - d.xy) / d.z);
    a = .5 - cos(a * 3.14159) * .5;
    info.r -= a * d.w;
  }
  gl_FragColor = info;
}`;

export class Ripples {
  constructor(renderer, size = 256, extent = 5) {
    this.r = renderer; this.E = extent; this.queue = []; this.acc = 0;
    const opt = { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false };
    this.a = new THREE.WebGLRenderTarget(size, size, opt);
    this.b = new THREE.WebGLRenderTarget(size, size, opt);
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.sim = new THREE.ShaderMaterial({ uniforms: { tPrev: { value: null }, delta: { value: new THREE.Vector2(1 / size, 1 / size) }, uE: { value: extent } }, vertexShader: QUAD_VS, fragmentShader: SIM_FS });
    this.drop = new THREE.ShaderMaterial({ uniforms: { tPrev: { value: null }, drops: { value: Array.from({ length: 16 }, () => new THREE.Vector4()) }, uCount: { value: 0 } }, vertexShader: QUAD_VS, fragmentShader: DROP_FS });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.sim);
    this.quad.frustumCulled = false;
    this.scene = new THREE.Scene(); this.scene.add(this.quad);
    const cc = new THREE.Color(); renderer.getClearColor(cc); const ca = renderer.getClearAlpha();
    renderer.setClearColor(0x000000, 0);
    for (const t of [this.a, this.b]) { renderer.setRenderTarget(t); renderer.clear(); }
    renderer.setRenderTarget(null); renderer.setClearColor(cc, ca);
  }
  // 世界坐标 (x, z)，半径与强度
  add(x, z, radius, strength) {
    if (this.queue.length < 256) this.queue.push([(x + this.E) / (2 * this.E), (z + this.E) / (2 * this.E), radius / (2 * this.E), strength]);
  }
  pass(mat) {
    mat.uniforms.tPrev.value = this.a.texture; this.quad.material = mat;
    this.r.setRenderTarget(this.b); this.r.render(this.scene, this.cam);
    [this.a, this.b] = [this.b, this.a];
  }
  update(dt) {
    while (this.queue.length) {
      const batch = this.queue.splice(0, 16);
      batch.forEach((d, i) => this.drop.uniforms.drops.value[i].set(...d));
      this.drop.uniforms.uCount.value = batch.length;
      this.pass(this.drop);
    }
    this.acc += dt;
    let n = 0;
    while (this.acc >= 1 / 60 && n < 4) { this.pass(this.sim); this.acc -= 1 / 60; n++; }
    if (n === 4) this.acc = 0;
    this.r.setRenderTarget(null);
  }
  get texture() { return this.a.texture; }
}

const WATER_VS = /* glsl */`
#include <fog_pars_vertex>
uniform mat4 uTexMat; varying vec3 vW; varying vec4 vRefl;
void main(){
  vec4 w = modelMatrix * vec4(position, 1.);
  vW = w.xyz; vRefl = uTexMat * w;
  vec4 mvPosition = viewMatrix * w;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const WATER_FS = /* glsl */`
#include <common>
#include <fog_pars_fragment>
uniform sampler2D tRefl; uniform sampler2D tRefr; uniform sampler2D tRip;
uniform vec2 uRes; uniform float uTime; uniform float uE; uniform float uWind; uniform float uRain; uniform float uTexel;
uniform vec3 uSunDir; uniform vec3 uSunCol; uniform vec3 uMoonDir; uniform vec3 uMoonCol; uniform float uReflAmt; uniform vec3 uNightSheen;
uniform float uIce;   // 冬天结冰的程度（0～1）：池边一圈薄冰，越冷越往池心长
varying vec3 vW; varying vec4 vRefl;
${NOISE_GLSL}
float Rb(float t){ return 3.7 + .3 * sin(3. * t + .8) + .18 * sin(5. * t + 2.1) + .1 * sin(8. * t + .3); }
// 风吹出的细长涟漪：沿风向拉长的几层小波纹，不再是一块块的圆斑
float wh(vec2 p, float t){
  vec2 q = vec2(p.x * .55 + p.y * .2, p.y * 1.35 - p.x * .15);   // 拉长、略微倾斜
  return vnoise(q * 2.2 + t * vec2(.3, .12)) * .4 + vnoise(q * 4.6 - t * vec2(.22, .34)) * .3
       + vnoise(q * 9.5 + t * vec2(.45, -.3)) * .2 + vnoise(q * 19. - t * vec2(.6, .25)) * .1;
}
void main(){
  // 涟漪法线（来自模拟高度场）
  vec2 ruv = (vW.xz + uE) / (2. * uE);
  float hL = texture2D(tRip, ruv - vec2(uTexel, 0.)).r, hR = texture2D(tRip, ruv + vec2(uTexel, 0.)).r;
  float hD = texture2D(tRip, ruv - vec2(0., uTexel)).r, hU = texture2D(tRip, ruv + vec2(0., uTexel)).r;
  vec2 rg = vec2(hR - hL, hU - hD) * 2.5;
  // 风吹出的细小水波
  float e = .02, t = uTime, h0 = wh(vW.xz, t);
  vec2 wg = vec2(wh(vW.xz + vec2(e, 0.), t) - h0, wh(vW.xz + vec2(0., e), t) - h0) / e;
  wg *= .012 + .05 * uWind + .03 * uRain;
  vec3 n = normalize(vec3(-(wg.x + rg.x), 1., -(wg.y + rg.y)));

  // 薄冰：从石头边往里长一圈，内缘不规则；冰面上没有波纹
  float kk = length(vW.xz) / Rb(atan(vW.z, vW.x));
  float iceIn = mix(.97, .62, uIce) + (vnoise(vW.xz * 1.3 + 5.) - .5) * .14 + (vnoise(vW.xz * 4.2) - .5) * .05;
  float iceM = uIce > 0. ? smoothstep(iceIn, iceIn + .015, kk) : 0.;
  n = normalize(mix(n, vec3(0., 1., 0.), iceM * .9));

  vec3 V = normalize(cameraPosition - vW);
  float cosT = clamp(dot(n, V), 0., 1.);
  // 接近真实的菲涅尔：从上往下看只反射几个百分点，越往远处（视线越斜）倒影越明显
  float F = clamp(.035 + .965 * pow(1. - cosT, 3.2), 0., 1.);

  vec2 suv = gl_FragCoord.xy / uRes;
  vec3 refr = texture2D(tRefr, suv + n.xz * .025).rgb;
  vec4 rc = vRefl; rc.xy += n.xz * .05 * rc.w;
  vec3 refl = texture2DProj(tRefl, rc).rgb * .85;
  vec3 col = mix(refr, refl, F * uReflAmt);

  // 石头和水的交界处：一圈柔和的接触阴影（石头挡住了天光，也压在水面上）
  col *= mix(1., .62, smoothstep(.84, .98, kk));
  col += uNightSheen * (.4 + .6 * F) * (.85 + .3 * n.x);   // 夜里水面淡淡的月色反光，随波纹微微起伏

  if (iceM > 0.) {
    // 冰的颜色：半透明的灰白，透出一点水下；亮度跟着天光走（夜里不会发白）。靠近内缘的冰更薄更透
    float amb = dot(refl, vec3(.3, .59, .11)) + dot(uNightSheen, vec3(.33)) * .5;
    float thick = smoothstep(0., .12, kk - iceIn);
    vec3 iceCol = mix(refr * .6, vec3(.72, .8, .86) * (amb * 1.8 + .02), .55 + .35 * thick);
    // 冰里的裂纹和气泡：细线和小白点
    float c1 = abs(vnoise(vW.xz * 3.1) - .5), c2 = abs(vnoise(vW.xz * 5.7 + 9.) - .5);
    float crack = (1. - smoothstep(.0, .018, c1)) * .7 + (1. - smoothstep(.0, .012, c2)) * .4;
    iceCol *= 1. + crack * .5;
    iceCol += vec3(.8, .85, .9) * (amb + .02) * step(.985, hash12(floor(vW.xz * 60.))) * .4 * thick;
    // 内缘一条白一点的冰边
    iceCol += vec3(.7, .76, .82) * (amb + .02) * (1. - smoothstep(0., .025, kk - iceIn)) * .9;
    col = mix(col, iceCol, iceM);
  }

  vec3 Hs = normalize(uSunDir + V); float sh = max(dot(n, Hs), 0.);
  col += uSunCol * (pow(sh, 900.) * 9. + pow(sh, 90.) * .1) * step(0., uSunDir.y) * (1. - iceM * .85);
  vec3 Hm = normalize(uMoonDir + V);
  col += uMoonCol * pow(max(dot(n, Hm), 0.), 700.) * 8. * step(0., uMoonDir.y);

  gl_FragColor = vec4(col, 1.);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

export function createWater(ripples, extent = 5) {
  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
    tRefl: { value: null }, tRefr: { value: null }, tRip: { value: null },
    uTexMat: { value: new THREE.Matrix4() }, uRes: { value: new THREE.Vector2(1, 1) },
    uTime: { value: 0 }, uE: { value: extent }, uWind: { value: .3 }, uRain: { value: 0 }, uTexel: { value: 1 / 256 },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunCol: { value: new THREE.Color() },
    uMoonDir: { value: new THREE.Vector3(0, 1, 0) }, uMoonCol: { value: new THREE.Color() }, uReflAmt: { value: 1 }, uNightSheen: { value: new THREE.Color() }, uIce: { value: 0 },
  }]);
  const mat = new THREE.ShaderMaterial({ uniforms, vertexShader: WATER_VS, fragmentShader: WATER_FS, fog: true });
  const geo = new THREE.PlaneGeometry(2 * extent, 2 * extent); geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, mat);

  // 镜像相机（平面反射）
  const vCam = new THREE.PerspectiveCamera();
  const fwd = new THREE.Vector3(), up = new THREE.Vector3(), tgt = new THREE.Vector3();
  function updateMirror(cam) {
    cam.updateMatrixWorld();
    vCam.position.copy(cam.position); vCam.position.y *= -1;
    fwd.set(0, 0, -1).applyQuaternion(cam.quaternion);
    tgt.copy(cam.position).add(fwd); tgt.y *= -1;
    up.set(0, 1, 0).applyQuaternion(cam.quaternion); up.y *= -1;
    vCam.up.copy(up); vCam.lookAt(tgt);
    vCam.fov = cam.fov; vCam.aspect = cam.aspect; vCam.near = cam.near; vCam.far = cam.far;
    vCam.updateProjectionMatrix(); vCam.updateMatrixWorld();
    uniforms.uTexMat.value.set(.5, 0, 0, .5, 0, .5, 0, .5, 0, 0, .5, .5, 0, 0, 0, 1)
      .multiply(vCam.projectionMatrix).multiply(vCam.matrixWorldInverse);
  }
  uniforms.tRip.value = ripples.texture;
  return { mesh, uniforms, vCam, updateMirror };
}
