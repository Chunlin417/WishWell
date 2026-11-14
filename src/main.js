import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { GradeShader } from './shaders.js';
import { RAD, sunPos, moonPos, moonPhase, skyAt, seasonOf } from './astro.js';
import { PRESETS, PRESET_NAME, WX_NAME, targetsFromLive, fetchWeather } from './weather.js';
import { shared } from './patch.js';
import { loadAll } from './textures.js';
import { buildFoxes, FOX_Z } from './fox.js';
import { buildPool, floorH, poolK, LEAF_CARDS } from './pool.js';
import { createSky } from './sky.js';
import { Ripples, createWater } from './water.js';
import { Rain, Snow, Fireflies, FallingLeaves } from './fx.js';
import { createWish, DRAGON_ENABLED } from './wish.js';
import { createWishAudio } from './audio.js';
import { getName, setName, canWish, addPlaque, listPlaques, hasWished, rememberWish, NAME_MAX, nowMs, listIncense, canLightIncense, lightIncense, initStore, refreshStore, onStoreChange } from './courtStore.js';
// 开关：false = 许愿功能关闭（点左边的石狐没有反应，也不会出现手形光标）
const WISH_ENABLED = true;

const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = t => t * t * (3 - 2 * t);
const mixA = (a, b, t) => a.map((v, i) => lerp(v, b[i], t));
const setSRGB = (color, c, k = 1) => color.setRGB(c[0] / 255, c[1] / 255, c[2] / 255, THREE.SRGBColorSpace).multiplyScalar(k);

// ================= 状态 =================
// 这口井在富士山北麓的忍野八海（山梨县）：不读取玩家的位置，所有人看到的都是这里此刻的样子——
// 日本的昼夜、天气、季节（太阳、月亮按真实时刻和这里的经纬度算；钟点、季节按日本时间 UTC+9）
const loc = { lat: 35.461, lon: 138.833, name: '忍野八海（山梨县）' };
const JST = 9 * 3600e3;
const jstHour = ms => { const d = new Date(ms + JST); return d.getUTCHours() + d.getUTCMinutes() / 60; };
const atJstHour = (ms, h) => Math.floor((ms + JST) / 864e5) * 864e5 - JST + Math.round(h * 60) * 60e3;   // 同一个日本日期里的 h 点
let realtime = true, speed = 1, simMs = Date.now();
let wxMode = 'live', live = null, weatherReady = false;
const wx = { cloud: .2, rain: 0, snow: 0, fog: 0, thunder: 0, wind: .2 }, wxT = { ...wx };
let snowCover = 0, wet = 0, flash = 0, season = null, frost = 0, ice = 0, seasonForce = null;   // seasonForce：调试用，强制某个季节

