// 给 MeshStandardMaterial 注入：三平面 PBR 贴图、水下焦散 + 水体吸收、积雪、雨湿、草叶随风摆动
import * as THREE from 'three';
import { NOISE_GLSL, CAUSTIC_GLSL } from './shaders.js';

export const shared = {
  uTime: { value: 0 },
  uSunCol: { value: new THREE.Color() },   // 焦散用的光颜色 × 强度
  uKeyDir: { value: new THREE.Vector3(0, 1, 0) },   // 主光（太阳 / 月亮）的方向，草叶透光用
  uCaustic: { value: 1 },
  uWaterCol: { value: new THREE.Color() }, // 水体散射色
  uSnow: { value: 0 },
  uFrost: { value: 0 },   // 冬天清晨的白霜（0～1），在 main.js 里按季节、气温、时间算
  uWet: { value: 0 },
  uWind: { value: .3 },
  // 草坪颜色（随季节在 pool.setSeason 里更新）
  uLawnA: { value: new THREE.Color() }, uLawnB: { value: new THREE.Color() }, uLawnMoss: { value: new THREE.Color() },
  uDeepGlow: { value: 0 }, uDeepGlowCol: { value: new THREE.Color(.22, .8, .75) },   // 夜里池心深处的微光
  uFoxGlow: { value: 0 }, uFoxGlowCol: { value: new THREE.Color(.3, .95, .85) },
};

// 草叶从根到尖的颜色：根部暗、偏冷（埋在草丛里照不到光），尖端亮、微微发黄（老叶尖）；BLADE 再画一条浅色中脉
const GRASS_TONE = /* glsl */`
        #ifdef CARD
          // 贴图照片本身已经有根部暗、叶尖黄的变化，这里只把贴地的一段再压暗一点（被周围的草挡住）
          diffuseColor.rgb *= mix(vec3(.62, .68, .64), vec3(1.), smoothstep(0., .45, vH));
        #else
          diffuseColor.rgb *= mix(vec3(.42, .5, .44), vec3(1.), smoothstep(0., .75, vH));
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.14, 1.07, .7), smoothstep(.55, 1., vH) * .35);
        #endif
        #ifdef BLADE
          float rib = 1. - smoothstep(.0, .22, abs(vBladeU - .5));
          diffuseColor.rgb *= .9 + .2 * rib;
        #endif
`;
// 透光：逆着太阳看草叶时，光从叶片背后透过来，叶子发亮、偏黄绿；顺光时也有一点点
const GRASS_TRANS = /* glsl */`
        {
          vec3 V = normalize(cameraPosition - vWPos), L = normalize(uKeyDir);
          float back = pow(clamp(dot(-V, L), 0., 1.), 5.);
          float trans = (back * .8 + .08) * pow(clamp(vH, 0., 1.), .8) * smoothstep(-.05, .15, L.y);
          outgoingLight += uSunCol * trans * diffuseColor.rgb * vec3(1., 1.2, .55) * .13;
        }
`;

const GRASS_SWAY = (h, s = 1) => /* glsl */`
  vH = position.y / ${h.toFixed(3)};
  vec2 ip = vec2(instanceMatrix[3][0], instanceMatrix[3][2]);
  float sw = sin(uTime * 1.6 + ip.x * 1.1 + ip.y * .7) * .6 + sin(uTime * 2.7 + ip.x * 2.3 - ip.y * 1.9) * .3;
  transformed.x += sw * vH * vH * (.03 + .12 * uWind) * ${s.toFixed(3)};
  transformed.z += cos(uTime * 1.3 + ip.y) * vH * vH * .03 * uWind * ${s.toFixed(3)};
`;

