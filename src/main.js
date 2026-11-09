import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { GradeShader } from './shaders.js';
import { RAD, sunPos, moonPos, moonPhase, skyAt, seasonOf } from './astro.js';
import { PRESETS, PRESET_NAME, WX_NAME, targetsFromLive, locate, fetchWeather, tzGuess, searchCity, saveCity } from './weather.js';
import { shared } from './patch.js';
import { loadAll } from './textures.js';
import { buildFoxes, FOX_Z } from './fox.js';
import { buildPool, floorH, poolK } from './pool.js';
import { createSky } from './sky.js';
import { Ripples, createWater } from './water.js';
import { Rain, Snow, Fireflies } from './fx.js';
import { createWish } from './wish.js';
import { createWishAudio } from './audio.js';

const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = t => t * t * (3 - 2 * t);
const mixA = (a, b, t) => a.map((v, i) => lerp(v, b[i], t));
const setSRGB = (color, c, k = 1) => color.setRGB(c[0] / 255, c[1] / 255, c[2] / 255, THREE.SRGBColorSpace).multiplyScalar(k);

// ================= 状态 =================
let loc = tzGuess();   // 定位完成前先按系统时区估一个城市，保证一打开光线就基本对
let realtime = true, speed = 1, simMs = Date.now();
let wxMode = 'live', live = null, weatherReady = false;
const wx = { cloud: .2, rain: 0, snow: 0, fog: 0, thunder: 0, wind: .2 }, wxT = { ...wx };
let snowCover = 0, wet = 0, flash = 0, season = null, frost = 0, ice = 0, seasonForce = null;   // seasonForce：调试用，强制某个季节

// ================= 渲染器 / 场景 =================
const isMobile = matchMedia('(pointer: coarse)').matches || innerWidth < 800;
const DPR = Math.min(devicePixelRatio || 1, isMobile ? 1.5 : 2);
const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(DPR);
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate = false;

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x000000, .01);
const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, .1, 200);

const key = new THREE.DirectionalLight(0xffffff, 3);   // 白天是太阳，夜里切换成月光
key.castShadow = true;
key.shadow.mapSize.setScalar(isMobile ? 1536 : 2048);
Object.assign(key.shadow.camera, { left: -10, right: 10, top: 10, bottom: -10, near: 1, far: 70 });
key.shadow.bias = -.0005; key.shadow.normalBias = .03;
scene.add(key, key.target);
const ambient = new THREE.AmbientLight(0x93a4bd, .05);   // 夜间补光：冷灰蓝（不偏紫）
key.layers.enable(1); ambient.layers.enable(1);   // 第 1 层（许愿签悬在空中时）也要被照亮
scene.add(ambient);
// 黄昏的天空光：上面是冷蓝的天、下面是暗的地。太阳很低时，背光的一面被它照成冷蓝灰，
// 和朝着夕阳的金色亮面形成冷暖对比——这样看起来才是"光打在石头上"，而不是石头本身变了色
const skyFill = new THREE.HemisphereLight(0x7f97c8, 0x1c1a14, 0);
skyFill.layers.enable(1);
scene.add(skyFill);

const sky = createSky();
scene.add(sky.mesh);
const skyScene = new THREE.Scene(); skyScene.add(sky.envMesh);
const pmrem = new THREE.PMREMGenerator(renderer);
let envRT = null;
function updateEnv() {
  const rt = pmrem.fromScene(skyScene, .02, .1, 100);
  scene.environment = rt.texture;
  envRT?.dispose(); envRT = rt;
}

const texSets = loadAll(renderer);
const pool = buildPool(scene, { grassCount: isMobile ? 3500 : 4800, tuftCount: isMobile ? 16000 : 60000, tex: texSets });
// 横屏两侧的一对守愿石狐
const foxes = buildFoxes(scene, { floorH, poolK, tex: texSets });
const ripples = new Ripples(renderer, 256, 5);
const water = createWater(ripples, 5);
scene.add(water.mesh);
const sfx = createWishAudio();
const wish = createWish({ scene, ripples, floorH, sound: sfx, tex: texSets.dragon });

const groundAt = (x, z) => Math.max(floorH(x, z), 0);
const rain = new Rain(groundAt, (x, z) => {
  if (poolK(x, z) < .93 && Math.random() < .6) ripples.add(x, z, .05 + Math.random() * .04, .04 + Math.random() * .06);
}, isMobile ? 1600 : 2600);
const snow = new Snow(groundAt, isMobile ? 2000 : 3500);
const flies = new Fireflies(pool.flySpots);
scene.add(rain.obj, snow.obj, flies.obj);