// ================= 渲染器 / 场景 =================
const isMobile = matchMedia('(pointer: coarse)').matches || innerWidth < 800;
// 分辨率：像素比最高 1.25（再高画面几乎看不出区别，显卡要多算一倍以上的像素）；
// 运行时按实际帧率自动升降（resScale 0.6～1），集成显卡、手机上也能保持流畅
const DPR_MAX = Math.min(devicePixelRatio || 1, 1.25);
let resScale = 1, DPR = DPR_MAX;
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
// 夜景参数集中在这里调（都只在夜里起作用：按 night = 太阳落下后的程度 0～1 渐入渐出，白天不受影响）
const NIGHT = {
  keyCol: [.74, .81, 1],      // 月光的颜色：低饱和的冷蓝白（原来 .55,.65,.95 太蓝）
  moonI: .5,                 // 真实月亮的最大强度（满月、高悬）
  floorI: .4,                // 没有月亮时"天光"的强度：方向光，石头顶上和石狐轮廓有柔和的亮面
  ambient: .2,                // 均匀补光（原来 .4：把石头、草、石狐全照成一样的蓝灰色）
  fill: .42,                  // 夜空的半球光：上面冷蓝、下面暗绿褐——暗部有层次，但不是死黑
  fireflies: .15,             // 萤火虫的多少（夏夜；夜景参考图里没有，只留零星几只）
  vignette: .18,              // 夜里的暗角：只轻轻压一点四角（太重会只剩池子一圈是亮的，参考图里四周的植物也看得清）
  exposure: 2.35,              // 夜里的曝光（原来 3：满月时石头被照得发白）
  // ---- 水面 ----
  water: {
    moonCol: [.5, .63, .88],   // 水面月光亮带的颜色：柔和的银蓝（再乘上当晚的月光强度）
    glowW: .05,                // 亮带底下那层光晕的宽度（水面倾斜量：越大越宽）
    stretch: 1.25,             // 亮带顺着月光方向拉长几倍
    glowI: .06,                // 光晕的亮度
    fleckI: .4,                // 碎光的亮度
    fleckAmp: 3,               // 算碎光时细波纹放大几倍（越大碎光铺得越开、越碎；太大又会变回密集的细线）
    fleckSoft: .033,           // 碎光的柔和度（越大每一点越大、越软；越小越细、越稀）
    peak: .36,                 // 月光反射的亮度上限（平滑封顶；原来是硬封顶 .7，整片烧成同一种白）
    ripple: .6,                // 夜里细波纹剩下的比例（白天 = 1，原来 .8）
    rings: .2,                 // 同心圆涟漪的幅度（原来 .35 且整池都有；现在只在零星几片水面上）
    swell: .06,                // 缓慢大波纹的幅度（亮带的边缘跟着它起伏）
    speed: .7,                 // 夜里水波的速度（白天 = 1）
    absorb: [1.9, .62, .58],   // 池水每米吸收多少（红、绿、蓝）：红光先没，蓝光留得最久——越深越蓝
    deepCol: [.0015, .0118, .0165],   // 深处的水色：蓝黑（原来偏青绿 .0017, .0156, .0156）
    depthK: .9,                // 水色随深度变暗的快慢（每米）
    shallowCol: [0, .011, .014],      // 浅水叠加的一层淡青蓝
    deepTint: [.56, .71, .74],        // 深水的颜色倍数
    deepRefl: .6,              // 深水区的夜空反光随水面起伏变化多少（池心不是一整块均匀的黑；0 = 不变化）
  },
  // ---- 岩石 ----
  rock: {
    dryRough: .6,              // 干燥的石面夜里的粗糙度往 1 推多少（0 = 贴图原样，1 = 完全漫反射）
    wetRough: .38,             // 潮湿处的粗糙度（白天水线处是 .28；越小越亮、越像镜面）
    wetReach: .34,             // 潮气沿水线往上爬多高（米；上缘被噪声搅得参差不齐）
    seep: .35,                 // 远离水线的零星潮斑有多少（0 = 没有）
    glossDry: .03,             // 月光高光：干燥的石面
    glossWet: .1,              // 月光高光：潮湿的石面
  },
  // ---- 石狐（不加灯：只调已有的月光和天光怎么落在石雕上）----
  fox: {
    fill: .25,                 // 暗部的天光多出的比例
    wrap: .45,                 // 月光绕过明暗交界线多少（0 = 不绕）
    rim: .3,                   // 朝月一侧、视线擦过石面处的一线月色（0 = 没有）
  },
  // ---- 植被 ----
  veg: {
    desat: .3,                 // 褪色（原来 .2）
    dim: 1.1,                  // 压暗：越浅的叶片压得越多（深绿的叶子约 -7%，发白的浅色叶片约 -25%；原来统一 -10%）
    dapple: 1,                 // 月光穿过树冠的明暗有多明显（0 = 所有叶片一样亮）
    shade: .76,                // 月影里直射月光剩下的比例（太低背景会出现成片的黑）
    lit: 1.35,                 // 被月光照到的叶片的亮度
  },
};
const ambient = new THREE.AmbientLight(0x8d98a6, .05);   // 夜间补光：冷灰（不偏紫）
key.layers.enable(1); ambient.layers.enable(1);   // 第 1 层（许愿签悬在空中时）也要被照亮
scene.add(ambient);
// 黄昏的天空光：上面是冷蓝的天、下面是暗的地。太阳很低时，背光的一面被它照成冷蓝灰，
// 和朝着夕阳的金色亮面形成冷暖对比——这样看起来才是"光打在石头上"，而不是石头本身变了色
const skyFill = new THREE.HemisphereLight(0x7f97c8, 0x1c1a14, 0);
skyFill.layers.enable(1);
scene.add(skyFill);
const nightFill = new THREE.HemisphereLight(0x6f819f, 0x1d2419, 0);   // 夜空的天光：朝上的面略亮、朝下的面暗绿褐
nightFill.layers.enable(1);
scene.add(nightFill);
// 白天的柔和间接光：上面是略带天青的白，下面是草地反上来的暖橄榄绿——阴影不再发黑发蓝，
// 石头、草地和石狐的暗面被同一层环境光托起来（亮面不变，明暗对比还在）
const bounce = new THREE.HemisphereLight(0xd4d8cf, 0x6a7244, 0);
bounce.layers.enable(1);
scene.add(bounce);

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

// 加载遮罩：贴图和模型全部下载完、再画几帧（着色器编译好）之后才淡出——玩家不会先看到没贴图的土色地面和石头
// （贴图、模型都走 three.js 默认的加载管理器；万一网络很慢，最多等 15 秒也会揭开）
let assetsReady = false, readyFrames = 0, revealed = false;
THREE.DefaultLoadingManager.onLoad = () => { assetsReady = true; };
setTimeout(() => { assetsReady = true; }, 15000);
const texSets = loadAll(renderer, { dragon: DRAGON_ENABLED });
shared.tCanopy.value = texSets.canopy;   // 树荫光斑遮罩
const pool = buildPool(scene, { grassCount: isMobile ? 3500 : 4800, tuftCount: isMobile ? 16000 : 36000, tex: texSets });
// 横屏两侧的一对守愿石狐
const foxes = buildFoxes(scene, { floorH, poolK, tex: texSets, onLayout: pool.dressFoxes });   // 底座四周的泥土、苔藓、小草跟着石狐走
const ripples = new Ripples(renderer, 256, 5);
const water = createWater(ripples, 5, texSets.waterNormal, { pano: texSets.nightPano, rings: texSets.ripplesRings });
scene.add(water.mesh);
// 夜景参数写进着色器（这些只在夜里起作用：着色器里都乘着"夜的程度"）。
// 开发时可以在控制台改 __wish.NIGHT 里的数值再调 __wish.applyNight()，不用刷新就能看到效果
function applyNight() {
  const W = NIGHT.water, R = NIGHT.rock, F = NIGHT.fox, V = NIGHT.veg, wu = water.uniforms;
  wu.uNightWave.value.set(W.ripple, W.rings, W.swell);
  wu.uMoonSpec.value.set(W.glowW, W.stretch, W.peak, W.fleckSoft);
  wu.uMoonGain.value.set(W.glowI, W.fleckI, W.fleckAmp);
  wu.uNightDepth.value.set(W.depthK, W.deepRefl);
  wu.uNightShallow.value.setRGB(...W.shallowCol);
  wu.uNightDeepTint.value.setRGB(...W.deepTint);
  shared.uAbsorbNight.value.set(...W.absorb);
  shared.uRockNight.value.set(R.dryRough, R.wetRough, R.wetReach, R.seep);
  shared.uRockGloss.value.set(R.glossDry, R.glossWet);
  shared.uFoxNight.value.set(F.fill, F.wrap, F.rim);
  shared.uVegNight.value.set(V.desat, V.dim, V.shade, V.lit);
}
applyNight();
const sfx = createWishAudio();
const wish = createWish({ scene, ripples, floorH, sound: sfx, tex: texSets.dragon, onSettled: saveSettledWish });

