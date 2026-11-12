// 水面：GPU 波动方程涟漪模拟 + 折射 / 反射 / 菲涅尔 / 高光
import * as THREE from 'three';
import { NOISE_GLSL, CANOPY_GLSL } from './shaders.js';
import { shared } from './patch.js';

const QUAD_VS = /* glsl */`varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }`;

const SIM_FS = /* glsl */`
uniform sampler2D tPrev; uniform vec2 delta; uniform float uE; varying vec2 vUv;
float Rb(float t){ return 3.7 + .12 * sin(2. * t + .8) + .1 * sin(3. * t + 2.1) + .06 * sin(5. * t + .3); }
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
uniform sampler2D tWN;   // 水面细小波纹的法线贴图
uniform sampler2D tPano;    // 夜空与树冠全景图（等距柱状投影）：夜里水面的倒影
uniform sampler2D tRings;   // 同心圆涟漪法线
uniform float uNight;   // 夜的程度：夜里水面更平静、透明度低一些、月光反射柔和集中
uniform float uCanopyRefl;   // 白天头顶树冠的倒影强度（0～1）
// 夜景参数（数值在 main.js 的 NIGHT.water 里调；都乘着 uNight 或月光强度，白天不起作用）
uniform vec3 uNightWave;      // x 细波纹剩下的比例，y 同心圆涟漪的幅度，z 缓慢大波纹的幅度
uniform vec4 uMoonSpec;       // 月光亮带：x 光晕的宽度（水面倾斜量），y 顺着月光方向拉长几倍，z 亮度上限，w 碎光的柔和度（越大每一点越大越软）
uniform vec3 uMoonGain;       // x 光晕的亮度，y 碎光的亮度，z 算碎光时细波纹放大几倍（越大碎光铺得越开）
uniform float uMoonK;         // 镜头比横屏夜景远多少倍（竖屏用）：镜头越远同样的亮带在水面上越宽，按这个倍数收回来；横屏 = 1
uniform vec2 uNightDepth;     // x 水色随深度变暗的快慢（每米），y 深水区的夜空反光随水面起伏变化多少
uniform vec3 uNightShallow;   // 浅水叠加的一层淡青蓝
uniform vec3 uNightDeepTint;  // 深水的颜色倍数
varying vec3 vW; varying vec4 vRefl;
${NOISE_GLSL}
${CANOPY_GLSL}
float Rb(float t){ return 3.7 + .12 * sin(2. * t + .8) + .1 * sin(3. * t + 2.1) + .06 * sin(5. * t + .3); }
// 这里的水大约有多深（米）：pool.js 里 floorH 的主剖面（不含细小起伏）——岸边一圈浅台，往里渐深，池心是一口深井。
// 井壁是一道陡坎（半米之内深了好几米）：直接用真实深度，水色会在井口切出一圈硬边，所以井的那一段放宽、放缓（只用来决定水色，不是真实的几何）
float poolDepth(float k){
  float s = pow(smoothstep(.35, 1.1, k), .55);
  return max(.06, 2.8 - 3.1 * s) + 2.5 * (1. - smoothstep(.38, .74, k));
}
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
  // 风不是均匀地吹：水面上一块块细碎的波纹（猫爪风）和一块块几乎静止的镜面交替，缓慢漂移
  float gust = .5 + .85 * smoothstep(.25, .8, vnoise(vW.xz * .32 + t * vec2(.05, .03)) * .7 + vnoise(vW.xz * .9 - t * vec2(.04, .07)) * .3);
  wg *= (.012 + .05 * uWind + .03 * uRain) * gust;
  // 再叠一层真实水波的法线（两个尺度、朝不同方向缓慢漂移）：细小、不规则，随风和阵风起伏
  vec2 w1 = texture2D(tWN, vW.xz * .23 + t * vec2(.011, .006)).xy * 2. - 1., w2 = texture2D(tWN, vW.xz * .61 - t * vec2(.007, .013) + .37).xy * 2. - 1.;
  wg += (w1 * .6 + w2 * .4) * (.05 + .22 * uWind + .1 * uRain) * gust;
  wg *= mix(1., uNightWave.x, uNight);   // 夜里风小：细碎的高频波纹收掉一部分（它们会把月光切成一道道密集的白线）
  vec2 fine = wg;          // 细波纹（月光的碎光主要靠它）
  vec2 swell = vec2(0.);   // 夜里缓慢的大波纹：单独留着，月光亮带的形状跟着它起伏
  if (uNight > .01) {
    // 同心圆涟漪只留在零星几片水面上（缓慢漂移的斑块），其余水面平静——不再整池都是一圈圈的细纹
    float ringK = mix(.12, 1., smoothstep(.46, .74, vnoise(vW.xz * .42 + t * vec2(.011, -.007) + 7.)));
    wg += ((texture2D(tRings, vW.xz * .2 + t * vec2(.004, .002)).xy * 2. - 1.) + (texture2D(tRings, vW.xz * .13 + .5 - t * vec2(.003, .005)).xy * 2. - 1.)) * uNightWave.y * ringK * uNight;
    // 几处缓慢、不规则的大波纹（几十厘米到一米）
    swell = (vec2(vnoise(vW.xz * .85 + t * .05), vnoise(vW.xz * .85 + 31. - t * .04)) - .5) * uNightWave.z * uNight;
    wg += swell;
  }
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
  // 由浅到深（在和倒影混合之前处理折射，斜看时也看得出来）：靠岸的浅水清亮、偏青，看得见水底的卵石；
  // 往池心逐渐变深，井口是最暗的蓝黑。浅水的亮度跟着天光走（用倒影的亮度估计），夜里不会发亮
  float kk0 = length(vW.xz) / Rb(atan(vW.z, vW.x));
  float sky = clamp(dot(refl, vec3(.3, .59, .11)) * 1.6, 0., 1.);
  // 白天头顶的树冠倒影（参考图）：水面主要映出暗绿的树叶，只有叶隙里透出天光；太阳的闪光也只落在叶隙里，
  // 不再是一大片泛白的天空和太阳。沿反射光线投到 9 米高的树冠平面上，查和地面光斑同一张叶影图
  float cGap = 1.;
  if (uCanopyRefl > .001) {
    // 用压平一些的法线去查：细波纹只轻轻扭动树冠倒影，不会把它打成一片碎颗粒
    vec3 Rc = reflect(-V, normalize(mix(n, vec3(0., 1., 0.), .55)));
    vec2 q = vW.xz + Rc.xz / max(Rc.y, .12) * 9.;
    float c = texture2D(tCanopy, q / 9. + vec2(.13, .41)).r;
    float f = texture2D(tCanopy, mat2(.8, .6, -.6, .8) * q / 3.6 + vec2(.57, .22)).g;
    float gap = smoothstep(.48, .68, c) * (.7 + .3 * smoothstep(.36, .62, f));
    vec3 leaf = vec3(.012, .025, .022) * (.5 + sky);   // 背光的树叶：偏青的深绿，亮度跟着天光走
    refl = mix(refl, mix(leaf, refl, gap), uCanopyRefl);
    cGap = mix(1., gap, uCanopyRefl);
  }
  // 浅水：清澈的青绿色（只轻轻提亮，水底卵石的颜色透得出来）；往里经过一段渐变，到井口是幽暗的深青色
  float shallow = smoothstep(.5, .9, kk0);
  // 夜里的深浅不再按"离池心多远"分成几圈（浅水圈、中段、井口各有一条边，过渡显得一截一截的），
  // 而是按这里实际的水深（池底剖面）连续变化：nd = 0 贴岸的浅水 … 1 深水。白天（uNight = 0）还是原来的算法
  float nd = 1. - exp(-poolDepth(kk0) * uNightDepth.x);
  float shK = mix(shallow, 1. - nd, uNight);
  refr = mix(refr, refr * mix(vec3(1.02, 1.48, 1.5), vec3(1.05, 1.3, 1.22), uNight) + vec3(.01, .05, .042) * sky, shK);   // 夜里浅水只留极弱的青绿
  refr *= mix(1., mix(.8, .95, shK), uNight);   // 夜里：岸边浅水仍然清澈（水下的石头看得见），往里才变成深蓝黑
  refr += uNightShallow * shK * uNight;   // 浅水一层很淡的青蓝
  // 白天池水清澈：中段和井口只轻轻压暗、偏青（池底卵石一直看得见）
  vec3 dayDeep = mix(vec3(1.), vec3(.94, 1.02, 1.), (1. - shallow) * smoothstep(.45, .65, kk0)) * mix(vec3(1.), vec3(.8, .92, .9), 1. - smoothstep(.45, .7, kk0));
  // 夜里：越深越暗、越偏蓝（一条连续的渐变，到井口是蓝黑）
  vec3 nightDeep = mix(vec3(1.), uNightDeepTint, smoothstep(.1, 1., nd));
  refr *= mix(dayDeep, nightDeep, uNight);
  vec3 col = mix(refr, refl, F * uReflAmt);
  // 石头和水的交界处：窄窄一圈接触阴影（石头挡住天光、压在水面上）
  col *= mix(1., .78, smoothstep(.93, .99, kk));
  // 夜里的倒影：用全景图（夜空、月亮、四周黑色剪影的树冠），月亮的倒影被波纹打碎成一块块亮斑；靠岸的浅水倒影淡一些，透出水底
  if (uNight > .01) {
    vec3 Rr = reflect(-V, n);
    vec2 puv = vec2(atan(Rr.x, -Rr.z) / 6.28318 + .5, acos(clamp(Rr.y, -1., 1.)) / 3.14159);
    vec3 pano = texture2D(tPano, puv).rgb;
    pano = min(pano * pano * 3., vec3(.1)) * vec3(.7, 1., .95);   // 压暗、偏青；全景图里的月亮也封顶（月亮的倒影由上面那道亮带负责，不要在近处再出现一团白）
    col = mix(col, col * .8 + pano * .3, uNight * mix(.3, .75, smoothstep(.4, .9, kk0) * .5 + F));
  }
  // 夜空在水面上很淡的反光。深水区里它跟着水面的起伏变化（朝着月亮那一侧倾斜的水面映到的天更亮一点）：
  // 池心不是一整块均匀的黑，隐约看得出缓慢起伏的水面（uNightDepth.y 控制多少；白天 uNightSheen = 0）
  float tilt = clamp(dot(n.xz, normalize(uMoonDir.xz + 1e-5)) * 14., -1., 1.);
  col += uNightSheen * (.4 + .6 * F) * (.85 + .3 * n.x) * (1. + uNightDepth.y * nd * (tilt + .5));
  // 夜里池水的颜色（参考图）：不是饱和的宝蓝，而是偏青绿的深蓝——浅水带一点青绿，池心接近蓝黑
  if (uNight > .01) {
    float lw = dot(col, vec3(.3, .59, .11));
    vec3 teal = mix(col * vec3(.68, 1.05, .86), vec3(lw) * vec3(.62, .9, .92), .3);
    col = mix(col, teal, uNight * .75);
    col *= mix(1., mix(.72, 1., shK), uNight);
  }   // 夜里水面淡淡的月色反光，随波纹微微起伏

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

  // 阳光的反光：细小的点点闪光 + 一层很淡的光晕；总量封顶，不会在水面上烧出一大片白（泛光也就不会溢到石头上）
  vec3 Hs = normalize(uSunDir + V); float sh = max(dot(n, Hs), 0.);
  float glint = min(pow(sh, 1400.) * 2.2 + pow(sh, 140.) * .035 + pow(sh, 24.) * .01, .9);
  col += uSunCol * glint * cGap * step(0., uSunDir.y) * (1. - iceM * .85);
  // 月光的倒影。原来是一个极尖的高光（pow 2600）直接用带着同心圆涟漪的法线去算、再硬封顶在 .7：
  // 每一道朝向合适的波纹都整条烧成同一种白，所以看起来是聚光灯下一排密集的白线。现在：
  //  · 先算"把月亮正好反射进眼睛，水面需要倾斜多少"（need），沿月亮的方位把它压短——亮带顺着月光的方向拉长；
  //  · 碎光：水面的实际倾斜（细波纹放大一些）和 need 接近的地方亮——中间密、越往外越稀、边缘参差不齐，
  //    亮度是连续的（高斯），不是"要么全白要么没有"；
  //  · 光晕：碎光底下一层很淡的银蓝色，只跟着缓慢的大波纹走；
  //  · 两层都乘一层缓慢漂移的明暗，最后用平滑的上限（1 - exp）压住——不会有一片过曝的纯白
  if (uMoonDir.y > 0.) {
    vec3 Hm = normalize(uMoonDir + V);
    vec2 need = Hm.xz / Hm.y * uMoonK;
    vec2 md = normalize(uMoonDir.xz + 1e-5);
    need += md * dot(need, md) * (1. / uMoonSpec.y - 1.);
    vec2 slow = swell + rg * .7;
    float mottle = vnoise(vW.xz * 1.1 + t * vec2(.021, .013)) * .6 + vnoise(vW.xz * 2.7 - t * vec2(.017, .026) + 4.) * .4;
    float vary = .3 + smoothstep(.2, .8, mottle);   // 亮带里缓慢漂移的明暗（.3～1.3）：不是一条均匀的光带
    // 水面的实际倾斜：n.xz / n.y = -(wg + rg)。细波纹放大一些；同心圆涟漪反而收小（它们很陡，否则会在亮带里切出一道道弧线）
    vec2 dG = need + slow, dS = need + slow + fine * uMoonGain.z + (wg - fine - swell) * .3;
    float gg = dot(dG, dG) / (uMoonSpec.x * uMoonSpec.x);
    float glow = exp(-gg);
    float fleck = exp(-dot(dS, dS) / (uMoonSpec.w * uMoonSpec.w)) * exp(-gg * .22);   // 碎光只在亮带附近（约两倍光晕宽度以内），远处的涟漪不会零星反光
    float raw = (glow * uMoonGain.x + fleck * uMoonGain.y) * vary;
    col += uMoonCol * uMoonSpec.z * (1. - exp(-raw / uMoonSpec.z)) * (1. - iceM * .7);
  }

  gl_FragColor = vec4(col, 1.);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

export function createWater(ripples, extent = 5, waterNormal = null, night = {}) {
  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
    tRefl: { value: null }, tRefr: { value: null }, tRip: { value: null },
    uTexMat: { value: new THREE.Matrix4() }, uRes: { value: new THREE.Vector2(1, 1) },
    uTime: { value: 0 }, uE: { value: extent }, uWind: { value: .3 }, uRain: { value: 0 }, uTexel: { value: 1 / 256 },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunCol: { value: new THREE.Color() },
    uMoonDir: { value: new THREE.Vector3(0, 1, 0) }, uMoonCol: { value: new THREE.Color() }, uReflAmt: { value: 1 }, uNightSheen: { value: new THREE.Color() }, uIce: { value: 0 },
  }]);
  uniforms.tWN = { value: waterNormal };
  uniforms.tPano = { value: night.pano || null }; uniforms.tRings = { value: night.rings || null };
  uniforms.uNight = shared.uNight;   // 和岸上用同一份（同一个对象，不是复制）
  uniforms.tCanopy = shared.tCanopy; uniforms.uCanopyRefl = { value: 0 };
  // 夜景参数的默认值（和原来的效果接近）；实际数值由 main.js 的 NIGHT.water 写进来
  Object.assign(uniforms, {
    uNightWave: { value: new THREE.Vector3(.8, .35, .05) },
    uMoonSpec: { value: new THREE.Vector4(.05, 1.5, .4, .035) }, uMoonGain: { value: new THREE.Vector3(.08, .5, 2) }, uMoonK: { value: 1 },
    uNightDepth: { value: new THREE.Vector2(.9, 0) },
    uNightShallow: { value: new THREE.Color(0, .01, .012) }, uNightDeepTint: { value: new THREE.Color(.58, .72, .7) },
  });
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