// 反射 / 折射贴图
const rtOpt = { type: THREE.HalfFloatType };
const reflRT = new THREE.WebGLRenderTarget(1, 1, rtOpt), refrRT = new THREE.WebGLRenderTarget(1, 1, rtOpt);
water.uniforms.tRefl.value = reflRT.texture;
water.uniforms.tRefr.value = refrRT.texture;
const clipAbove = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);      // 保留水面以上
const clipBelow = new THREE.Plane(new THREE.Vector3(0, -1, 0), .02);   // 保留水面以下
const hideInRefl = [...pool.under, water.mesh, rain.obj, snow.obj, flies.obj];
const hideInRefr = [...pool.above, ...foxes.objects, sky.mesh, water.mesh, rain.obj, snow.obj, flies.obj];

// 后期：泛光 + 色调映射 + 暗角
const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 }));
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), .28, .5, 1.6);
composer.addPass(bloom);
// 许愿时的背景虚化（两遍可分离高斯模糊：横一遍、竖一遍），强度由 wish.focus 控制；不虚化时整段跳过
const BlurShader = {
  uniforms: { tDiffuse: { value: null }, uDir: { value: new THREE.Vector2() }, uAmt: { value: 0 }, uDim: { value: 1 } },
  vertexShader: /* glsl */`varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform vec2 uDir; uniform float uAmt; uniform float uDim; varying vec2 vUv;
    void main(){
      vec2 o = uDir * uAmt;
      vec4 c = texture2D(tDiffuse, vUv) * .227027;
      c += (texture2D(tDiffuse, vUv + o * 1.384615) + texture2D(tDiffuse, vUv - o * 1.384615)) * .316216;
      c += (texture2D(tDiffuse, vUv + o * 3.230769) + texture2D(tDiffuse, vUv - o * 3.230769)) * .070270;
      gl_FragColor = vec4(c.rgb * uDim, c.a);
    }`,
};
// 两轮（横、竖、横、竖），每轮步子小一些：模糊更顺滑，不会出现一格一格的重影
const blurs = [0, 1, 2, 3].map(() => new ShaderPass(BlurShader));
for (const b of blurs) { b.enabled = false; composer.addPass(b); }
composer.addPass(new OutputPass());
// 全画面统一的调色：略加对比度和饱和度（不改变四周明暗）
const grade = new ShaderPass(GradeShader);
composer.addPass(grade);

// ================= 镜头 =================
// 横屏：斜俯视；竖屏：更接近正俯视、拉近，池子略偏上，给底部以后的操作区留位置
const camTarget = new THREE.Vector3(), camDir = new THREE.Vector3();
let camDist = 11, portrait = false;
const parallax = new THREE.Vector2(), parallaxS = new THREE.Vector2();
function resize() {
  const w = innerWidth, h = innerHeight, aspect = w / h;
  if (!w || !h) return;   // 页面还没有尺寸（例如后台标签页），等下一次 resize
  portrait = aspect < 1;
  camera.aspect = aspect; camera.fov = portrait ? 52 : 38; camera.updateProjectionMatrix();
  const hf = 2 * Math.atan(Math.tan(camera.fov * RAD / 2) * aspect);
  if (portrait) {
    camDir.set(0, 1.7, 1).normalize(); camTarget.set(0, -.3, .55);   // 约 60° 俯角，能看到石头侧面和水面纵深
    camDist = 3.95 / Math.tan(hf / 2);          // 水面刚好占满宽度，两侧石头允许被裁掉
  } else {
    camDir.set(0, 1.25, .95).normalize(); camTarget.set(0, -.3, .4);
    camDist = Math.max(11.5, 5.2 / Math.tan(hf / 2));
    // 石狐放在离屏幕边缘约两成半的位置：按石狐那里到镜头的实际深度算出可见的半宽，但不能压到石圈上
    const foxP = new THREE.Vector3(0, .9, FOX_Z), camP = camDir.clone().multiplyScalar(camDist).add(camTarget);
    const depth = foxP.sub(camP).dot(camDir.clone().negate());
    const want = .74 * Math.tan(hf / 2) * depth;
    // 屏幕窄（两侧空间少）时石狐稍微缩小，避免贴到石圈上
    // 以较宽的右侧池边（约 4.1）为准算出能留的间距，两侧用同一个间距
    foxes.layout(true, clamp(want - 4.1, 1.25, 1.65), clamp((want - 4.4) / 1.4, .78, 1));
  }
  if (portrait) foxes.layout(false, 1.4);
  renderer.setSize(w, h);
  composer.setPixelRatio(DPR); composer.setSize(w, h);
  const bw = Math.round(w * DPR), bh = Math.round(h * DPR);
  reflRT.setSize(Math.round(bw * .6), Math.round(bh * .6));
  refrRT.setSize(Math.round(bw * .6), Math.round(bh * .6));
  water.uniforms.uRes.value.set(bw, bh);
}
resize();
addEventListener('resize', resize);