const groundAt = (x, z) => Math.max(floorH(x, z), 0);
const rain = new Rain(groundAt, (x, z) => {
  if (poolK(x, z) < .93 && Math.random() < .6) ripples.add(x, z, .05 + Math.random() * .04, .04 + Math.random() * .06);
}, isMobile ? 1600 : 2600);
const snow = new Snow(groundAt, isMobile ? 2000 : 3500);
const flies = new Fireflies(pool.flySpots);
const fallLeaves = new FallingLeaves({ map: texSets.leaves, cells: LEAF_CARDS, groundAt, onWater: (x, z) => { if (poolK(x, z) < .93) ripples.add(x, z, .06, .1); }, count: isMobile ? 18 : 30 });
scene.add(rain.obj, snow.obj, flies.obj, fallLeaves.obj);

// 反射 / 折射贴图
const rtOpt = { type: THREE.HalfFloatType };
const reflRT = new THREE.WebGLRenderTarget(1, 1, rtOpt), refrRT = new THREE.WebGLRenderTarget(1, 1, rtOpt);
water.uniforms.tRefl.value = reflRT.texture;
water.uniforms.tRefr.value = refrRT.texture;
const clipAbove = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);      // 保留水面以上
const clipBelow = new THREE.Plane(new THREE.Vector3(0, -1, 0), .02);   // 保留水面以下
const hideInRefl = [...pool.under, ...pool.reflSkip, water.mesh, rain.obj, snow.obj, flies.obj];
const hideInRefr = [...pool.above, ...foxes.objects, sky.mesh, water.mesh, rain.obj, snow.obj, flies.obj, fallLeaves.obj];

// 后期：泛光 + 色调映射 + 暗角
const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 }));
const renderPass = new RenderPass(scene, camera);   // 切换场景时换掉它的 scene / camera（见下面"场景切换"）
composer.addPass(renderPass);
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
const viewDir = new THREE.Vector3(), viewTarget = new THREE.Vector3();   // 这一帧实际用的镜头方向和注视点（昼夜相同：夜里不再移动镜头）
let camDist = 11, portrait = false;
let court = null;   // 小院场景（第一次进去时才加载，见"场景切换"）
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
  court?.resize(aspect);
  renderer.setSize(w, h);
  composer.setPixelRatio(DPR); composer.setSize(w, h);
  const bw = Math.round(w * DPR), bh = Math.round(h * DPR);
  reflRT.setSize(Math.round(bw * .45), Math.round(bh * .45));   // 倒影本来就被波纹打散，分辨率低一些看不出来
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
  updateInfo();
  await refreshWeather();
  setInterval(refreshWeather, 15 * 60e3);
}

// ================= 每帧更新 =================
const sunDir = new THREE.Vector3(), moonDir = new THREE.Vector3(), tmpC = new THREE.Color();
const nightDir = new THREE.Vector3(), twiDir = new THREE.Vector3();
const MOON_REFL_DIR = new THREE.Vector3(-.08, .56, -.82).normalize();   // 水面月光倒影的方向：固定在池子后方偏上——无论真实月亮在哪，夜里总有一条银蓝色亮带落在池面上半部中间（像参考图）
const MOON_SPOT = { x: -.94, z: -1.18, dist: 11.7 };   // 月光亮带的中心落在水面上的位置，和参考距离（亮带宽度按这个距离调的；镜头更远时 uMoonK 把它收窄）
const NIGHT_DIR = new THREE.Vector3(-.25, .6, -.76).normalize();   // 没有月亮时的夜光：从池子左后上方照来——石头顶上、石狐头顶和面部有柔和的亮面，水面后方反出一道月光
const dirOf = (alt, az, face, out) => {
  const r = (az - face) * RAD, a = alt * RAD;
  return out.set(Math.sin(r) * Math.cos(a), Math.sin(a), -Math.cos(r) * Math.cos(a));
};
let T = 0, waterT = 0, envAge = 0, nextAmbient = 2, firstFrame = true, shadowTick = 0;
const envKey = new Float32Array(12);   // 上一次生成环境光时的天空颜色：天空明显变了才重新生成

