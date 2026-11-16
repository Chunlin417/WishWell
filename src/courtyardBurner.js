// 院子里的青铜香炉（三足圆鼎）：全部用代码生成，不用外部模型。
//   - 炉身：一条平滑的轮廓线转出来（腹部圆鼓、颈部收窄、口沿外翻），内壁一直做到炉灰下面；
//   - 浮雕：腹部一圈雷纹带，前后各一个饕餮兽面，上下两道弦纹，下腹一圈垂叶纹——画在一张灰度图上当凹凸贴图，不加面数；
//   - 铜锈：同一张浮雕图告诉着色器哪里凹、哪里凸：凹处积着铜绿和一点浅色的锈壳，凸起处和口沿被摸得露出铜色；
//     再叠上按世界坐标的斑驳和往下淌的锈痕；
//   - 方折的立耳、上粗下细的蹄足（膝部一块兽面隆起）；前后兽面嘴里各衔一只铜环；
//   - 炉灰：微微隆起，灰里有颗粒和烧黑的碎屑；香多的时候灰里透出暗红的火，炉口上方有一团很淡的暖光，刚点着一炷香时会亮一下。
// 所有尺寸按"原始大小"（炉口约 1.2 米高）搭，由外面的组整体缩放
import * as THREE from 'three';
import { NOISE_GLSL } from './shaders.js';

const Y0 = .58;   // 鼎腹底部离地的高度（足的长度）

// 炉身的轮廓（半径, 高度），从底部中心到口沿、再沿内壁往下。下半段（腹）用样条平滑，口沿保留棱角
const BODY = [[0, 0], [.16, .003], [.3, .025], [.42, .075], [.51, .15], [.565, .24], [.578, .32], [.565, .4], [.53, .47], [.497, .525], [.487, .555]];
const LIP = [[.495, .572], [.55, .594], [.592, .612], [.6, .622], [.6, .644], [.588, .652], [.545, .652], [.53, .643], [.51, .62], [.497, .59], [.49, .55]];
const ASH_Y = .594;   // 炉灰表面（香插在这里）

function bodyProfile() {
  const body = new THREE.SplineCurve(BODY.map(([r, y]) => new THREE.Vector2(r, y))).getSpacedPoints(52);
  return [...body, ...LIP.map(([r, y]) => new THREE.Vector2(r, y))];
}