// ================= 天气 =================
function applyWeather(instant) {
  const t = wxMode === 'live' ? (live ? targetsFromLive(live) : null) : PRESETS[wxMode];
  if (!t) return;
  Object.assign(wxT, t);
  if (instant) {
    Object.assign(wx, t);
    snowCover = t.snow > .3 ? .85 : 0;
    wet = t.rain > .05 ? 1 : 0;
  }
  updateInfo();
}
async function refreshWeather() {
  try { live = await fetchWeather(loc.lat, loc.lon); applyWeather(!weatherReady); weatherReady = true; }
  catch (e) { console.warn('天气获取失败，15 分钟后重试', e); }
}
async function init() {
  loc = await locate();
  updateInfo();
  await refreshWeather();
  setInterval(refreshWeather, 15 * 60e3);
}
function setLocation(c) {   // 手动选城市
  saveCity(c);
  loc = { ...c, src: 'manual' };
  updateInfo(); refreshWeather();
}

// ================= 每帧更新 =================
const sunDir = new THREE.Vector3(), moonDir = new THREE.Vector3(), tmpC = new THREE.Color();
const nightDir = new THREE.Vector3(), twiDir = new THREE.Vector3();
const NIGHT_DIR = new THREE.Vector3(-.08, .5, -.86).normalize();   // 没有月亮时的夜光：从池子后上方照来，石头顶上勾出亮边，水面朝镜头反出一道亮带
const dirOf = (alt, az, face, out) => {
  const r = (az - face) * RAD, a = alt * RAD;
  return out.set(Math.sin(r) * Math.cos(a), Math.sin(a), -Math.cos(r) * Math.cos(a));
};
let T = 0, envTimer = 0, nextAmbient = 2, firstFrame = true;