// 三平面映射：岩石这类没有好 UV 的形状，按世界坐标从 x/y/z 三个方向投影贴图再混合
const TRI_GLSL = /* glsl */`
uniform sampler2D tDiff0; uniform sampler2D tNor0; uniform sampler2D tRough0;
uniform sampler2D tDiff1; uniform sampler2D tNor1; uniform sampler2D tRough1;
uniform vec2 uTexScale; uniform float uGray; uniform float uBright; uniform float uSoft; uniform float uContrast;
uniform vec3 uTint; uniform float uCrack;
vec4 triSample(sampler2D t, vec3 p, vec3 b, float s){
#ifdef TRI_TOP
  return texture2D(t, p.xz * s);
#else
  return texture2D(t, p.zy * s) * b.x + texture2D(t, p.xz * s) * b.y + texture2D(t, p.xy * s) * b.z;
#endif
}
vec3 triNormal(sampler2D t, vec3 p, vec3 n, vec3 b, float s){
#ifdef TRI_TOP
  vec3 ty = texture2D(t, p.xz * s).xyz * 2. - 1.;
  ty = vec3(ty.xy + n.xz, abs(ty.z) * n.y);
  return normalize(ty.xzy);
#else
  // whiteout 混合
  vec3 tx = texture2D(t, p.zy * s).xyz * 2. - 1.;
  vec3 ty = texture2D(t, p.xz * s).xyz * 2. - 1.;
  vec3 tz = texture2D(t, p.xy * s).xyz * 2. - 1.;
  tx = vec3(tx.xy + n.zy, abs(tx.z) * n.x);
  ty = vec3(ty.xy + n.xz, abs(ty.z) * n.y);
  tz = vec3(tz.xy + n.xy, abs(tz.z) * n.z);
  return normalize(tx.zyx * b.x + ty.xzy * b.y + tz.xyz * b.z);
#endif
}
`;

// 地面贴图：tex.ground 里每套的缩放 / 平均色 / 粗糙度 / 亮度直接写进 GLSL 常量
const GROUND_KEYS = ['grass', 'soil', 'sand', 'moss', 'litter'];
const GROUND_BRIGHT = { grass: 1, soil: 1.5, sand: 1.25, moss: 1, litter: 1.1 };
const f3 = v => v.toFixed(4);
function groundGLSL(g) {
  return GROUND_KEYS.map(k => `
    uniform sampler2D tG_${k}D; uniform sampler2D tG_${k}N;
    const float G_${k}_S = ${f3(g[k].scale)}; const float G_${k}_R = ${f3(g[k].rough)}; const float G_${k}_B = ${f3(GROUND_BRIGHT[k])};
    const vec3 G_${k}_M = vec3(${g[k].mean.map(f3).join(', ')});`).join('') + `
    // 防重复：第二次采样旋转约 37°、缩小、平移，再按大尺度噪声和第一次混合
    const mat2 AT_R = mat2(.8, .6, -.6, .8), AT_RT = mat2(.8, -.6, .6, .8);
    vec2 atUV(vec2 p){ return AT_R * p * .77 + vec2(.37, .71); }
    vec3 atDiff(sampler2D t, vec2 p, float m){ return mix(texture2D(t, p).rgb, texture2D(t, atUV(p)).rgb, m); }
    vec2 atNor(sampler2D t, vec2 p, float m){
      vec2 a = texture2D(t, p).xy * 2. - 1., b = texture2D(t, atUV(p)).xy * 2. - 1.;
      return mix(a, AT_RT * b, m);   // 旋转过的采样，法线也要转回来
    }`;
}