// 浮雕图（灰度：128 = 平，越亮越凸，越暗越凹）。横向是绕炉身一圈（u），纵向对应轮廓线上的位置（v）
function reliefTexture(profile) {
  const W = 2048, H = 512, c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#808080'; g.fillRect(0, 0, W, H);
  // 轮廓线上高度 y 对应的 v（腹部那一段 y 单调增加），再换成画布上的行（贴图的 v = 0 在画布底部）
  const n = profile.length - 1, row = y => {
    for (let j = 1; j <= 52; j++) if (profile[j].y >= y) { const a = profile[j - 1], b = profile[j]; return (1 - (j - 1 + (y - a.y) / (b.y - a.y)) / n) * H; }
    return 0;
  };
  const bandTop = row(.405), bandBot = row(.235), bandH = bandBot - bandTop, mid = (bandTop + bandBot) / 2;
  const RAISED = '#cfcfcf', SUNK = '#4e4e4e';
  // 上下两道弦纹（凸起的细棱）
  g.strokeStyle = RAISED; g.lineCap = 'round';
  for (const y of [row(.422), row(.218)]) { g.lineWidth = 9; g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
  // 纹带底子略凹
  g.fillStyle = '#6c6c6c'; g.fillRect(0, bandTop, W, bandH);
  // 兽面所在的位置：正面（u = 0，跨在接缝上）和背面（u = 0.5）
  const maskHalf = W * .085, inMask = x => Math.min(Math.abs(x), Math.abs(x - W / 2), Math.abs(x - W)) < maskHalf;
  // 回纹：一格一个方形的回旋（两圈），格与格的底边连成一线
  const cellW = bandH * .95, count = Math.round(W / cellW), cw = W / count, top = bandTop + bandH * .14, ht = bandH * .72;
  g.lineWidth = bandH * .075; g.lineJoin = 'miter'; g.lineCap = 'butt'; g.strokeStyle = RAISED;
  const KEY = [[0, 1], [0, 0], [.82, 0], [.82, .78], [.2, .78], [.2, .26], [.6, .26], [.6, .55]];
  for (let i = 0; i < count; i++) {
    const x0 = i * cw + cw * .08; if (inMask(x0 + cw * .4)) continue;
    g.beginPath(); KEY.forEach(([u, v], k) => g[k ? 'lineTo' : 'moveTo'](x0 + u * cw * .84, top + v * ht)); g.stroke();
    if (!inMask(x0 + cw)) { g.beginPath(); g.moveTo(x0, top + ht); g.lineTo(x0 + cw, top + ht); g.stroke(); }
  }
  // 饕餮兽面：中间一道鼻梁，两只凸起的大眼（眼珠凹下），眼上是外卷的眉，最外侧是卷角
  const taotie = cx => {
    const s = bandH * .74;
    g.fillStyle = RAISED;
    g.beginPath(); g.roundRect(cx - s * .1, mid - s * .95, s * .2, s * 1.9, s * .08); g.fill();             // 鼻梁
    for (const sd of [-1, 1]) {
      const ex = cx + sd * s * .55;
      g.beginPath(); g.ellipse(ex, mid + s * .05, s * .3, s * .24, 0, 0, Math.PI * 2); g.fill();            // 眼
      g.fillStyle = SUNK; g.beginPath(); g.ellipse(ex, mid + s * .05, s * .12, s * .13, 0, 0, Math.PI * 2); g.fill(); g.fillStyle = RAISED;
      g.strokeStyle = RAISED; g.lineWidth = s * .16; g.lineCap = 'round';
      g.beginPath(); g.moveTo(cx + sd * s * .18, mid - s * .45); g.quadraticCurveTo(ex, mid - s * .85, cx + sd * s * 1.05, mid - s * .55); g.stroke();   // 眉
      g.beginPath(); g.arc(cx + sd * s * 1.25, mid - s * .2, s * .32, sd > 0 ? Math.PI * 1.1 : -Math.PI * .1, sd > 0 ? Math.PI * 2.6 : Math.PI * 1.4, sd < 0); g.stroke();   // 卷角
      g.beginPath(); g.moveTo(cx + sd * s * .3, mid + s * .55); g.quadraticCurveTo(cx + sd * s * .9, mid + s * .95, cx + sd * s * 1.3, mid + s * .55); g.stroke();   // 下颌
    }
  };
  for (const cx of [0, W / 2, W]) taotie(cx);
  // 垂叶纹：下腹一圈朝下的尖叶，只描边
  const leafTop = row(.215), leafBot = row(.1), leaves = 28;
  g.strokeStyle = RAISED; g.lineWidth = 6; g.lineJoin = 'round';
  for (let i = 0; i < leaves; i++) {
    const x = (i + .5) * W / leaves, hw = W / leaves * .36;
    g.beginPath(); g.moveTo(x - hw, leafTop); g.quadraticCurveTo(x - hw * .5, (leafTop + leafBot) / 2, x, leafBot); g.quadraticCurveTo(x + hw * .5, (leafTop + leafBot) / 2, x + hw, leafTop); g.stroke();
    g.beginPath(); g.moveTo(x, leafTop + 6); g.lineTo(x, leafBot - 10); g.stroke();
  }
  // 磨圆：整体轻轻模糊一下，凸起的边缘不再是一刀切
  const o = document.createElement('canvas'); o.width = W; o.height = H;
  const og = o.getContext('2d'); og.filter = 'blur(2.5px)'; og.drawImage(c, 0, 0);
  const t = new THREE.CanvasTexture(o); t.colorSpace = THREE.NoColorSpace; t.wrapS = THREE.RepeatWrapping; t.anisotropy = 8;
  return t;
}

// 青铜：relief 给了的话，凹处多铜绿、凸处露铜色；没给（足、耳）就只按世界坐标的斑驳
function bronzeMaterial(relief = null) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .5, metalness: .8, bumpMap: relief, bumpScale: relief ? 3.4 : 0, envMapIntensity: .55 });
  mat.customProgramCacheKey = () => 'burner-bronze-' + (relief ? 'relief' : 'plain');
  mat.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vBp; varying vec3 vBn;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvBp = (modelMatrix * vec4(transformed, 1.)).xyz; vBn = normalize(mat3(modelMatrix) * objectNormal);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vBp; varying vec3 vBn;\n${NOISE_GLSL}\nfloat gPat = 0.; float gHi = 0.;`)
      .replace('#include <map_fragment>', /* glsl */`#include <map_fragment>
        {
          float n = fbm2(vBp.xz * 5.7 + vBp.y * 3.1) * .6 + fbm2(vBp.xy * 4.3 + 7.) * .4;
          float drip = fbm2(vec2((vBp.x + vBp.z) * 9., vBp.y * 1.4));          // 竖着往下淌的锈痕
          float rec = 0., hi = 0.;
          #ifdef USE_BUMPMAP
            float rel = texture2D(bumpMap, vBumpMapUv).r;
            rec = smoothstep(.47, .3, rel); hi = smoothstep(.56, .8, rel);
          #endif
          float up = clamp(normalize(vBn).y, 0., 1.);
          gPat = clamp(.3 + smoothstep(.32, .68, n) * .6 + rec * .9 + smoothstep(.45, .75, drip) * .3 * (1. - up) - hi * .65, 0., 1.);
          gHi = hi;
          vec3 bronze = vec3(.115, .072, .034) * (.8 + .4 * vnoise(vBp.xz * 30. + vBp.y * 21.));
          vec3 verd = mix(vec3(.062, .118, .092), vec3(.16, .23, .19), smoothstep(.62, .9, fbm2(vBp.xz * 14. + vBp.y * 9.)));   // 铜绿，里面零星几块浅色的锈壳
          vec3 col = mix(bronze, verd, gPat);
          col = mix(col, vec3(.3, .2, .09), hi * .55);                        // 凸起的地方被摸得发亮，露出一点铜色
          diffuseColor.rgb *= col;
        }`)
      .replace('#include <metalnessmap_fragment>', /* glsl */`#include <metalnessmap_fragment>
        metalnessFactor = mix(.7, .12, gPat);
        roughnessFactor = clamp(mix(.48, .93, gPat) - gHi * .15, .25, 1.);`);
  };
  return mat;
}

// 炉灰：灰白里夹着颗粒和烧黑的碎屑；uHeat 越大，灰里透出的暗红火越多
function ashMaterial(uniforms) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 });
  mat.customProgramCacheKey = () => 'burner-ash';
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vAp;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvAp = (modelMatrix * vec4(transformed, 1.)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vAp; uniform float uHeat; uniform float uTime;\n${NOISE_GLSL}`)
      .replace('#include <map_fragment>', /* glsl */`#include <map_fragment>
        {
          vec3 col = mix(vec3(.17, .165, .155), vec3(.3, .29, .275), fbm2(vAp.xz * 22.)) * (.9 + .2 * vnoise(vAp.xz * 160.));
          col *= 1. - .45 * smoothstep(.78, .86, vnoise(vAp.xz * 70.));   // 零星烧黑的碎屑
          diffuseColor.rgb *= col;
        }`)
      .replace('#include <emissivemap_fragment>', /* glsl */`#include <emissivemap_fragment>
        totalEmissiveRadiance += vec3(1., .32, .07) * uHeat * smoothstep(.6, .82, vnoise(vAp.xz * 48. + uTime * .15)) * (.6 + .4 * sin(uTime * 1.7 + vAp.x * 40.));`);
  };
  return mat;
}