function update(dt) {
  T += dt;
  if (realtime) simMs = Date.now(); else simMs += dt * 1000 * speed;

  const k = Math.min(1, dt * .5);
  for (const key in wx) wx[key] += (wxT[key] - wx[key]) * k;
  snowCover = clamp(snowCover + (wx.snow > .3 ? dt * .04 : -dt * .02));
  wet = clamp(wet + (wx.rain > .05 ? dt * .15 : -dt * .01));

  const s = seasonForce || seasonOf(simMs, loc.lat);
  if (s !== season) { season = s; pool.setSeason(s); }

  // ---- 冬天的点缀：白霜（夜里结、上午化）和池边薄冰（够冷才有）----
  // 有实时气温就按气温；没有（离线 / 调试天气）就按冬天的典型情况
  const tempC = wxMode === 'live' && live ? live.temperature_2m : null;
  const winter = season === 'winter' ? 1 : 0;
  const hr = new Date(simMs); const h = hr.getHours() + hr.getMinutes() / 60;
  const frostTime = h < 12 ? 1 - smooth(clamp((h - 8.5) / 3)) : smooth(clamp((h - 17) / 4));
  const cold = tempC === null ? 1 : clamp((5 - tempC) / 5);   // 5°C 以下开始结霜，0°C 以下最重
  const frostT = winter * frostTime * cold * (1 - clamp(wet * 3)) * (1 - snowCover);
  frost += (frostT - frost) * Math.min(1, dt * .3);
  const iceT = winter * (tempC === null ? .6 : clamp((1 - tempC) / 5));   // 1°C 以下开始结冰，-4°C 冰最宽
  ice += (iceT - ice) * Math.min(1, dt * .2);

  // ---- 天文 ----
  const face = loc.lat >= 0 ? 165 : 345;   // 镜头大致朝向太阳一侧，水面能看到粼粼反光
  const sun = sunPos(simMs, loc.lat, loc.lon), moon = moonPos(simMs, loc.lat, loc.lon), ph = moonPhase(simMs);
  const el = sun.alt;
  dirOf(el, sun.az, face, sunDir); dirOf(moon.alt, moon.az, face, moonDir);
  const dayF = smooth(clamp((el + 8) / 24));
  const sunUp = smooth(clamp((el + 1) / 10));
  const moonIllum = (1 - Math.cos(ph * Math.PI * 2)) / 2;
  const { cloud, rain: rn, fog, wind } = wx;

  // ---- 天空颜色（和天气混合） ----
  let [zen, hor] = skyAt(el);
  const gray = [146, 154, 166].map(v => v * (.07 + .88 * dayF) * (1 - .32 * rn));
  zen = mixA(zen, gray, cloud * .85); hor = mixA(hor, gray.map(v => v * 1.08), cloud * .75);
  const glowI = Math.exp(-(((el - 1) / 6) ** 2)) * (1 - cloud * .85) * (1 - fog * .5);
  const glowCol = mixA([215, 120, 85], [255, 158, 70], clamp((el + 6) / 8));   // 晚霞：金橙色，天黑前才略带一点暖红
  const su = sky.uniforms;
  setSRGB(su.uZen.value, zen); setSRGB(su.uHor.value, hor); setSRGB(su.uGlowCol.value, glowCol);
  su.uGlow.value = glowI;
  su.uSunDir.value.copy(sunDir); su.uMoonDir.value.copy(moonDir);
  // 阳光：低角度时是浓郁的金橙色，到太阳很高时才变成暖白（上午、下午都带着金色）
  const sunColS = mixA(mixA([255, 160, 72], [255, 200, 125], smooth(clamp(el / 18))), [255, 232, 196], smooth(clamp((el - 18) / 40)));   // 低角度的阳光偏金色而不是红色
  setSRGB(su.uSunCol.value, sunColS, 20);
  su.uSunVis.value = (1 - cloud * .95) * clamp((el + 1) / 2) * (1 - fog * .7);
  su.uMoonVis.value = clamp((moon.alt + 1) / 3) * (1 - cloud * .9) * (1 - fog * .6) * lerp(.3, 1, clamp(-el / 6 + .5));
  su.uPhase.value = ph;
  su.uNight.value = clamp(-el / 8);
  su.uStars.value = clamp((-el - 5) / 9) * (1 - cloud) * (1 - fog);
  su.uCloud.value = cloud;
  setSRGB(su.uCloudCol.value, mixA(mixA([30, 36, 52], [246, 247, 251], smooth(clamp((el + 6) / 20))), gray, cloud * .45 + rn * .35));
  setSRGB(su.uFogCol.value, hor); su.uFog.value = fog * .6;
  su.uTime.value = T;

  // ---- 主光源：太阳或月亮 ----
  // 太阳低时也保持足够亮度，长长的影子和金色光才明显
  const sunI = 4.2 * sunUp * lerp(1.15, 1, clamp(el / 30)) * (1 - .8 * cloud) * (1 - .5 * fog);
  // 晴天时天空环境光弱一些（减少石头上的蓝灰色），阴天时环境光就是主要光源
  scene.environmentIntensity = lerp(.55, .78, cloud);
  const moonI = .5 * moonIllum * clamp(moon.alt / 8) * clamp(-el / 6) * (1 - .85 * cloud);
  // 夜里的主光：真实的月亮够亮时用月亮；没有月亮（新月、月亮在地平线下）时，用一盏从池子后上方照来的冷色"天光"保底，
  // 池子、石头的轮廓和水面的一道亮带在任何一夜都看得见，不会变成一片黑
  const nightK = 1 - smooth(clamp((el + 5) / 7));
  const floorI = .3 * nightK * (1 - .6 * cloud) * (1 - .4 * fog);
  const moonW = clamp(moonI / .25);
  nightDir.copy(NIGHT_DIR).lerp(moonDir, moonW).normalize();
  const nightI = Math.max(moonI, floorI);
  // 暮光：太阳刚落下的半小时里，西边的天还亮着——一束很低的光从日落方向照来，从橙红慢慢变成蓝灰
  const twi = (1 - sunUp) * smooth(clamp((el + 9) / 8));
  const twiI = .5 * twi * (1 - .8 * cloud) * (1 - .5 * fog);
  twiDir.copy(sunDir); twiDir.y = Math.max(twiDir.y, .2); twiDir.normalize();
  if (sunI >= Math.max(twiI, nightI)) { setSRGB(key.color, sunColS); key.intensity = sunI; key.position.copy(sunDir); }
  else {
    // 暮光和夜光之间平滑过渡（方向、颜色、强度都渐变），不会突然跳
    const w = twiI / (twiI + nightI + 1e-5);
    const tw = clamp((-el - 1) / 7);   // 暮光的颜色：刚落山是橙红，天黑前是蓝灰
    tmpC.setRGB(lerp(1, .5, tw), lerp(.82, .58, tw), lerp(.68, .85, tw));
    key.color.setRGB(.55, .65, .95).lerp(tmpC, w);
    key.intensity = twiI * w + nightI * (1 - w);
    key.position.copy(nightDir).lerp(twiDir, w);
  }
  key.position.y = Math.max(key.position.y, .06);
  key.position.normalize().multiplyScalar(30);
  // 许愿时的压迫感：光变暗、环境光变弱（用上一帧的值，龙的更新在后面）
  const dread = wish.dread;
  key.intensity *= 1 - .35 * dread;
  scene.environmentIntensity *= 1 - .4 * dread;
  ambient.intensity = .03 + .4 * (1 - smooth(clamp((el + 9) / 8))) + flash * 3;
  // 黄昏（太阳高度约 -6° 到 10°）：冷色天空光补在暗面上
  const duskK = smooth(clamp((el + 6) / 4)) * (1 - smooth(clamp((el - 6) / 10)));
  skyFill.intensity = 1.1 * duskK * (1 - .5 * cloud) * (1 - .35 * dread);
  // 环境光是用天空本身生成的：日落时天边的橙光会从四面八方把石头整个染红。黄昏时减弱它，暗面交给上面的冷色天空光
  scene.environmentIntensity *= 1 - .35 * duskK * (1 - cloud);   // 太阳落山后才逐渐增强，黄昏的暗面不发紫

  // ---- 材质共享参数 ----
  shared.uTime.value = T;
  shared.uSunCol.value.copy(key.color).multiplyScalar(key.intensity * .55);
  shared.uKeyDir.value.copy(key.position).normalize();
  shared.uCaustic.value = 1 - rn * .5;
  shared.uWaterCol.value.setRGB(.0015, .016, .03).multiplyScalar(.22 + .78 * dayF * (1 - .25 * cloud));   // 深处的幽蓝（夜里也留一点，池子不会变成黑洞）
  const windNow = wind * (1 - .92 * dread);   // 风停了：草不动、水面变得像镜子一样
  shared.uSnow.value = snowCover; shared.uWet.value = wet; shared.uWind.value = windNow;
  shared.uFrost.value = frost;

  const wu = water.uniforms;
  wu.uTime.value = T; wu.uWind.value = windNow; wu.uRain.value = rn; wu.uIce.value = ice;
  wu.uReflAmt.value = lerp(1, .5, cloud * dayF);   // 阴天的灰白天空倒影减半，水才不会像牛奶
  wu.uSunDir.value.copy(sunDir); wu.uSunCol.value.copy(su.uSunCol.value).multiplyScalar(sunI / 20 * (1 - cloud * .9) * (1 + 2.5 * duskK));   // 夕阳在水面上拉出一道金色亮带
  wu.uMoonDir.value.copy(nightDir); wu.uMoonCol.value.setRGB(.7, .76, 1).multiplyScalar(nightI * 1.2 * (1 - smooth(clamp((el + 2) / 6))));   // 水面上的月光亮带（没有月亮时是天光的反光）

  setSRGB(scene.fog.color, hor, .2 + .8 * dayF);
  scene.fog.density = .004 + fog * .07 + rn * .012;
  renderer.toneMappingExposure = lerp(3, 1, smooth(clamp((el + 10) / 14))) + .4 * duskK;   // 太阳还在地平线上时不额外提亮：黄昏保留明暗对比，天黑后才慢慢拉高
  grade.uniforms.saturation.value = (1.12 - .14 * duskK) * (1 - .3 * dread);   // 黄昏不额外加饱和度，金色才不会像涂上去的   // 颜色褪去一些
  grade.uniforms.night.value = 1 - smooth(clamp((el + 9) / 8));   // 月夜调色：太阳落下后才慢慢开始，黄昏保留暖色
  wu.uNightSheen.value.setRGB(.008, .016, .038).multiplyScalar(grade.uniforms.night.value * (1 - .4 * cloud));   // 阴天不再额外提亮，否则石头发白

  // ---- 雷电 ----
  if (wx.thunder > .5 && Math.random() < dt * .08) flash = 1;
  flash *= Math.exp(-dt * 6);
  su.uFlash.value = flash * .6;

  // ---- 灯笼 / 萤火虫 / 落叶 / 粒子 ----
  // 石灯笼：太阳落到地平线附近开始点亮，天黑后全亮；阴雨天的傍晚会早一点亮
  // 池心微光：天黑后慢慢亮起（下雨时水面被打乱，稍弱一些）
  shared.uDeepGlow.value = (1 - smooth(clamp((el + 6) / 8))) * (1 - rn * .4) * .028;
  // 许愿时：等待龙的那几秒，池底深处慢慢亮起来（白天也看得到一点）
  wish.update(dt, { day: dayF });
  shared.uDeepGlow.value += wish.glow * (.05 + .05 * dayF);
  sfx.level(wish.dread);
  const deepNight = 1 - smooth(clamp((el + 10) / 8));   // 萤火虫：夏夜（晚春也有一点），天完全黑了才出来
  flies.update(T, (1 - dread) * deepNight * clamp(1 - rn * 8) * clamp(1 - wx.snow * 8) * ({ summer: 1, spring: .4 }[season] || 0));
  const light = .12 + .88 * dayF;
  rain.update(dt, rn, wind, light);
  snow.update(dt, wx.snow, wind, T, light);

  nextAmbient -= dt;
  if (nextAmbient < 0 && dread < .05) {   // 偶尔有小鱼或水滴扰动水面（许愿时一片死寂，不再有）
    nextAmbient = 3 + Math.random() * 5;
    const a = Math.random() * 6.28, r = Math.sqrt(Math.random()) * 2.8;
    ripples.add(Math.cos(a) * r, Math.sin(a) * r, .08, .08);
  }
  ripples.update(dt);

  // ---- 环境光贴图 ----
  envTimer -= dt;
  if (envTimer <= 0 || firstFrame) { updateEnv(); envTimer = (!realtime || speed > 1) ? .25 : 2; }

  // ---- 镜头微动 ----
  parallaxS.lerp(parallax, Math.min(1, dt * 2));
  camera.position.copy(camDir).multiplyScalar(camDist).add(camTarget);
  // 镜头只跟随电脑鼠标轻微移动；不再自己缓慢漂移（会让细小的草地闪烁）
  camera.position.x += parallaxS.x * .5;
  camera.position.z += parallaxS.y * .3;
  camera.lookAt(camTarget);
  if (camOverride) { camera.position.copy(camOverride.p); camera.lookAt(camOverride.t); }   // 仅开发调试用的特写镜头
}
let camOverride = null;

