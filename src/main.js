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
let snowCover = 0, wet = 0, flash = 0, season = null;

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
scene.add(ambient);

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
const pool = buildPool(scene, { grassCount: isMobile ? 3500 : 4800, tex: texSets });
// 横屏两侧的一对守愿石狐
const foxes = buildFoxes(scene, { floorH, poolK });
const ripples = new Ripples(renderer, 256, 5);
const water = createWater(ripples, 5);
scene.add(water.mesh);

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
    foxes.layout(true, clamp(want - 4.1, .95, 2.2), clamp((want - 4.4) / 1.4, .78, 1));
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

  const s = seasonOf(simMs, loc.lat);
  if (s !== season) { season = s; pool.setSeason(s); }

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
  if (sunI >= moonI) { setSRGB(key.color, sunColS); key.intensity = sunI; key.position.copy(sunDir); }
  else { key.color.setRGB(.55, .63, .9); key.intensity = moonI; key.position.copy(moonDir); }
  key.position.y = Math.max(key.position.y, .06);
  key.position.normalize().multiplyScalar(30);
  ambient.intensity = .03 + .4 * (1 - smooth(clamp((el + 9) / 8))) + flash * 3;   // 太阳落山后才逐渐增强，黄昏的暗面不发紫

  // ---- 材质共享参数 ----
  shared.uTime.value = T;
  shared.uSunCol.value.copy(key.color).multiplyScalar(key.intensity * .55);
  shared.uCaustic.value = 1 - rn * .5;
  shared.uWaterCol.value.setRGB(.0015, .016, .03).multiplyScalar(.22 + .78 * dayF * (1 - .25 * cloud));   // 深处的幽蓝（夜里也留一点，池子不会变成黑洞）
  shared.uSnow.value = snowCover; shared.uWet.value = wet; shared.uWind.value = wind;

  const wu = water.uniforms;
  wu.uTime.value = T; wu.uWind.value = wind; wu.uRain.value = rn;
  wu.uReflAmt.value = lerp(1, .5, cloud * dayF);   // 阴天的灰白天空倒影减半，水才不会像牛奶
  wu.uSunDir.value.copy(sunDir); wu.uSunCol.value.copy(su.uSunCol.value).multiplyScalar(sunI / 20 * (1 - cloud * .9));
  wu.uMoonDir.value.copy(moonDir); wu.uMoonCol.value.setRGB(.7, .76, 1).multiplyScalar(moonI * 2);

  setSRGB(scene.fog.color, hor, .2 + .8 * dayF);
  scene.fog.density = .004 + fog * .07 + rn * .012;
  renderer.toneMappingExposure = lerp(3, 1, dayF);
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
  const deepNight = 1 - smooth(clamp((el + 10) / 8));   // 萤火虫：夏夜（晚春也有一点），天完全黑了才出来
  flies.update(T, deepNight * clamp(1 - rn * 8) * clamp(1 - wx.snow * 8) * ({ summer: 1, spring: .4 }[season] || 0));
  const light = .12 + .88 * dayF;
  rain.update(dt, rn, wind, light);
  snow.update(dt, wx.snow, wind, T, light);

  nextAmbient -= dt;
  if (nextAmbient < 0) {   // 偶尔有小鱼或水滴扰动水面
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
  composer.render();
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
canvas.addEventListener('pointerdown', e => {
  ndc.set(e.clientX / innerWidth * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const hit = raycaster.intersectObject(water.mesh)[0];
  if (hit && poolK(hit.point.x, hit.point.z) < .93) {
    ripples.add(hit.point.x, hit.point.z, .22, .5);
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
  get loc() { return loc; }, sunPos, moonPos, moonPhase,
  renderer, scene, camera, composer, water, sky, key, refrRT, reflRT,
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
