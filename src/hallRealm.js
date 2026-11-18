// 殿里的"洞天"：一跨进殿门，就不再是清晨的小院，而是月下的云海——后墙敞开，一轮金色的满月低低地挂在云海上，
// 猫像端坐在月亮前面；水池映着月亮和云，地上贴着一层薄雾，池面上有几点暖光（别人挂过的愿）缓缓升向月亮。
// 殿本身（墙、柱、猫像、水池……）是同一座：courtyard.js 把殿的那一组物体从小院的场景挪到这里来画。
// 这里只放殿外的东西：天空、月亮、云海、雾、光点、灯光。
//   远处的云：一圈贴着 cloud_sea_night 照片的圆筒（textures-src/quality/cloud_sea_night.png），朝着月亮的那一面才有金边；
//   往下看（照片的下沿以下）：一片暗的云底，用噪声图（cloud_noise.webp）给一点浓淡。
import * as THREE from 'three';
import { REFLECT_LAYER } from './courtyardHall.js';
import { createMist, createShafts } from './courtyardFx.js';
import { heightFog } from './heightFog.js';
import { createRealmClouds } from './realmClouds.js';

const T = `${import.meta.env.BASE_URL}textures/q/`;
const COL = {
  zenith: new THREE.Color(0x061420), horizon: new THREE.Color(0x24414b),
  deep: new THREE.Color(0x0c1c24), mid: new THREE.Color(0x2b4652), lit: new THREE.Color(1.15, .78, .38), haze: new THREE.Color(0x2c4851),
};

// eye：站在殿门里的眼睛位置；head：猫头的位置——月亮放在这两点连线的延长线上，从门口看，月亮正好在猫头后面
// 月亮不再正挡在猫头后面，而是在猫像右后方（从门口看偏右约 30°），低低地压在云海上，下沿被云吃掉一截——和效果图一样，
// 投影取月盘上半部，与月盘同方位，低角度的光仍能掠过池沿。
const MOON_AZ = 31, MOON_EL = 3.5, LIGHT_EL = 8;

// 用雾片自身的 UV 羽化四边，贴图图集的裁切和 mipmap 都不会留下矩形轮廓。
function softenMistEdges(shader) {
  shader.vertexShader = 'varying vec2 vMistUv;\n' + shader.vertexShader.replace(
    '#include <uv_vertex>', '#include <uv_vertex>\nvMistUv = uv;'
  );
  shader.fragmentShader = 'varying vec2 vMistUv;\n' + shader.fragmentShader.replace(
    '#include <map_fragment>', `#include <map_fragment>
      vec2 edge = min(vMistUv, 1. - vMistUv);
      vec2 fade = smoothstep(vec2(0.), vec2(.24, .32), edge);
      diffuseColor.a *= fade.x * fade.y;`
  );
}