// mode: 'rock'（岩石 + 苔藓按 aMoss 混合）| 'ground'（水下卵石 + 岸上林地按高度混合）| 'single'
// grassH：随风摆动的植物高度（草叶 / 菖蒲 / 玉簪各不相同）
// ground 模式额外有"草坪"：顶点属性 aLawn = (草坪覆盖度, 苔藓程度)，直接画进地面颜色，没有会闪烁的细小草茎
// scales：石雕身上的鱼鳞纹（只在顶点属性 aScale 标记的区域），用屏幕空间导数做凹凸，随光照有立体感
const SCALES_GLSL = /* glsl */`
float fishScale(vec2 q){
  q.y *= 1.25;
  float row = floor(q.y);
  vec2 c = vec2(q.x + .5 * mod(row, 2.), q.y);
  vec2 f = fract(c) - vec2(.5, .15);
  float d = length(f * vec2(1., 1.1));
  float h = 1. - smoothstep(.4, .62, d);
  return h * (.55 + .45 * clamp(f.y + .5, 0., 1.));
}
float scaleField(vec3 p, vec3 n){
  vec3 b = pow(abs(n), vec3(4.)); b /= dot(b, vec3(1.));
  float s = 21.;
  return fishScale(vec2(p.y, -p.z) * s) * b.x + fishScale(vec2(p.x, -p.z) * s) * b.y + fishScale(p.xy * s) * b.z;
}
`;