function render() {
  renderer.shadowMap.needsUpdate = true;
  water.updateMirror(camera);

  const hide = list => { const prev = list.map(o => o.visible); list.forEach(o => o.visible = false); return () => list.forEach((o, i) => o.visible = prev[i]); };

  let restore = hide(hideInRefl);
  renderer.clippingPlanes = [clipAbove];
  renderer.setRenderTarget(reflRT); renderer.clear();
  renderer.render(scene, water.vCam);
  restore();

  restore = hide(hideInRefr);
  renderer.clippingPlanes = [clipBelow];
  const cc = new THREE.Color(); renderer.getClearColor(cc);
  renderer.setClearColor(shared.uWaterCol.value);
  renderer.setRenderTarget(refrRT); renderer.clear();
  renderer.render(scene, camera);
  renderer.setClearColor(cc);
  restore();

  renderer.clippingPlanes = [];
  renderer.setRenderTarget(null);
  // 背景虚化：两遍模糊的强度跟着 wish.focus，四周再稍微压暗一点
  const f = wish.focus;
  for (const b of blurs) b.enabled = f > .01;
  if (f > .01) {
    const sz = renderer.getDrawingBufferSize(new THREE.Vector2());
    blurs.forEach((b, i) => {
      b.uniforms.uDir.value.set(i % 2 ? 0 : 1 / sz.x, i % 2 ? 1 / sz.y : 0);
      b.uniforms.uAmt.value = f * (i < 2 ? 1.6 : 2.6) * renderer.getPixelRatio();
      b.uniforms.uDim.value = i === 3 ? 1 - .22 * f : 1;
    });
  }
  composer.render();
  // 悬在空中的许愿签：单独画在最上面（不被虚化）
  if (wish.overlay) {
    const ac = renderer.autoClear; renderer.autoClear = false; renderer.clearDepth();
    camera.layers.set(1); renderer.render(scene, camera); camera.layers.set(0);
    renderer.autoClear = ac;
  }
}