export function createRealm({ renderer, manager, low = false, eye, head, pool, puffs, center, shaftBeams = [], shaftNoise = null }) {
  const scene = new THREE.Scene();
  scene.fog = heightFog(new THREE.Color(0x0c1c24), 0, 0);   // 和小院同一种雾（着色器一样，切换时不用重新编译），浓度为 0
  const loader = new THREE.TextureLoader(manager);
  const fwd = new THREE.Vector2(head.x - eye.x, head.z - eye.z).normalize();   // 从门口看猫的水平方向
  const dirAt = (az, el) => {
    const a = THREE.MathUtils.degToRad(az), e = THREE.MathUtils.degToRad(el);
    const hx = fwd.x * Math.cos(a) - fwd.y * Math.sin(a), hz = fwd.x * Math.sin(a) + fwd.y * Math.cos(a);   // 往右转 az 度（看向 -z 时右边是 +x）
    return new THREE.Vector3(hx * Math.cos(e), Math.sin(e), hz * Math.cos(e)).normalize();
  };
  const moonDir = dirAt(MOON_AZ, MOON_EL), lightDir = dirAt(MOON_AZ, LIGHT_EL);
  const MOON_D = 118, moonPos = eye.clone().addScaledVector(moonDir, MOON_D);
  const moonFlat = new THREE.Vector2(moonDir.x, moonDir.z).normalize();
  const uTime = { value: 0 };
  const reflect = o => { o.layers.enable(REFLECT_LAYER); return o; };

  // ---------- 天空：深青色，越往上越暗；月亮那一边的地平线上有一道暖光；稀疏的几颗星 ----------
  const sky = reflect(new THREE.Mesh(new THREE.SphereGeometry(140, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { uZen: { value: COL.zenith }, uHor: { value: COL.horizon }, uMoon: { value: moonDir } },
    vertexShader: /* glsl */`varying vec3 vD; void main(){ vD = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
    fragmentShader: /* glsl */`
      uniform vec3 uZen, uHor, uMoon; varying vec3 vD;
      float hash(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
      void main(){
        vec3 d = normalize(vD);
        float up = clamp(d.y, 0., 1.);
        vec3 c = mix(uHor, uZen, pow(up, .55));
        c = mix(c, vec3(.02, .045, .06), smoothstep(0., .45, -d.y));                          // 地平线以下（往下看）是深色的云底，不是天空的青色
        float m = max(dot(d, uMoon), 0.);
        c += vec3(.55, .38, .2) * (pow(m, 40.) * .22 + pow(m, 260.) * .5);                   // 月亮周围的一圈暖光：收紧，天空其余部分保持深青，不再整片发黄
        float az = pow(max(dot(normalize(d.xz), normalize(uMoon.xz)), 0.), 3.);
        c += vec3(.5, .33, .14) * exp(-abs(d.y - .01) * 30.) * az * .55;                     // 月亮那边地平线上的金线
        // 星星：天空切成小格，少数格子里一颗；离月亮近、离地平线近的不画
        vec2 sc = vec2(atan(d.z, d.x), asin(d.y)) * 160.;
        vec2 cell = floor(sc); float h = hash(cell);
        float star = step(.996, h) * smoothstep(.12, .35, d.y) * (1. - smoothstep(.75, .95, m));
        float sd = length(fract(sc) - .5 - (hash(cell + 7.) - .5) * .5);
        c += vec3(.8, .85, 1.) * star * smoothstep(.12, 0., sd) * (.35 + .65 * hash(cell + 3.));
        gl_FragColor = vec4(c, 1.);
      }`,
  })));
  sky.position.copy(center); sky.renderOrder = -20; scene.add(sky);

  // ---------- 月亮：照片（透明底）+ 外面一圈柔光 ----------
  const moonMap = loader.load(T + 'moon_gold.webp'); moonMap.colorSpace = THREE.SRGBColorSpace;
  const moonSize = 2 * MOON_D * Math.tan(THREE.MathUtils.degToRad(9.4));   // 贴图约 19° 宽，圆盘约 16°（圆盘占贴图的 85%）
  const moon = reflect(new THREE.Mesh(new THREE.PlaneGeometry(moonSize, moonSize), new THREE.MeshBasicMaterial({
    map: moonMap, color: new THREE.Color(2.3, 2.05, 1.7), transparent: true, depthWrite: false, fog: false,
  })));
  moon.position.copy(moonPos); moon.lookAt(eye); moon.renderOrder = -18; scene.add(moon);
  const glowTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d');
    const gr = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    gr.addColorStop(0, 'rgba(255,214,150,1)'); gr.addColorStop(.25, 'rgba(255,190,110,.45)'); gr.addColorStop(.6, 'rgba(255,170,90,.1)'); gr.addColorStop(1, 'rgba(255,160,80,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 256, 256); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  // 两层光晕：里面一圈紧而亮（贴着月亮边），外面一圈大而淡（月亮周围的天被照亮一大片）
  for (const [s, o] of [[1.45, .5], [4.2, .16]]) {
    const halo = reflect(new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xffd9a0, transparent: true, opacity: o, depthWrite: false, blending: THREE.AdditiveBlending, fog: false })));
    halo.position.copy(moonPos).addScaledVector(moonDir, 2); halo.scale.setScalar(moonSize * s); halo.renderOrder = -19; scene.add(halo);
  }

  // ---------- 云海：一圈圆筒，贴照片（cloud_sea_night）。照片管从地平线往下十几度的那一段；再往下（站在殿后往下看）
  // 照片没有了，接一片暗的云底：用噪声图（cloud_noise）给一点浓淡，和照片的下沿慢慢融在一起。
  // 照片上半截是天空，淡掉，露出后面的天；朝着月亮的那一面保留金边，背着月亮的一面压成冷的青灰。照片极慢地横着漂。
  // （试过用几层水平的程序云平面做近处的云，看上去像一片泛白的冰面或海面，不如照片真实，所以只用照片。）
  const strip = loader.load(T + 'cloud_sea_night.webp'); strip.colorSpace = THREE.SRGBColorSpace;
  strip.wrapS = THREE.MirroredRepeatWrapping;
  const noise = loader.load(T + 'cloud_noise.webp'); noise.wrapS = noise.wrapT = THREE.RepeatWrapping;
  const R = 128, yLo = -56, yHi = 12, PHOTO = [-30, 12];   // 圆筒最远的一点（下沿）离眼睛 √(128²+56²)≈140 米，要在镜头的远平面（150）里面，不然往下看会被裁成一个圆   // 圆筒的上下沿；照片铺在 y -30～12 这一段（42 米高、一圈铺 5 张，横竖比例和照片差不多）
  const far = reflect(new THREE.Mesh(new THREE.CylinderGeometry(R, R, yHi - yLo, 128, 1, true), new THREE.ShaderMaterial({
    side: THREE.BackSide, transparent: true, depthWrite: false, fog: false,
    uniforms: { tMap: { value: strip }, tN: { value: noise }, uMoon: { value: moonFlat }, uHaze: { value: COL.haze }, uDeep: { value: COL.deep }, uTime,
      uY: { value: new THREE.Vector4(yLo, yHi, ...PHOTO) } },
    vertexShader: /* glsl */`varying vec2 vUv; varying vec2 vXZ; void main(){ vUv = uv; vXZ = normalize(position.xz); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
    fragmentShader: /* glsl */`
      uniform sampler2D tMap, tN; uniform vec2 uMoon; uniform vec3 uHaze, uDeep; uniform float uTime; uniform vec4 uY; varying vec2 vUv; varying vec2 vXZ;
      void main(){
        float y = mix(uY.x, uY.y, vUv.y), v = (y - uY.z) / (uY.w - uY.z);
        float u = vUv.x * 6. + uTime * .0035;   // 偶数张：镜像平铺绕一圈才首尾相接
        vec3 c = texture2D(tMap, vec2(u, max(v, .002))).rgb;
        float toward = pow(max(dot(vXZ, uMoon), 0.), 2.);
        float l = dot(c, vec3(.2126, .7152, .0722));
        c = mix(vec3(l) * vec3(.62, .9, 1.05) * .85, c * 1.15, toward);   // 背着月亮：冷的青灰
        // 照片下沿再往下：暗的云底，有一点浓淡，慢慢融进照片
        float n = texture2D(tN, vec2(u, y * .012) + vec2(uTime * .0005, 0.)).r;
        vec3 under = uDeep * (.55 + .9 * n) * mix(.3, 1., smoothstep(-56., -30., y));
        float bank = v + (n - .5) * .12;
        c = mix(under, c, smoothstep(-.16, .14, bank));
        c = mix(c, uHaze, .22);
        c *= mix(.5, .85, toward);                   // 夜里的云海是暗的青灰，只有朝月亮的那面亮一些（照片本身偏亮，像傍晚）
        float a = 1. - smoothstep(.53, .85, bank);
        gl_FragColor = vec4(c, a);
      }`,
  })));
  far.position.set(center.x, (yLo + yHi) / 2, center.z); far.renderOrder = -17; scene.add(far);
  // 圆筒底下的盖子：站在殿里往正下方看（视线穿过圆筒的下沿）时，看到的是深色的云底，不是空的
  const floorDisc = reflect(new THREE.Mesh(new THREE.CircleGeometry(R + 4, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: new THREE.Color(.006, .014, .02), fog: false })));
  floorDisc.position.set(center.x, yLo + .5, center.z); floorDisc.renderOrder = -19.5; scene.add(floorDisc);   // 要在天空之后画，不然天空（半径只有 140）把它盖住

  // ---------- 一团团立体的厚云（realmClouds.js）：浮在照片前面，近大远小，人走动时有视差 ----------
  const clouds = createRealmClouds({ manager, low, center, eye, moonDir, haze: COL.haze, deep: COL.deep, layer: REFLECT_LAYER });
  scene.add(clouds.group);

  // ---------- 云海上的雾带：一团团半透明的雾（雾团图集）浮在照片的云顶上，离得近的大、远的小，极慢地横着漂，浓淡一呼一吸——
  // 照片本身是不动的，这一层让云海有厚度、有远近，看上去在流动。朝着月亮的那几团边上带一点暖金色，背着月亮的偏冷青
  const bankList = [];
  {
    const N = low ? 9 : 18, cells = puffs.cells, eyeY = eye.y;
    let k = 3; const r = () => (k = (k * 16807) % 2147483647) / 2147483647;
    const cold = new THREE.Color(0x40606c), warm = new THREE.Color(0xc9a06a);
    for (let i = 0; i < N; i++) {
      // 方位：一半集中在月亮那一边（后墙敞开的方向），一半撒在四周（侧窗看得见）
      const base = Math.atan2(moonFlat.y, moonFlat.x), a = i % 2 ? base + (r() - .5) * 2.2 : r() * Math.PI * 2;
      const d = 24 + Math.pow(r(), .8) * 72;                                 // 离殿 24～96 米
      const y = eyeY - d * (.035 + r() * .05) - 1.5;                         // 比眼睛低 2°～5°：正好压在照片里云顶那一线上
      const w = 16 + d * .42 * (.8 + r() * .5), h = w * (.22 + r() * .1);
      const c = cells[Math.floor(r() * cells.length)], m = puffs.map.clone();
      m.offset.set(c[0], c[1]); m.repeat.set(c[2] - c[0], c[3] - c[1]); m.needsUpdate = true;
      const toward = Math.pow(Math.max(Math.cos(a - base), 0), 2);
      const col = cold.clone().lerp(warm, toward * .55);
      const o = .36 + r() * .24 - d * .0012;
      const sp = reflect(new THREE.Sprite(new THREE.SpriteMaterial({ map: m, color: col, opacity: o, transparent: true, depthWrite: false, fog: false })));
      sp.material.onBeforeCompile = softenMistEdges;
      sp.renderOrder = -15; scene.add(sp);
      bankList.push({ sp, a, d, y, w, h, o, speed: (r() < .8 ? 1 : -1) * (.3 + r() * .4), ph: r() * 20 });
    }
  }
  const placeBanks = t => {
    for (const b of bankList) {
      const a = b.a + t * b.speed / b.d;                                     // 每秒横着挪零点几米
      const breathe = Math.sin(t * .06 + b.ph);
      b.sp.position.set(center.x + Math.cos(a) * b.d, b.y + breathe * .4, center.z + Math.sin(a) * b.d);
      b.sp.scale.set(b.w * (1 + .07 * breathe), b.h * (1 + .1 * Math.sin(t * .05 + b.ph * 1.7)), 1);
      b.sp.material.opacity = b.o * (.7 + .3 * Math.sin(t * .045 + b.ph * 2.3));
    }
  };
  placeBanks(0);

  // ---------- 殿里地上的一层薄雾、殿后石台边涌上来的云气 ----------
  const fy = pool.waterY + .3;
  const mist = createMist(new THREE.Color(0x7d98a2), [
    [-4.4, fy, -9.2, 3.6, .7, .2], [4.4, fy, -10.4, 3.6, .7, .2], [-2.2, fy, -12.3, 3.2, .6, .16], [2.6, fy, -12.6, 3.4, .6, .16],
    [0, fy - .1, -7.6, 3, .5, .12],
    [-3.5, pool.waterY - .2, -16.2, 9, 2.2, .35], [4, pool.waterY - .4, -16.8, 10, 2.4, .35], [0, pool.waterY - .8, -18, 14, 3, .4],
  ], puffs);
  mist.group.children.forEach(sprite => {
    sprite.material.onBeforeCompile = softenMistEdges;
    sprite.layers.enable(REFLECT_LAYER);
  });
  scene.add(mist.group);

  // ---------- 池面上缓缓升起的暖光点：别人挂在树上的愿。数量跟着木牌的多少走，始终稀疏 ----------
  const MAXW = 48, wp = new Float32Array(MAXW * 3), ws = new Float32Array(MAXW * 2);
  let s = 7; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < MAXW; i++) {
    wp.set([(rnd() * 2 - 1) * (pool.halfX - .4), pool.waterY + .02, pool.back + .3 + rnd() * (pool.front - pool.back - .6)], i * 3);
    ws.set([rnd(), i], i * 2);
  }
  const wg = new THREE.BufferGeometry();
  wg.setAttribute('position', new THREE.BufferAttribute(wp, 3)); wg.setAttribute('aSeed', new THREE.BufferAttribute(ws, 2));
  const wishU = { uTime, uCount: { value: 8 }, uPx: { value: 600 }, uMoon: { value: moonDir } };
  const wishes = new THREE.Points(wg, new THREE.ShaderMaterial({
    uniforms: wishU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    vertexShader: /* glsl */`
      attribute vec2 aSeed; uniform float uTime, uCount, uPx; uniform vec3 uMoon; varying float vA;
      void main(){
        float life = 16. + aSeed.x * 10., t = fract(uTime / life + aSeed.x * 7.13);
        // 从水面升起，先直直往上，再慢慢偏向月亮；路上轻轻晃
        vec3 p = position + vec3(0., t * 7.5, 0.) + uMoon * t * t * 9.
               + vec3(sin(uTime * .4 + aSeed.x * 40.) * .25 * t, 0., cos(uTime * .33 + aSeed.x * 23.) * .2 * t);
        vA = smoothstep(0., .08, t) * (1. - smoothstep(.6, 1., t)) * step(aSeed.y, uCount - .5) * (.6 + .4 * sin(uTime * 2.3 + aSeed.x * 60.));
        vec4 mv = viewMatrix * vec4(p, 1.);
        gl_PointSize = max(.075 * uPx / max(-mv.z, .1), 2.5);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      varying float vA;
      void main(){
        vec2 c = gl_PointCoord - .5; float r = dot(c, c);
        float a = exp(-r * 18.) + exp(-r * 70.) * .8;
        gl_FragColor = vec4(vec3(1., .78, .45) * a * vA * 2.4, 1.);
      }`,
  }));
  wishes.frustumCulled = false; wishes.renderOrder = 7; scene.add(wishes);

  // ---------- 光：月光从猫像背后低低地照过来（勾出轮廓），天光是暗的青色，前面再补一点冷光 ----------
  // 灯的数量、种类和小院一样（两盏平行光、其中一盏投影，一盏天光）：殿里的材质换场景时不用重新编译
  const hemi = new THREE.HemisphereLight(0x3d6275, 0x0b1215, .55);
  const moonLight = new THREE.DirectionalLight(0xffcf8c, 2.6);
  moonLight.target.position.set(center.x, pool.waterY, center.z);
  moonLight.position.copy(moonLight.target.position).addScaledVector(lightDir, 115);
  moonLight.castShadow = true; moonLight.shadow.mapSize.setScalar(low ? 1024 : 2048);   // 柱影要清楚：比原来细一档
  Object.assign(moonLight.shadow.camera, { left: -9, right: 9, top: 9, bottom: -9, near: 95, far: 135 });
  moonLight.shadow.bias = -.0005; moonLight.shadow.normalBias = .03;
  const fill = new THREE.DirectionalLight(0x86a8bf, .45); fill.position.set(center.x, 12, center.z + 20);
  scene.add(hemi, moonLight, moonLight.target, fill);
  for (const l of [hemi, moonLight, fill]) l.layers.enable(REFLECT_LAYER);

  // 月光穿过殿后敞开的柱间，斜斜地落在地上：几道淡金的光柱（和小院的晨光是同一种做法，courtyardFx.js）
  const shafts = shaftBeams.length ? createShafts(shaftBeams.map(([x, z, w, len, o = {}]) => [x, z, w, len, { ...o, dir: lightDir }]), lightDir, shaftNoise) : null;
  if (shafts) { shafts.uniforms.uCol.value.setRGB(1, .8, .5).multiplyScalar(.09); scene.add(shafts.mesh); }

  // 殿门外：回头看，门洞是敞开的——门外是台阶和夜里的云海（整座殿浮在云上），不再放一块发亮的方框

  // 环境光贴图：先用这里的天空生成一张（贴图还没下载完时用）；第一次进洞天时（captureEnv）再把整个洞天——月亮、光晕、云海、
  // 厚云——在殿中间拍一圈，换成真正的环境贴图：青铜猫像、湿石板上反出来的就是那轮金月和月下的云
  const pm = new THREE.PMREMGenerator(renderer);
  {
    const env = new THREE.Scene(); env.add(new THREE.Mesh(sky.geometry, sky.material));
    scene.environment = pm.fromScene(env, .02, .1, 200).texture; scene.environmentIntensity = .7;
  }
  let envRT = null;
  const captureEnv = () => {
    if (envRT) return;
    const vis = [];
    scene.traverse(o => { if (o.isPoints || o === mist.group || o === shafts?.mesh) { vis.push([o, o.visible]); o.visible = false; } });   // 飘着的光点、殿里的薄雾、光柱不拍进去
    const prev = scene.environment;
    envRT = pm.fromScene(scene, .015, .5, 145, { size: 256, position: new THREE.Vector3(center.x, eye.y, center.z) });
    scene.environment = envRT.texture; scene.environmentIntensity = .85; prev?.dispose();
    for (const [o, v] of vis) o.visible = v;
  };

  return {
    scene, moonDir, moonLight, captureEnv,
    setWishCount(n) { wishU.uCount.value = Math.max(6, Math.min(MAXW, n)); },
    update(t, camera, renderer) {
      uTime.value = t; mist.update(t); placeBanks(t); clouds.update(t);
      if (shafts) shafts.uniforms.uTime.value = t;
      const h = renderer.getDrawingBufferSize(_v2).y;
      wishU.uPx.value = h / (2 * Math.tan(camera.fov * Math.PI / 360));
    },
  };
}
const _v2 = new THREE.Vector2();