// glowAttr：顶点属性 aGlow 标记的部位（石狐的灵纹、铃铛）在夜里发光，强度由 shared.uFoxGlow 控制
// sway：摆动幅度的倍数（贴地的矮草要小一些）
// upNormal：双面草叶的背面也用朝上的法线（否则背面法线朝下，一半草叶是黑的）
// blade：细长的草叶（PlaneGeometry，uv.x 横跨叶片）——画出中脉
// rim：自发光只出现在轮廓边缘（视线擦过表面的地方），正面几乎不亮——暗色的龙只有一圈青光勾出轮廓
// absorb：水的吸收按深度的多少倍算（龙用 0.45：在 2 米深处还看得清鳞片，否则只剩一个青色的剪影）
// card：贴草丛照片的交叉面片（map + alphaTest）——远处按 mipmap 级别加厚 alpha，草不会越远越稀
export function patch(mat, { grass = false, grassH = .42, sway = 1, upNormal = false, blade = false, card = false, rim = false, absorb = 1, underwater = true, tex = null, scales = false, glowAttr = false } = {}) {
  const mode = tex ? tex.mode : 'none';
  mat.customProgramCacheKey = () => `wish-${grass}-${grassH}-${sway}-${upNormal}-${blade}-${card}-${rim}-${absorb}-${underwater}-${mode}-${scales}-${glowAttr}`;
  if (upNormal) mat.defines = { ...(mat.defines || {}), UP_NORMAL: '' };
  if (blade) mat.defines = { ...(mat.defines || {}), BLADE: '' };
  if (card) mat.defines = { ...(mat.defines || {}), CARD: '' };
  if (rim) mat.defines = { ...(mat.defines || {}), RIM: '' };
  if (scales) mat.defines = { ...(mat.defines || {}), SCALES: '' };
  if (glowAttr) mat.defines = { ...(mat.defines || {}), GLOWATTR: '' };
  if (tex) {
    mat.defines = { ...(mat.defines || {}), TRI: '' };
    if (mode === 'rock') mat.defines.TRI_TWO = '';
    if (mode === 'rock') mat.defines.HAS_MOSS = '';
    if (mode === 'ground') { mat.defines.TRI_TOP = ''; mat.defines.LAWN = ''; }
  }
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, shared);
    if (tex) {
      const [a, b = a] = tex.sets;
      Object.assign(sh.uniforms, {
        tDiff0: { value: a.diff }, tNor0: { value: a.nor }, tRough0: { value: a.rough },
        tDiff1: { value: b.diff }, tNor1: { value: b.nor }, tRough1: { value: b.rough },
        uTexScale: { value: new THREE.Vector2(...tex.scale) },
        uGray: { value: tex.gray ?? 0 }, uBright: { value: tex.bright ?? 1 }, uSoft: { value: tex.soft ?? 0 },
        uContrast: { value: tex.contrast ?? 1 },
        uTint: { value: new THREE.Vector3(...(tex.tint || [1, 1, 1])) }, uCrack: { value: tex.crack ?? 0 },
      });
      if (tex.ground) for (const k of GROUND_KEYS) {
        sh.uniforms[`tG_${k}D`] = { value: tex.ground[k].diff };
        sh.uniforms[`tG_${k}N`] = { value: tex.ground[k].nor };
      }
    }
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWPos; varying vec3 vWNrm; varying float vH; varying float vMoss;
        #ifdef HAS_MOSS
          attribute float aMoss;
        #endif
        #ifdef LAWN
          attribute vec3 aLawn; varying vec3 vLawn;
        #endif
        #ifdef SCALES
          attribute float aScale; varying float vScaleM; varying vec3 vOPos; varying vec3 vONrm;
        #endif
        #ifdef GLOWATTR
          attribute float aGlow; varying float vGlow;
        #endif
        #ifdef BLADE
          varying float vBladeU;
        #endif
        uniform float uTime; uniform float uWind;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vH = 1.0; vMoss = 0.0;
        #ifdef HAS_MOSS
          vMoss = aMoss;
        #endif
        #ifdef LAWN
          vLawn = aLawn;
        #endif
        #ifdef SCALES
          vScaleM = aScale; vOPos = position; vONrm = objectNormal;
        #endif
        #ifdef GLOWATTR
          vGlow = aGlow;
        #endif
        #ifdef BLADE
          vBladeU = uv.x;
        #endif
        ${grass ? GRASS_SWAY(grassH, sway) : ''}`)
      .replace('#include <fog_vertex>', `#include <fog_vertex>
        vec4 wp4 = vec4(transformed, 1.0);
        vec3 wn = objectNormal;
        #ifdef USE_INSTANCING
          wp4 = instanceMatrix * wp4;
          wn = mat3(instanceMatrix) * wn;
        #endif
        wp4 = modelMatrix * wp4;
        vWPos = wp4.xyz;
        vWNrm = normalize(mat3(modelMatrix) * wn);`);

    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWPos; varying vec3 vWNrm; varying float vH; varying float vMoss;
        uniform float uTime; uniform float uCaustic; uniform float uSnow; uniform float uWet; uniform float uFrost;
        uniform vec3 uSunCol; uniform vec3 uWaterCol; uniform float uDeepGlow; uniform vec3 uDeepGlowCol; uniform vec3 uKeyDir;
        #ifdef BLADE
          varying float vBladeU;
        #endif
        #ifdef LAWN
          varying vec3 vLawn; uniform vec3 uLawnA; uniform vec3 uLawnB; uniform vec3 uLawnMoss;
        #endif
        #ifdef SCALES
          varying float vScaleM; varying vec3 vOPos; varying vec3 vONrm;
          ${SCALES_GLSL}
        #endif
        #ifdef GLOWATTR
          varying float vGlow; uniform float uFoxGlow; uniform vec3 uFoxGlowCol;
        #endif
        ${NOISE_GLSL}
        #ifdef LAWN
          // 草丛的"高度场"：一簇簇的草堆（约 15cm），用来做明暗和凹凸
          float lawnTuft(vec2 p){ return vnoise(p * 6.5) * .6 + vnoise(p * 17. + 3.1) * .4; }
          ${tex && tex.ground ? groundGLSL(tex.ground) : ''}
        #endif
        ${underwater ? CAUSTIC_GLSL : ''}
        ${tex ? TRI_GLSL : ''}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        #ifdef CARD
          // mipmap 缩小时 alpha 被平均得越来越淡，alphaTest 会把细草叶整根裁掉：按屏幕上的缩小倍数补回来
          {
            vec2 dUv = fwidth(vMapUv) * 2048.;
            float lod = log2(max(max(dUv.x, dUv.y), 1.));
            diffuseColor.a = clamp(diffuseColor.a * (1. + lod * .35), 0., 1.);
            // 侧着看（面片几乎和视线平行）时淡出：从上往下看不会露出"十"字形的面片
            vec3 fN = normalize(cross(dFdx(vWPos), dFdy(vWPos)));
            float facing = abs(dot(fN, normalize(cameraPosition - vWPos)));
            diffuseColor.a *= smoothstep(.06, .3, facing);
          }
        #endif
        #ifdef SCALES
          // 远处鳞片小于几个像素会闪烁：按屏幕上的大小淡出
          float scaleFar = 1. - smoothstep(.12, .35, length(fwidth(vOPos * 21.)));
          float scaleH = vScaleM > .01 ? scaleField(vOPos, normalize(vONrm)) * vScaleM * scaleFar : 0.;
          diffuseColor.rgb *= mix(1., .78 + .26 * scaleH / max(vScaleM * scaleFar, .01), vScaleM * scaleFar);   // 鳞片之间的缝更暗
        #endif
        vec3 gN = normalize(vWNrm);
        vec3 triN = gN; float triRough = 1.0;
        #ifdef TRI
          vec3 tb = pow(abs(gN), vec3(4.)); tb /= dot(tb, vec3(1.));
          vec3 alb = triSample(tDiff0, vWPos, tb, uTexScale.x).rgb;
          triRough = triSample(tRough0, vWPos, tb, uTexScale.x).r;
          triN = triNormal(tNor0, vWPos, gN, tb, uTexScale.x);
          float mossM = 0., mossTone = 1.;
          #ifdef TRI_TWO
            vec3 alb1 = triSample(tDiff1, vWPos, tb, uTexScale.y).rgb;
            float m;
            #ifdef HAS_MOSS
              m = smoothstep(.3, .6, vMoss + (dot(alb1, vec3(.3, .6, .1)) - .12) * 1.5);
              mossM = m * smoothstep(.45, .9, vMoss + (vnoise(vWPos.xz * 4.3 + vWPos.y * 2.) - .5) * .6);
              mossTone = .75 + .9 * dot(alb1, vec3(.33));
            #else
              m = smoothstep(-.04, .14, vWPos.y + (vnoise(vWPos.xz * 2.3) - .5) * .12);
            #endif
            alb = mix(alb, alb1, m);
            triRough = mix(triRough, triSample(tRough1, vWPos, tb, uTexScale.y).r, m);
            triN = normalize(mix(triN, triNormal(tNor1, vWPos, gN, tb, uTexScale.y), m));
          #endif
          alb = mix(alb, vec3(dot(alb, vec3(.3, .59, .11))), uGray);
          if (uSoft > 0.) alb = alb / (alb + uSoft) * (1. + uSoft);   // 压缩明暗差（地衣白斑不再刺眼）
          alb = mix(vec3(.24), alb, uContrast);                         // 只保留一部分贴图纹理
          alb *= uBright * uTint;
          if (uCrack > 0.) {
            // 石头上的裂纹：两组弯曲的细线，断断续续，裂缝里更暗
            vec3 cp = vWPos;
            float r1 = abs(vnoise(cp.xy * 2.6 + cp.z * 1.7) - .5), r2 = abs(vnoise(cp.zy * 3.4 - cp.x * 1.3 + 7.) - .5);
            float crack = (1. - smoothstep(.0, .028, r1)) * .65 + (1. - smoothstep(.0, .022, r2)) * .45;
            crack *= smoothstep(.35, .6, vnoise(cp.xz * .9 + cp.y));
            alb *= 1. - clamp(crack, 0., 1.) * uCrack;
          }
          #ifdef LAWN
            // 岸上的地面分几层：湿泥土打底 → 零星成片的落叶 → 草地（石头边是苔藓）→ 水边一圈湿沙；水下是卵石
            // 每层都是真实贴图；草和苔藓的颜色仍然跟着季节走（贴图除以它的平均色，只留明暗和细节，再乘季节色）
            vec2 lp = vWPos.xz;
            float px = length(fwidth(lp));
            float tuftW = 1. - smoothstep(.03, .09, px);     // 草堆明暗：小于像素时淡出
            float atM = smoothstep(.3, .7, vnoise(lp * .45 + 17.));   // 防重复：两次采样的混合比例

            vec3 grassC = atDiff(tG_grassD, lp * G_grass_S, atM);
            vec3 soilC  = atDiff(tG_soilD,  lp * G_soil_S,  1. - atM);
            vec3 sandC  = texture2D(tG_sandD,   lp * G_sand_S).rgb;
            vec3 mossC  = texture2D(tG_mossD,   lp * G_moss_S).rgb;
            vec3 litC   = texture2D(tG_litterD, lp * G_litter_S).rgb;
            vec2 grassN = atNor(tG_grassN, lp * G_grass_S, atM);
            vec2 soilN  = atNor(tG_soilN,  lp * G_soil_S,  1. - atM);
            vec2 sandN  = texture2D(tG_sandN,   lp * G_sand_S).xy * 2. - 1.;
            vec2 mossN  = texture2D(tG_mossN,   lp * G_moss_S).xy * 2. - 1.;
            vec2 litN   = texture2D(tG_litterN, lp * G_litter_S).xy * 2. - 1.;

            // 草地颜色：大块色调 → 干湿（土包干、洼地绿）→ 苔藓
            float ln = vnoise(lp * .35) * .55 + vnoise(lp * 1.6) * .3 + vnoise(lp * 5.) * .15;
            vec3 lawn = mix(uLawnA, uLawnB, smoothstep(.25, .75, ln));
            float dry = clamp(vLawn.z * .75 + (vnoise(lp * .9 + 21.) - .5) * .7, 0., 1.);
            dry = smoothstep(.45, .9, dry);
            vec3 straw = vec3(dot(uLawnB, vec3(.33))) * vec3(1.3, 1.12, .66);
            lawn = mix(lawn, straw, dry * .38);
            lawn = mix(lawn, uLawnA * .8, (1. - vLawn.z) * .25 * (1. - dry));   // 洼地更深更润
            vec3 grassDetail = grassC / G_grass_M;                              // 平均为 1 的草地细节
            float bl0 = clamp(dot(grassDetail, vec3(.3, .59, .11)) * .5, 0., 1.);
            // 苔藓：边缘被噪声打散、和草混着长，颜色压暗一点，不是一块块鲜绿的补丁
            float gMoss = vLawn.y * smoothstep(.2, .75, vLawn.y + (vnoise(lp * 3.3) - .5) * .7 + (bl0 - .5) * .4) * .8;
            vec3 lawnAlb = mix(lawn * grassDetail, uLawnMoss * .8 * (mossC / G_moss_M), gMoss);
            // 一簇簇草堆：缝隙稍暗，草尖略亮略黄（贴图已经有细节，这里只轻轻叠一层）
            float tuft = lawnTuft(lp);
            float tuftS = mix(.5, tuft, tuftW);
            lawnAlb *= mix(.78, 1.08, smoothstep(.15, .85, tuftS));
            lawnAlb *= .88 + .24 * vnoise(lp * .12 + 3.7);                    // 大范围的明暗起伏

            // 露土：边缘用草地贴图自己的明暗打碎（像草叶盖在土上），土包上更容易露
            float bl = bl0;
            float bare = vnoise(lp * .55 + 40.) * .65 + vnoise(lp * 2.1 + 9.) * .35 + dry * .18;
            bare = smoothstep(.68, .78, bare + (bl - .5) * .25 + (tuft - .5) * .1) * (1. - vLawn.y);
            float cover = vLawn.x * (1. - bare * .9);
            cover = clamp(cover + (bl - .5) * .9 * cover * (1. - cover) * 4., 0., 1.);
            cover = max(cover, gMoss * .9 * step(.03, vWPos.y));   // 苔藓不受草地覆盖度限制

            // 泥土和落叶：落叶一片片地盖在泥土上，石头脚下和草地边缘多一些
            float litW = smoothstep(.55, .72, vnoise(lp * .7 + 31.) * .65 + vnoise(lp * 2.9 + 3.) * .35 + vLawn.y * .25);
            vec3 soilAlb = mix(soilC * G_soil_B, litC * G_litter_B, litW);
            vec2 soilNx = mix(soilN, litN, litW);
            float soilR = mix(G_soil_R, G_litter_R, litW);

            // 水边湿沙：水线往上一窄条，边缘被噪声打乱
            // （只在池边：按 pool.js 的 Rb 算出到池中心的相对距离 k，远处低洼的地方不出沙）
            float th = atan(lp.y, lp.x);
            float poolK = length(lp) / (3.7 + .3 * sin(3. * th + .8) + .18 * sin(5. * th + 2.1) + .1 * sin(8. * th + .3));
            float sandW = (1. - smoothstep(.06, .24, vWPos.y + (vnoise(lp * 1.7 + 5.) - .5) * .16))
                        * (1. - smoothstep(1.12, 1.3, poolK + (vnoise(lp * 2.2) - .5) * .1));

            vec3 landAlb = mix(soilAlb, lawnAlb, cover);
            vec2 landN = mix(soilNx, mix(grassN, mossN, gMoss), cover);
            float landR = mix(soilR, mix(G_grass_R, G_moss_R, gMoss), cover);
            landAlb = mix(landAlb, sandC * G_sand_B, sandW);
            landN = mix(landN, sandN, sandW);
            landR = mix(landR, G_sand_R, sandW);

            // 法线：贴图凹凸 + 草堆的柔和起伏
            vec2 e = vec2(.02, 0.);
            vec2 g = vec2(lawnTuft(lp + e.xy) - tuft, lawnTuft(lp + e.yx) - tuft) / e.x;
            landN = landN * .9 - g * .03 * tuftW * cover;
            vec3 landNW = normalize(vec3(gN.x + landN.x, gN.y, gN.z + landN.y));

            float land = smoothstep(-.04, .14, vWPos.y + (vnoise(lp * 2.3) - .5) * .12);
            alb = mix(alb, landAlb, land);
            triRough = mix(triRough, landR, land);
            triN = normalize(mix(triN, landNW, land));
          #endif
          diffuseColor.rgb *= alb;
          // 青苔放在去色之后再上：石头顶上一片片鲜绿的苔
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.07, .11, .045) * mossTone, mossM * .7);   // 深绿色的薄苔，不再是浅黄斑
        #endif
        float above = smoothstep(-0.03, 0.06, vWPos.y);
        ${grass ? GRASS_TONE : ''}        float snowN = vnoise(vWPos.xz * 3.0) * .35 + vnoise(vWPos.xz * 11.0) * .15;
        float snowM = smoothstep(.25, .65, triN.y + snowN - .25) * uSnow * above;
        ${grass ? 'snowM = uSnow * smoothstep(.2, 1.0, vH) * .85;' : ''}
        diffuseColor.rgb *= 1.0 - .4 * uWet * above;
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.9, .92, .96), snowM);
        // 白霜：结在朝上的面和草叶尖上，一粒粒的、不均匀；颜色偏冷的灰白，比雪薄（底色还透得出来）
        float frostM = 0.;
        if (uFrost > 0.) {
          float fg = vnoise(vWPos.xz * 23. + vWPos.y * 7.) * .6 + vnoise(vWPos.xz * 61.) * .4;
          frostM = uFrost * above * (1. - snowM) * smoothstep(.3, .85, fg + uFrost * .15 - .05);
          ${grass ? 'frostM *= smoothstep(.3, 1., vH) * .75;' : 'frostM *= smoothstep(.5, .95, triN.y) * .5;'}
          // 霜是一层薄薄的冰晶：底色变灰变浅，但绿色还在
          vec3 frostCol = diffuseColor.rgb * .45 + vec3(.42, .46, .5);
          diffuseColor.rgb = mix(diffuseColor.rgb, frostCol, frostM);
        }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        #ifdef TRI
          roughnessFactor *= triRough;
        #endif
        roughnessFactor = mix(roughnessFactor, ${grass ? '.6' : mode === 'ground' ? '.5' : '.22'}, uWet * above * (1.0 - snowM));
        roughnessFactor = mix(roughnessFactor, .8, snowM);
        roughnessFactor = mix(roughnessFactor, .55, frostM * .6);   // 霜晶在斜光下微微发亮`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        #ifdef RIM
          {
            float fr = 1. - abs(dot(normalize(normal), normalize(vViewPosition)));
            totalEmissiveRadiance *= .08 + 1.3 * fr * fr * fr * fr;
          }
        #endif
        #ifdef GLOWATTR
          totalEmissiveRadiance += uFoxGlowCol * uFoxGlow * vGlow * (.8 + .2 * sin(uTime * 1.3 + vWPos.y * 9.));
        #endif`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        #ifdef UP_NORMAL
          normal = normalize((viewMatrix * vec4(normalize(vWNrm), 0.)).xyz);
        #endif
        #ifdef TRI
          // 积雪处把凹凸压平一些
          normal = normalize((viewMatrix * vec4(normalize(mix(triN, gN, snowM * .7)), 0.)).xyz);
        #endif
        #ifdef SCALES
          // 用屏幕空间导数做凹凸（不需要切线）：鳞片边缘起伏，随光线有明暗
          {
            vec3 sp = -vViewPosition, dpx = dFdx(sp), dpy = dFdy(sp);
            float dhx = dFdx(scaleH), dhy = dFdy(scaleH);
            vec3 r1 = cross(dpy, normal), r2 = cross(normal, dpx);
            float det = dot(dpx, r1);
            vec3 g = sign(det) * (dhx * r1 + dhy * r2) * .006 * (1. - snowM);
            normal = normalize(abs(det) * normal - g);
          }
        #endif`);

    if (grass) sh.fragmentShader = sh.fragmentShader.replace('#include <opaque_fragment>', `${GRASS_TRANS}
        #include <opaque_fragment>`);
    if (underwater) {
      sh.fragmentShader = sh.fragmentShader.replace('#include <opaque_fragment>', `
        float dW = -vWPos.y * ${absorb.toFixed(3)};   // absorb < 1：这个物体被水"吃掉"得少一些（像在更浅的地方）
        if (dW > 0.0) {
          float cs = caustic(vWPos.xz * 1.15, uTime * .9) * (.35 + .65 * vnoise(vWPos.xz * .5 + uTime * .05));
          float att = exp(-dW * 1.4);
          outgoingLight += uSunCol * cs * att * uCaustic * max(triN.y, 0.0) * (diffuseColor.rgb + .08) * .55;
          outgoingLight *= mix(vec3(1.), vec3(.6, .8, .9), smoothstep(0., .12, dW));   // 一入水就带上青蓝色调（浸在水里的石头不再是棕色）
          // 越深越被水"吃掉"：红光最先消失，然后是绿光，深处只剩幽暗的蓝绿色
          vec3 tr = exp(-dW * vec3(2.6, 1.05, .82));
          outgoingLight = outgoingLight * tr + uWaterCol * (1.0 - tr.b);
          // 夜里池心深处一团柔和的微光：越深越亮，缓慢地呼吸
          if (uDeepGlow > 0.0) {
            // 光从池心深处向外散开：按离池心的水平距离衰减，同一位置的池底和卵石一样亮，不会出现黑色剪影
            float deep = smoothstep(0., .3, dW) * (1. - smoothstep(.15, .7, length(vWPos.xz) / 3.8));
            float pulse = .8 + .2 * sin(uTime * .4);
            outgoingLight += uDeepGlowCol * uDeepGlow * deep * pulse;
          }
        }
        #include <opaque_fragment>`);
    }
  };
  return mat;
}