function update(dt) {
  T += dt;
  if (realtime) simMs = Date.now(); else simMs += dt * 1000 * speed;

  const k = Math.min(1, dt * .5);
  for (const key in wx) wx[key] += (wxT[key] - wx[key]) * k;
  snowCover = clamp(snowCover + (wx.snow > .3 ? dt * .04 : -dt * .02));
  wet = clamp(wet + (wx.rain > .05 ? dt * .15 : -dt * .01));

  const s = seasonForce || seasonOf(simMs + JST, loc.lat);
  if (s !== season) { season = s; pool.setSeason(s); }

  // ---- 冬天的点缀：白霜（夜里结、上午化）和池边薄冰（够冷才有）----
  // 有实时气温就按气温；没有（离线 / 调试天气）就按冬天的典型情况
  const tempC = wxMode === 'live' && live ? live.temperature_2m : null;
  const winter = season === 'winter' ? 1 : 0;
  const h = jstHour(simMs);   // 日本时间的钟点
  // 夜里和清晨霜最重；白天也不完全化掉（背阴处、草尖上留着一层薄霜），冬天任何时候打开都看得出来
  const frostTime = Math.max(.4, h < 12 ? 1 - smooth(clamp((h - 8.5) / 3)) : smooth(clamp((h - 17) / 4)));
  const cold = tempC === null ? 1 : clamp((8 - tempC) / 8);   // 8°C 以下开始有霜，0°C 以下最重
  const frostT = winter * frostTime * cold * (1 - clamp(wet * 3)) * (1 - snowCover);
  frost += (frostT - frost) * Math.min(1, dt * .3);
  // 1°C 以下冰往池心长，-4°C 最宽；不太冷的冬日也留着贴岸的一圈薄冰（10°C 以上才没有）
  const iceT = winter * (tempC === null ? .6 : Math.max(clamp((1 - tempC) / 5), .28 * clamp((10 - tempC) / 6)));
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
  const moonI = NIGHT.moonI * moonIllum * clamp(moon.alt / 8) * clamp(-el / 6) * (1 - .85 * cloud);
  // 夜里的主光：真实的月亮够亮时用月亮；没有月亮（新月、月亮在地平线下）时，用一盏从池子后上方照来的冷色"天光"保底，
  // 池子、石头的轮廓和水面的一道亮带在任何一夜都看得见，不会变成一片黑
  const nightK = 1 - smooth(clamp((el + 5) / 7));
  const floorI = NIGHT.floorI * nightK * (1 - .6 * cloud) * (1 - .4 * fog);
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
    key.color.setRGB(...NIGHT.keyCol).lerp(tmpC, w);
    key.intensity = twiI * w + nightI * (1 - w);
    key.position.copy(nightDir).lerp(twiDir, w);
  }
  key.position.y = Math.max(key.position.y, .06);
  key.position.normalize().multiplyScalar(30);
  // 许愿时的压迫感：光变暗、环境光变弱（用上一帧的值，龙的更新在后面）
  const dread = wish.dread;
  key.intensity *= 1 - .35 * dread;
  scene.environmentIntensity *= 1 - .4 * dread;
  const nightF = 1 - smooth(clamp((el + 9) / 8));   // 夜的程度：太阳落到 -1° 以下才开始，-17° 全黑夜
  ambient.intensity = .03 + NIGHT.ambient * nightF + flash * 3;
  nightFill.intensity = NIGHT.fill * nightF * (1 - .5 * cloud);
  shared.uNight.value = nightF;
  // 黄昏（太阳高度约 -6° 到 10°）：冷色天空光补在暗面上
  const duskK = smooth(clamp((el + 6) / 4)) * (1 - smooth(clamp((el - 6) / 10)));
  skyFill.intensity = 1.1 * duskK * (1 - .5 * cloud) * (1 - .35 * dread);
  bounce.intensity = .62 * sunUp * (1 - duskK) * (1 - .45 * cloud) * (1 - .35 * dread);
  // 环境光是用天空本身生成的：日落时天边的橙光会从四面八方把石头整个染红。黄昏时减弱它，暗面交给上面的冷色天空光
  scene.environmentIntensity *= 1 - .35 * duskK * (1 - cloud);   // 太阳落山后才逐渐增强，黄昏的暗面不发紫

  // ---- 树荫光斑 ----
  // 日本时间 10:00～14:00 阳光透过树叶落下来（和参考图一致）；前后各用 45 分钟渐入渐出，其余时间没有。
  // 只在有直射阳光时才有：阴天、雾天、太阳不够高、许愿时都会淡掉；夏天最全，春秋叶子少一些，冬天几乎没有
  const canopyWin = smooth(clamp((h - 9.25) / .75)) * (1 - smooth(clamp((h - 14) / .75)));
  const canopySeason = { summer: 1, spring: .8, autumn: .7, winter: .25 }[season] ?? 1;
  shared.uCanopy.value = canopyWin * canopySeason * sunUp * clamp(1 - cloud * 1.3) * (1 - fog * .7) * (1 - dread);

  // ---- 材质共享参数 ----
  shared.uTime.value = T;
  shared.uSunCol.value.copy(key.color).multiplyScalar(key.intensity * .55);
  shared.uKeyDir.value.copy(key.position).normalize();
  shared.uCaustic.value = 1 - rn * .5;
  shared.uWaterCol.value.setRGB(.005, .046, .046).multiplyScalar(.34 + .66 * dayF * (1 - .25 * cloud));   // 深处的幽暗深青色（夜里也留一点，池子不会变成黑洞）
  shared.uWaterCol.value.lerp(tmpC.setRGB(...NIGHT.water.deepCol), nightF);   // 入夜后渐渐换成蓝黑
  shared.uMoonShade.value = NIGHT.veg.dapple * nightF * (1 - .8 * cloud) * (1 - dread);   // 阴天没有直射的月光，也就没有树影
  const windNow = wind * (1 - .92 * dread);   // 风停了：草不动、水面变得像镜子一样
  shared.uSnow.value = snowCover; shared.uWet.value = wet; shared.uWind.value = windNow;
  shared.uFrost.value = frost;

  const wu = water.uniforms;
  wu.uCanopyRefl.value = dayF * canopySeason * (1 - .6 * cloud) * (1 - .5 * fog) * (1 - .5 * dread);   // 白天水面映出头顶的树冠（整个白天都有，不只是光斑时段）
  waterT += dt * lerp(1, NIGHT.water.speed, nightF);   // 水波自己的时钟：夜里走得慢一些（直接缩放时间会让波纹在过渡时乱跳）
  wu.uTime.value = waterT; wu.uWind.value = windNow; wu.uRain.value = rn; wu.uIce.value = ice;
  wu.uReflAmt.value = lerp(1, .5, cloud * dayF);   // 阴天的灰白天空倒影减半，水才不会像牛奶
  wu.uSunDir.value.copy(sunDir); wu.uSunCol.value.copy(su.uSunCol.value).multiplyScalar(sunI / 20 * (1 - cloud * .9) * (1 + 2.5 * duskK));   // 夕阳在水面上拉出一道金色亮带
  wu.uMoonDir.value.copy(MOON_REFL_DIR); wu.uMoonCol.value.setRGB(...NIGHT.water.moonCol).multiplyScalar(nightI * (1 - smooth(clamp((el + 2) / 6))));   // 水面上的月光倒影：固定在池子后方的一条银蓝色亮带（强度跟着月相走，没有月亮时用天光）

  setSRGB(scene.fog.color, hor, .2 + .8 * dayF);
  scene.fog.density = .004 + fog * .07 + rn * .012;
  renderer.toneMappingExposure = lerp(NIGHT.exposure, 1, smooth(clamp((el + 10) / 14))) + .4 * duskK;   // 太阳还在地平线上时不额外提亮：黄昏保留明暗对比，天黑后才慢慢拉高
  // 白天少加饱和度（草不再是荧光绿）；黄昏不额外加饱和度，金色才不会像涂上去的；许愿时颜色褪去一些
  grade.uniforms.saturation.value = (lerp(1.12, 1.03, sunUp * (1 - duskK)) - .14 * duskK) * (1 - .3 * dread);
  grade.uniforms.vig.value = nightF * NIGHT.vignette;
  grade.uniforms.dayWarm.value = sunUp * (1 - duskK) * (1 - cloud * .6) * (1 - dread);   // 白天的暖调（夏日午后）
  grade.uniforms.night.value = 1 - smooth(clamp((el + 9) / 8));   // 月夜调色：太阳落下后才慢慢开始，黄昏保留暖色
  wu.uNightSheen.value.setRGB(.003, .007, .014).multiplyScalar(grade.uniforms.night.value * (1 - .4 * cloud));   // 阴天不再额外提亮，否则石头发白

  // ---- 雷电 ----
  if (wx.thunder > .5 && Math.random() < dt * .08) flash = 1;
  flash *= Math.exp(-dt * 6);
  su.uFlash.value = flash * .6;

  // ---- 灯笼 / 萤火虫 / 落叶 / 粒子 ----
  // 石灯笼：太阳落到地平线附近开始点亮，天黑后全亮；阴雨天的傍晚会早一点亮
  // 池心微光：天黑后慢慢亮起（下雨时水面被打乱，稍弱一些）
  shared.uDeepGlow.value = 0;   // 池心平时不发光：保持幽深、安静（以后池底的龙出现时才有光）
  // 许愿时：等待龙的那几秒，池底深处慢慢亮起来（白天也看得到一点）
  wish.update(dt, { day: dayF });
  shared.uDeepGlow.value += wish.glow * (.05 + .05 * dayF);
  sfx.level(wish.dread);
  const deepNight = 1 - smooth(clamp((el + 10) / 8));   // 萤火虫：夏夜（晚春也有一点），天完全黑了才出来
  flies.update(T, (1 - dread) * deepNight * clamp(1 - rn * 8) * clamp(1 - wx.snow * 8) * ({ summer: 1, spring: .4 }[season] || 0) * NIGHT.fireflies);
  const light = .12 + .88 * dayF;
  rain.update(dt, rn, wind, light);
  // 冬天：不下雪的时候也有一层很稀的细雪（每个冬夜都能看见一点）；秋天：枫叶缓缓飘落（雨天少一些）
  snow.update(dt, Math.max(wx.snow, winter * .1 * (1 - clamp(rn * 5))), wind, T, light);
  fallLeaves.update(dt, (season === 'autumn' ? 1 : 0) * (1 - .7 * rn), wind, T);

  nextAmbient -= dt;
  if (nextAmbient < 0 && dread < .05) {   // 偶尔有小鱼或水滴扰动水面（许愿时一片死寂，不再有）
    nextAmbient = 3 + Math.random() * 5;
    const a = Math.random() * 6.28, r = Math.sqrt(Math.random()) * 2.8;
    ripples.add(Math.cos(a) * r, Math.sin(a) * r, .08, .08);
  }
  ripples.update(dt);

  // ---- 环境光贴图 ----
  // 环境光贴图由天空生成，一次要几十毫秒（原来每 2 秒一次，画面会周期性地顿一下）：
  // 只在天空颜色明显变化时才重新生成（最多每秒一次），否则至少每分钟刷新一次
  envAge += dt;
  const skyC = [su.uZen.value, su.uHor.value, su.uGlowCol.value];
  let changed = false;
  for (let i = 0; i < 3; i++) ['r', 'g', 'b'].forEach((ch, j) => {
    const v = skyC[i][ch], o = envKey[i * 3 + j];
    if (Math.abs(v - o) > .05 * Math.max(v, o) + .002) changed = true;
  });
  const extra = [su.uGlow.value, su.uCloud.value, su.uSunVis.value];
  for (let i = 0; i < 3; i++) if (Math.abs(extra[i] - envKey[9 + i]) > .04) changed = true;
  const fast = !realtime || speed > 1;
  if (firstFrame || (changed && envAge > (fast ? .25 : 1)) || envAge > 60) {
    updateEnv(); envAge = 0;
    for (let i = 0; i < 3; i++) { envKey[i * 3] = skyC[i].r; envKey[i * 3 + 1] = skyC[i].g; envKey[i * 3 + 2] = skyC[i].b; }
    envKey.set(extra, 9);
  }

  // ---- 镜头微动 ----
  // 跟随得慢一些（约 1 秒才跟上）、幅度小一些：像人站在池边轻轻侧头，而不是镜头在追着鼠标
  parallaxS.lerp(parallax, Math.min(1, dt * 1));
  // 镜头昼夜一致：夜里不再压低、推近
  viewDir.copy(camDir); viewTarget.copy(camTarget);
  camera.position.copy(viewDir).multiplyScalar(camDist).add(viewTarget);
  // 镜头只跟随电脑鼠标轻微移动；不再自己缓慢漂移（会让细小的草地闪烁）
  camera.position.x += parallaxS.x * .35;
  camera.position.z += parallaxS.y * .2;
  camera.lookAt(viewTarget);
  // 月光亮带：固定的月光方向只对某一个镜头位置成立。这里改成"亮带落在水面上固定的那一点（MOON_SPOT）"所需要的方向
  // （那一点到镜头的方向，对水面做镜像），不管镜头在哪（横屏、竖屏）亮带都在池面上半部；镜头远近的差别用 uMoonK 收回来
  {
    const dx = MOON_SPOT.x - camera.position.x, dz = MOON_SPOT.z - camera.position.z;
    wu.uMoonDir.value.set(dx, camera.position.y, dz).normalize();
    wu.uMoonK.value = Math.hypot(dx, camera.position.y, dz) / MOON_SPOT.dist;
  }
  if (camOverride) { camera.position.copy(camOverride.p); camera.lookAt(camOverride.t); }   // 仅开发调试用的特写镜头
}
let camOverride = null;