// parent：香炉的组（已经放在院子里、整体缩放过）。返回炉灰的高度（香插在这里）和每帧的更新
export function createBurner({ parent }) {
  const put = (geo, m, x, y, z, { cast = true } = {}) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = cast; o.receiveShadow = true; parent.add(o); return o; };
  const profile = bodyProfile();
  const relief = reliefTexture(profile);
  const bodyMat = bronzeMaterial(relief), plainMat = bronzeMaterial();

  // 炉身
  put(new THREE.LatheGeometry(profile, 72), bodyMat, 0, Y0, 0);

  // 三只蹄足：上端插进鼎腹，膝部鼓起，往下收细，脚掌外撇成兽蹄；膝部朝外有一个小兽面
  const LEG = new THREE.SplineCurve([[.1, .46], [.12, .42], [.11, .37], [.09, .31], [.075, .24], [.07, .17], [.076, .1], [.088, .05], [.1, .018]].map(([r, y]) => new THREE.Vector2(r, y))).getSpacedPoints(24);
  const legGeo = new THREE.LatheGeometry([new THREE.Vector2(0, .46), ...LEG, new THREE.Vector2(.097, 0), new THREE.Vector2(0, 0)], 28);
  for (let i = 0; i < 3; i++) {
    const a = i * Math.PI * 2 / 3 + Math.PI / 6, r = .36, lx = Math.sin(a) * r, lz = Math.cos(a) * r;
    put(legGeo, plainMat, lx, .24 - .02, lz);
    const face = new THREE.Group(); face.position.set(lx * 1.28, .24 + .37, lz * 1.28); face.rotation.y = a; parent.add(face);
    const m = new THREE.Mesh(new THREE.SphereGeometry(.072, 18, 12), plainMat); m.scale.set(1.2, .9, .34); m.castShadow = true; face.add(m);
    const brow = new THREE.Mesh(new THREE.TorusGeometry(.05, .011, 8, 20, Math.PI), plainMat); brow.position.set(0, .012, .018); face.add(brow);
  }

  // 两只方折的立耳：顺着口沿站着，略微外撇
  const ear = new THREE.Shape(), hole = new THREE.Path();
  ear.moveTo(-.085, 0); ear.lineTo(-.085, .17); ear.quadraticCurveTo(-.085, .21, -.05, .21); ear.lineTo(.05, .21); ear.quadraticCurveTo(.085, .21, .085, .17); ear.lineTo(.085, 0); ear.lineTo(-.085, 0);
  hole.moveTo(-.045, .05); hole.lineTo(-.045, .155); hole.quadraticCurveTo(-.045, .175, -.025, .175); hole.lineTo(.025, .175); hole.quadraticCurveTo(.045, .175, .045, .155); hole.lineTo(.045, .05); hole.lineTo(-.045, .05);
  ear.holes.push(hole);
  const earGeo = new THREE.ExtrudeGeometry(ear, { depth: .042, bevelEnabled: true, bevelThickness: .01, bevelSize: .008, bevelSegments: 2, curveSegments: 8 });
  earGeo.translate(0, 0, -.021);
  for (const s of [-1, 1]) {
    // 立耳顺着口沿站着（耳的宽度沿口沿的方向，耳孔朝左右两侧），顶部往外撇一点
    const lean = new THREE.Group(); lean.position.set(s * .572, Y0 + .64, 0); lean.rotation.z = -s * .13; parent.add(lean);
    const o = new THREE.Mesh(earGeo, plainMat); o.rotation.y = Math.PI / 2; o.castShadow = o.receiveShadow = true; lean.add(o);
  }

  // 前后两个兽面的嘴里各衔一只铜环（贴着炉腹垂下来）
  for (const s of [-1, 1]) {
    put(new THREE.SphereGeometry(.03, 12, 10), plainMat, 0, Y0 + .275, s * .574).scale.set(1.2, .8, .6);
    const ring = put(new THREE.TorusGeometry(.072, .013, 10, 32), plainMat, 0, Y0 + .2, s * .582);
    ring.rotation.x = s * .2;
  }

  // 炉灰：中间微微隆起
  const uniforms = { uHeat: { value: 0 }, uTime: { value: 0 } };
  const ashGeo = new THREE.LatheGeometry([[0, ASH_Y + .012], [.15, ASH_Y + .01], [.3, ASH_Y + .005], [.42, ASH_Y], [.505, ASH_Y - .008]].map(([r, y]) => new THREE.Vector2(r, y)).reverse(), 48);
  put(ashGeo, ashMaterial(uniforms), 0, Y0, 0, { cast: false });

  // 炉口上方一团很淡的暖光（不是真的灯：只是叠加上去的光晕，不增加场景里灯的数量）
  const gc = document.createElement('canvas'); gc.width = gc.height = 64;
  const gg = gc.getContext('2d'), grd = gg.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,170,80,1)'); grd.addColorStop(.35, 'rgba(255,130,50,.35)'); grd.addColorStop(1, 'rgba(255,110,40,0)');
  gg.fillStyle = grd; gg.fillRect(0, 0, 64, 64);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(gc), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0, fog: false }));
  glow.position.set(0, Y0 + ASH_Y + .08, 0); glow.scale.set(1.1, .55, 1); glow.renderOrder = 7; parent.add(glow);

  return {
    ashY: Y0 + ASH_Y,
    // info：炉里的香（courtyardIncense.js 的 update 返回 { count, newest }，newest = 最新那炷点了多少毫秒）
    update(t, info) {
      const count = info?.count || 0, flash = info && info.newest < 2500 ? 1 - info.newest / 2500 : 0;
      const heat = count ? Math.min(1, .3 + count * .07) : 0;
      uniforms.uTime.value = t; uniforms.uHeat.value = heat * .7 + flash * 1.4;
      glow.material.opacity = heat * .16 + flash * .55;
      const k = 1 + flash * .5; glow.scale.set(1.1 * k, .55 * k, 1);
    },
  };
}