let last = performance.now();
function loop(now) {
  const dt = Math.min(.05, (now - last) / 1000); last = now;
  update(dt);
  render();
  if (firstFrame) { firstFrame = false; document.getElementById('loading').classList.add('done'); }
  requestAnimationFrame(loop);
}

// ================= 交互 =================
const raycaster = new THREE.Raycaster(), ndc = new THREE.Vector2();
// 长按不弹系统菜单（安卓浏览器的长按菜单、电脑上的右键菜单）
addEventListener('contextmenu', e => { if (e.target === canvas) e.preventDefault(); });
const setRay = e => { ndc.set(e.clientX / innerWidth * 2 - 1, -(e.clientY / innerHeight) * 2 + 1); raycaster.setFromCamera(ndc, camera); };
canvas.addEventListener('pointerdown', e => {
  setRay(e);
  // 许愿签还在等输入时点它：重新弹出输入框
  if (wish.waiting && wish.inputReady && wish.hitPaper(raycaster)) { openWishInput(); wishInput.focus(); return; }
  // 左边的石狐（屏幕左半边那一只）：唤来许愿签；右边那只：签落进水里之后，唤龙
  const f = foxes.pick(raycaster);
  if (f) {
    const left = f.point.clone().project(camera).x < 0;
    if (left && !wish.busy) { sfx.unlock(); wish.summon(camera); return; }   // 声音只能在用户点击时开启
    if (!left && wish.canCall) { sfx.unlock(); wish.callDragon(); return; }
  }
  const hit = raycaster.intersectObject(water.mesh)[0];
  if (hit && poolK(hit.point.x, hit.point.z) < .93) {
    ripples.add(hit.point.x, hit.point.z, .22, .5);
  }
});
canvas.addEventListener('pointermove', e => {
  setRay(e);
  // 鼠标移到能点的石狐上时，换成手形光标
  if (e.pointerType === 'mouse') {
    const over = (f => f && (f.point.clone().project(camera).x < 0 ? !wish.busy : wish.canCall))(foxes.pick(raycaster)) ? 'pointer' : '';
    canvas.style.cursor = over;
  }
});
addEventListener('pointermove', e => { if (e.pointerType === 'mouse') parallax.set(e.clientX / innerWidth - .5, e.clientY / innerHeight - .5); });