function render() {
  // 阴影：太阳走得很慢，每 4 帧更新一次就够；许愿仪式里有东西在动时每帧更新
  if (firstFrame || wish.mode !== 'idle' || ++shadowTick % 4 === 0) renderer.shadowMap.needsUpdate = true;
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
let perfT = 0, perfN = 0;
function adaptResolution(raw) {
  if (raw > .25) { perfT = perfN = 0; return; }   // 切到后台回来的那一帧不算
  perfT += raw; perfN++;
  if (perfT < 2) return;
  const avg = perfT / perfN; perfT = perfN = 0;
  // 低于约 36 帧就降一档分辨率；高于约 55 帧再慢慢升回来（中间留出空隙，避免来回跳）
  const next = avg > 1 / 36 ? Math.max(.6, resScale - .1) : avg < 1 / 55 ? Math.min(1, resScale + .1) : resScale;
  if (Math.abs(next - resScale) < .01) return;
  resScale = next; DPR = DPR_MAX * resScale;
  renderer.setPixelRatio(DPR); resize();
}
// ================= 场景切换 =================
// 两个场景：pool（许愿池）和 courtyard（许愿之后来到的小院，src/courtyard.js）。共用同一个渲染器和后期处理，
// 每帧只更新、只画当前这一个。切换时画面先淡成一片白，换好场景再淡回来；小院的代码第一次进去时才下载。
// 入口：许愿完成后点击右侧石狐；已有记录可直接点击。院门通回池边。
let active = 'pool', switching = false, entering = false;
let savingWish = null, freshPlaque = null;
function saveSettledWish(name) {
  rememberWish();
  savingWish = addPlaque(name || getName() || '无名').then(r => {
    if (r.ok) freshPlaque = r.rec.id; else showToast(r.text);
  }).catch(() => showToast('木牌暂未挂好，请稍后再试')).finally(() => { savingWish = null; });
}
async function enterFromFox() {
  if (entering || switching || wish.overlay) return;
  if (wish.mode === 'ritual' && wish.ritualTime < 3.2) { showToast('待木牌沉入水中，再轻触石狐'); return; }
  if (!hasWished()) { showToast('先向左侧石狐许愿，再由这里入院'); return; }
  entering = true;
  try {
    sfx.unlock();
    if (savingWish) await savingWish;
    await goTo('courtyard', { fresh: freshPlaque });
    freshPlaque = null;
  } catch (error) {
    console.warn('庭院加载失败', error); showToast('庭院暂未准备好，请稍后再试');
  } finally { entering = false; }
}
const fadeEl = document.getElementById('fade');
const wait = ms => new Promise(r => setTimeout(r, ms));
async function goTo(name, { instant = false, withIntro = true, fresh = null } = {}) {
  if (switching || name === active || (name !== 'pool' && name !== 'courtyard')) return;
  switching = true;
  try {
    if (!instant) { fadeEl.classList.add('on'); await wait(950); }
    if (name === 'courtyard') {
      wish.finish();   // 木牌还在水里下沉的话，让它就此结束
      if (!court) court = (await import('./courtyard.js')).createCourtyard({
        renderer, canvas, isMobile, onExit: () => goTo('pool'), now: nowMs, canLight: () => canLightIncense(),
        onLight: async () => {   // 点香：半个钟头一炷、一个人同时只能点一炷、炉里最多 100 炷（规则在 courtStore.js / 服务器上）
          const r = await lightIncense();
          if (r.ok) court.setIncense(listIncense()); else showToast(r.text);
          return r;
        },
      });
      await court.ready;   // 小院的贴图下载完再揭开
      await Promise.race([refreshStore(), wait(1200)]);   // 进院之前先向服务器要一次最新的牌和香（最多等 1.2 秒）
      court.setIncense(listIncense());
      court.setPlaques(listPlaques(), fresh);   // 庭院里的木牌（这台设备上挂过的）；fresh：刚挂上的那块，会有一个落下来挂好的小动画
      court.enter({ withIntro });
    } else court?.leave();
    active = name;
    renderPass.scene = name === 'courtyard' ? court.scene : scene;
    renderPass.camera = name === 'courtyard' ? court.camera : camera;
    canvas.style.cursor = '';
    resize();
    if (!instant) await wait(350);   // 先在白幕后面画几帧（着色器编译、阴影），再揭开
  } finally { fadeEl.classList.remove('on'); switching = false; }
}
// 小院：固定的白天，不跟随真实时间和天气——曝光和调色都是定值
function renderCourt() {
  renderer.toneMappingExposure = court.exposure;
  for (const b of blurs) b.enabled = false;
  const g = grade.uniforms;
  g.saturation.value = 1.02; g.vig.value = .12; g.dayWarm.value = .4; g.night.value = 0;
  court.preRender(renderer);
  composer.render();
}
function frame(dt) {
  if (active === 'courtyard') { court.update(dt); renderCourt(); }
  else {
    update(dt); render();
  }
}

function loop(now) {
  const raw = (now - last) / 1000, dt = Math.min(.05, raw); last = now;
  adaptResolution(raw);
  frame(dt);
  firstFrame = false;
  if (assetsReady && !revealed && ++readyFrames > 3) { revealed = true; document.getElementById('loading').classList.add('done'); }
  requestAnimationFrame(loop);
}

// ================= 交互 =================
const raycaster = new THREE.Raycaster(), ndc = new THREE.Vector2();
// 长按不弹系统菜单（安卓浏览器的长按菜单、电脑上的右键菜单）
addEventListener('contextmenu', e => { if (e.target === canvas) e.preventDefault(); });
const setRay = e => { ndc.set(e.clientX / innerWidth * 2 - 1, -(e.clientY / innerHeight) * 2 + 1); raycaster.setFromCamera(ndc, camera); };
canvas.addEventListener('pointerdown', e => {
  if (active !== 'pool' || switching) return;   // 在小院里：点击、拖动由 courtyard.js 自己处理
  setRay(e);
  // 许愿签还在等输入时点它：重新弹出输入框
  if (wish.waiting && (wish.inputReady || wish.nameReady) && wish.hitPaper(raycaster)) { wish.nameReady ? openNameInput() : openWishInput(); wishInput.focus(); return; }
  // 左侧石狐送来许愿木牌，右侧石狐在首次许愿后引路入院。
  const f = foxes.pick(raycaster);
  if (f) {
    const left = f.point.clone().project(camera).x < 0;
    if (left && WISH_ENABLED && !wish.busy) {
      const c = canWish();
      if (!c.ok) { showToast(c.text); return; }   // 半小时内挂过一块，或者今天已经挂满三块：石狐不响应，只说一句话
      sfx.unlock(); wish.summon(camera); return;   // 声音只能在用户点击时开启
    }
    if (!left) { void enterFromFox(); return; }
  }
  const hit = raycaster.intersectObject(water.mesh)[0];
  if (hit && poolK(hit.point.x, hit.point.z) < .93) {
    ripples.add(hit.point.x, hit.point.z, .22, .5);
  }
});
canvas.addEventListener('pointermove', e => {
  if (active !== 'pool') return;
  setRay(e);
  // 鼠标移到能点的石狐上时，换成手形光标
  if (e.pointerType === 'mouse') {
    const over = (f => f && (f.point.clone().project(camera).x < 0 ? WISH_ENABLED && !wish.busy : !wish.overlay && hasWished()))(foxes.pick(raycaster)) ? 'pointer' : '';
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
  let w;
  if (wxMode !== 'live') w = PRESET_NAME[wxMode] + '（调试）';
  else if (live) w = `${WX_NAME[live.weather_code] ?? '—'} ${Math.round(live.temperature_2m)}°C`;
  else w = '感知天气…';
  $('dbgPlace').textContent = `${loc.name || '未知'} · ${w}`;
  const h = jstHour(simMs);
  if (!dragging) $('hour').value = h;
  $('hourTxt').textContent = `${pad(Math.floor(h))}:${pad(Math.round((h % 1) * 60) % 60)}（日本）`;
}

// ---- 许愿 ----
// 页面上没有任何提示：点左边的石狐 → 风送来一张许愿签，同时出现一条输入线 → 写完按回车，字一笔一笔写到签上
// → 签自己落进池里（点右边的石狐才会唤来龙）（之后的仪式在 wish.js）。龙要来的位置：池心稍微靠近镜头一侧
const wishLand = () => { const d = new THREE.Vector3(camera.position.x, 0, camera.position.z).normalize().multiplyScalar(.7); return { x: d.x, z: d.z, facing: Math.atan2(d.x, d.z) }; };
function throwWish(text) {   // 调试用：跳过写字和拖动，直接从落点上方投下去
  if (wish.busy || !text.trim()) return;
  const w = wishLand();
  wish.start(text, w, { facing: w.facing, callNow: true, name: getName() || '宁' });
}
const wishInput = $('wishInput'), wishPanel = $('wishPanel'), wishOk = $('wishOk'), wishHint = $('wishHint'), toast = $('toast');
let inputKind = 'wish';   // 输入框现在写的是什么：'wish'（愿望）或 'name'（名字）
// 签停稳、四周虚化之后才出现输入框（电脑上自动把光标放进去；手机上点一下输入框才会弹出键盘）
function openInput(kind) {
  if (!wishPanel.hidden) return;
  inputKind = kind; wishInput.value = ''; wishOk.disabled = true;
  wishInput.maxLength = kind === 'name' ? NAME_MAX : 30;
  wishInput.placeholder = kind === 'name' ? '名字' : '';
  wishHint.hidden = kind !== 'name';   // 名字写下后不能再改：第一次写名字时提醒一句
  wishPanel.hidden = false; if (matchMedia('(pointer: fine)').matches) wishInput.focus();
}
const openWishInput = () => openInput('wish'), openNameInput = () => openInput('name');
function closeWishInput() { wishInput.blur(); wishPanel.hidden = true; wishHint.hidden = true; }
// 确认：愿望 → 字写到木牌上，木牌翻过来；名字 → 字写到木牌上，停一下，木牌自己落进水里（落点：池心靠镜头一侧）
const submitWish = () => {
  const v = wishInput.value.trim(); if (!v) return;
  if (inputKind === 'name') { const n = setName(v); wish.writeName(n); closeWishInput(); return; }
  const w = wishLand(); wish.write(v, w, { facing: w.facing, name: getName() }); closeWishInput();
};
wishInput.addEventListener('input', () => { wishOk.disabled = !wishInput.value.trim(); });
wishInput.addEventListener('keydown', e => {
  if (e.isComposing || e.keyCode === 229) return;   // 输入法正在拼字时的回车不算
  if (e.key === 'Enter') submitWish();
  else if (e.key === 'Escape') { wish.dismiss(); closeWishInput(); }
});
wishOk.onclick = submitWish;
setInterval(() => { if (wish.inputReady) openWishInput(); else if (wish.nameReady) openNameInput(); }, 100);
// 屏幕下方的一句话（发牌限制的提示）
let toastTimer = 0;
function showToast(text) { toast.textContent = text; toast.classList.add('on'); clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.classList.remove('on'), 2600); }


// 调试面板：网址带 ?debug 才显示
if (new URLSearchParams(location.search).has('debug')) $('gear').hidden = false;
$('gear').onclick = () => { $('panel').hidden = !$('panel').hidden; };
$('hour').addEventListener('pointerdown', () => dragging = true);
addEventListener('pointerup', () => dragging = false);
$('hour').oninput = e => {
  simMs = atJstHour(simMs, +e.target.value); realtime = false; updateInfo();
};
$('speed').onchange = e => { speed = +e.target.value; if (speed > 1) realtime = false; };
$('wx').onchange = e => { wxMode = e.target.value; applyWeather(false); };
$('reset').onclick = () => {
  realtime = true; speed = 1; $('speed').value = '1';
  wxMode = 'live'; $('wx').value = 'live'; applyWeather(false);
};
setInterval(updateInfo, 1000);
// 数据：连上服务器（配置了 VITE_SUPABASE_URL 的话）；在院子里时每 15 秒看一次有没有别人挂牌、点香，有变化就更新
initStore().then(mode => console.info('庭院数据：', mode === 'remote' ? '服务器' : '本机'));
onStoreChange(() => { if (active === 'courtyard' && court) { court.setIncense(listIncense()); court.setPlaques(listPlaques(), null); } });
setInterval(() => { if (active === 'courtyard') refreshStore(); }, 15000);

// 调试用（只在开发模式下暴露）
if (import.meta.env.DEV) window.__wish = {
  setTime(h) { simMs = atJstHour(simMs, h); realtime = false; },   // h：日本时间
  setSimMs(ms) { simMs = ms; realtime = false; },
  setWeather(m) { wxMode = m; applyWeather(true); },
  setSeason(s) { seasonForce = s; },
  wish: throwWish, get wishState() { return wish; },
  get loc() { return loc; }, sunPos, moonPos, moonPhase,
  renderer, scene, camera, composer, water, sky, key, refrRT, reflRT, pool, NIGHT, applyNight,
  step(n = 1, dt = 1 / 60) { for (let i = 0; i < n; i++) frame(dt); },
  goto: goTo, get active() { return active; }, get court() { return court; },   // 切换场景：__wish.goto('courtyard') / __wish.goto('pool')
  closeup(p, t) { camOverride = p ? { p: new THREE.Vector3(...p), t: new THREE.Vector3(...t) } : null; },
  async shot(name) {   // 开发用：渲染一帧并保存到 .shots/
    frame(1 / 60);
    const blob = await new Promise(r => renderer.domElement.toBlob(r, 'image/jpeg', .85));
    await fetch(`/__shot?name=${name}`, { method: 'POST', body: blob });
    return name;
  },
};

updateInfo();
requestAnimationFrame(loop);
init();
if (import.meta.env.DEV && new URLSearchParams(location.search).get('scene') === 'courtyard') goTo('courtyard', { instant: true });