// ================= UI =================
const $ = id => document.getElementById(id);
const pad = n => String(n).padStart(2, '0');
let dragging = false;
// 页面上不显示时间、地点、天气；这些只在调试面板里能看到
function updateInfo() {
  const d = new Date(simMs);
  let w;
  if (wxMode !== 'live') w = PRESET_NAME[wxMode] + '（调试）';
  else if (live) w = `${WX_NAME[live.weather_code] ?? '—'} ${Math.round(live.temperature_2m)}°C`;
  else w = '感知天气…';
  $('dbgPlace').textContent = `${loc.name || '未知'} · ${w}`;
  if (!dragging) $('hour').value = d.getHours() + d.getMinutes() / 60;
  $('hourTxt').textContent = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ---- 许愿 ----
// 页面上没有任何提示：点左边的石狐 → 风送来一张许愿签，同时出现一条输入线 → 写完按回车，字一笔一笔写到签上
// → 签自己落进池里（点右边的石狐才会唤来龙）（之后的仪式在 wish.js）。龙要来的位置：池心稍微靠近镜头一侧
const wishLand = () => { const d = new THREE.Vector3(camera.position.x, 0, camera.position.z).normalize().multiplyScalar(.7); return { x: d.x, z: d.z, facing: Math.atan2(d.x, d.z) }; };
function throwWish(text) {   // 调试用：跳过写字和拖动，直接从落点上方投下去
  if (wish.busy || !text.trim()) return;
  const w = wishLand();
  wish.start(text, w, { facing: w.facing, callNow: true });
}
const wishInput = $('wishInput'), wishPanel = $('wishPanel'), wishOk = $('wishOk');
// 签停稳、四周虚化之后才出现输入框（电脑上自动把光标放进去；手机上点一下输入框才会弹出键盘）
function openWishInput() { if (!wishPanel.hidden) return; wishInput.value = ''; wishOk.disabled = true; wishPanel.hidden = false; if (matchMedia('(pointer: fine)').matches) wishInput.focus(); }
function closeWishInput() { wishInput.blur(); wishPanel.hidden = true; }
// 确认：字写到签上，停一下，签自己落进水里（落点：池心靠镜头一侧，龙来的地方）
const submitWish = () => { const v = wishInput.value.trim(); if (!v) return; const w = wishLand(); wish.write(v, w, { facing: w.facing }); closeWishInput(); };
wishInput.addEventListener('input', () => { wishOk.disabled = !wishInput.value.trim(); });
wishInput.addEventListener('keydown', e => {
  if (e.isComposing || e.keyCode === 229) return;   // 输入法正在拼字时的回车不算
  if (e.key === 'Enter') submitWish();
  else if (e.key === 'Escape') { wish.dismiss(); closeWishInput(); }
});
wishOk.onclick = submitWish;
setInterval(() => { if (wish.inputReady) openWishInput(); }, 100);


// 城市选择（入口在调试面板里）
let searchTimer;
$('cityBtn').onclick = () => {
  $('picker').hidden = false; $('cityInput').value = ''; $('cityList').replaceChildren();
  setTimeout(() => $('cityInput').focus(), 50);
};
$('closePicker').onclick = () => { $('picker').hidden = true; };
$('picker').onclick = e => { if (e.target.id === 'picker') $('picker').hidden = true; };
$('cityInput').oninput = e => {
  clearTimeout(searchTimer);
  const q = e.target.value.trim();
  if (!q) { $('cityList').replaceChildren(); return; }
  searchTimer = setTimeout(async () => {
    const li = (text, sub) => { const el = document.createElement('li'); el.textContent = text; if (sub) { const s = document.createElement('small'); s.textContent = sub; el.append(s); } return el; };
    try {
      const rs = await searchCity(q);
      $('cityList').replaceChildren(...(rs.length ? rs.map(c => {
        const el = li(c.name, c.desc);
        el.onclick = () => { $('picker').hidden = true; setLocation({ lat: c.lat, lon: c.lon, name: c.name }); };
        return el;
      }) : [li('没有找到这个城市')]));
    } catch { $('cityList').replaceChildren(li('搜索失败，请检查网络')); }
  }, 300);
};
$('useGps').onclick = async () => {
  saveCity(null); $('picker').hidden = true;
  loc = await locate(); updateInfo(); refreshWeather();
};

// 调试面板：网址带 ?debug 才显示
if (new URLSearchParams(location.search).has('debug')) $('gear').hidden = false;
$('gear').onclick = () => { $('panel').hidden = !$('panel').hidden; };
$('hour').addEventListener('pointerdown', () => dragging = true);
addEventListener('pointerup', () => dragging = false);
$('hour').oninput = e => {
  const h = +e.target.value, d = new Date(simMs);
  d.setHours(Math.floor(h), Math.round((h % 1) * 60), 0, 0);
  simMs = d.getTime(); realtime = false; updateInfo();
};
$('speed').onchange = e => { speed = +e.target.value; if (speed > 1) realtime = false; };
$('wx').onchange = e => { wxMode = e.target.value; applyWeather(false); };
$('reset').onclick = () => {
  realtime = true; speed = 1; $('speed').value = '1';
  wxMode = 'live'; $('wx').value = 'live'; applyWeather(false);
};
setInterval(updateInfo, 1000);

// 调试用（只在开发模式下暴露）
if (import.meta.env.DEV) window.__wish = {
  setTime(h) { const d = new Date(simMs); d.setHours(Math.floor(h), Math.round((h % 1) * 60), 0, 0); simMs = d.getTime(); realtime = false; },
  setSimMs(ms) { simMs = ms; realtime = false; },
  setWeather(m) { wxMode = m; applyWeather(true); },
  setSeason(s) { seasonForce = s; },
  wish: throwWish, get wishState() { return wish; },
  get loc() { return loc; }, sunPos, moonPos, moonPhase,
  renderer, scene, camera, composer, water, sky, key, refrRT, reflRT, pool,
  step(n = 1, dt = 1 / 60) { for (let i = 0; i < n; i++) { update(dt); render(); } },
  closeup(p, t) { camOverride = p ? { p: new THREE.Vector3(...p), t: new THREE.Vector3(...t) } : null; },
  async shot(name) {   // 开发用：渲染一帧并保存到 .shots/
    update(1 / 60); render();
    const blob = await new Promise(r => renderer.domElement.toBlob(r, 'image/jpeg', .85));
    await fetch(`/__shot?name=${name}`, { method: 'POST', body: blob });
    return name;
  },
};

updateInfo();
requestAnimationFrame(loop);
init();
