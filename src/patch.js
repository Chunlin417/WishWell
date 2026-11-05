// 给 MeshStandardMaterial 注入：三平面 PBR 贴图、水下焦散 + 水体吸收、积雪、雨湿、草叶随风摆动
import * as THREE from 'three';
import { NOISE_GLSL, CAUSTIC_GLSL } from './shaders.js';

export const shared = {
  uTime: { value: 0 },
  uSunCol: { value: new THREE.Color() },   // 焦散用的光颜色 × 强度
  uCaustic: { value: 1 },
  uWaterCol: { value: new THREE.Color() }, // 水体散射色
  uSnow: { value: 0 },
  uWet: { value: 0 },
  uWind: { value: .3 },
  // 草坪颜色（随季节在 pool.setSeason 里更新）
  uLawnA: { value: new THREE.Color() }, uLawnB: { value: new THREE.Color() }, uLawnMoss: { value: new THREE.Color() },
  uDeepGlow: { value: 0 }, uDeepGlowCol: { value: new THREE.Color(.22, .8, .75) },   // 夜里池心深处的微光
  uFoxGlow: { value: 0 }, uFoxGlowCol: { value: new THREE.Color(.3, .95, .85) },
};

const GRASS_SWAY = h => /* glsl */`
  vH = position.y / ${h.toFixed(3)};
  vec2 ip = vec2(instanceMatrix[3][0], instanceMatrix[3][2]);
  float sw = sin(uTime * 1.6 + ip.x * 1.1 + ip.y * .7) * .6 + sin(uTime * 2.7 + ip.x * 2.3 - ip.y * 1.9) * .3;
  transformed.x += sw * vH * vH * (.03 + .12 * uWind);
  transformed.z += cos(uTime * 1.3 + ip.y) * vH * vH * .03 * uWind;
`;

// 三平面映射：岩石这类没有好 UV 的形状，按世界坐标从 x/y/z 三个方向投影贴图再混合
const TRI_GLSL = /* glsl */`
uniform sampler2D tDiff0; uniform sampler2D tNor0; uniform sampler2D tRough0;
uniform sampler2D tDiff1; uniform sampler2D tNor1; uniform sampler2D tRough1;
uniform vec2 uTexScale; uniform float uGray; uniform float uBright; uniform float uSoft; uniform float uContrast;
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
export function patch(mat, { grass = false, grassH = .42, underwater = true, tex = null, scales = false, glowAttr = false } = {}) {
  const mode = tex ? tex.mode : 'none';
  mat.customProgramCacheKey = () => `wish-${grass}-${grassH}-${underwater}-${mode}-${scales}-${glowAttr}`;
  if (scales) mat.defines = { ...(mat.defines || {}), SCALES: '' };
  if (glowAttr) mat.defines = { ...(mat.defines || {}), GLOWATTR: '' };
  if (tex) {
    mat.defines = { ...(mat.defines || {}), TRI: '' };
    if (mode !== 'single') mat.defines.TRI_TWO = '';
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
      });
    }
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWPos; varying vec3 vWNrm; varying float vH; varying float vMoss;
        #ifdef HAS_MOSS
          attribute float aMoss;
        #endif
        #ifdef LAWN
          attribute vec2 aLawn; varying vec2 vLawn;
        #endif
        #ifdef SCALES
          attribute float aScale; varying float vScaleM; varying vec3 vOPos; varying vec3 vONrm;
        #endif
        #ifdef GLOWATTR
          attribute float aGlow; varying float vGlow;
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
        ${grass ? GRASS_SWAY(grassH) : ''}`)
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
        uniform float uTime; uniform float uCaustic; uniform float uSnow; uniform float uWet;
        uniform vec3 uSunCol; uniform vec3 uWaterCol; uniform float uDeepGlow; uniform vec3 uDeepGlowCol;
        #ifdef LAWN
          varying vec2 vLawn; uniform vec3 uLawnA; uniform vec3 uLawnB; uniform vec3 uLawnMoss;
        #endif
        #ifdef SCALES
          varying float vScaleM; varying vec3 vOPos; varying vec3 vONrm;
          ${SCALES_GLSL}
        #endif
        #ifdef GLOWATTR
          varying float vGlow; uniform float uFoxGlow; uniform vec3 uFoxGlowCol;
        #endif
        ${NOISE_GLSL}
        ${underwater ? CAUSTIC_GLSL : ''}
        ${tex ? TRI_GLSL : ''}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
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
              mossM = m * smoothstep(.35, .85, vMoss + (vnoise(vWPos.xz * 3.1 + vWPos.y * 2.) - .5) * .5);
              mossTone = .7 + 1.4 * dot(alb1, vec3(.33));
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
          alb *= uBright;
          #ifdef LAWN
            // 草坪：几层不同大小的色块叠出深浅不一的绿，再借地面贴图的明暗当作草的颗粒感
            float ln = vnoise(vWPos.xz * .35) * .55 + vnoise(vWPos.xz * 1.6) * .3 + vnoise(vWPos.xz * 5.) * .15;
            vec3 lawn = mix(uLawnA, uLawnB, smoothstep(.25, .75, ln));
            lawn = mix(lawn, uLawnMoss, vLawn.y);
            lawn *= mix(.8, 1.15, clamp(dot(alb, vec3(.3, .59, .11)) * 3., 0., 1.));
            alb = mix(alb, lawn, vLawn.x);
            triRough = mix(triRough, .92, vLawn.x);
            triN = normalize(mix(triN, gN, vLawn.x * .35));
          #endif
          diffuseColor.rgb *= alb;
          // 青苔放在去色之后再上：石头顶上一片片鲜绿的苔
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.15, .2, .07) * mossTone, mossM * .6);
        #endif
        float above = smoothstep(-0.03, 0.06, vWPos.y);
        ${grass ? 'diffuseColor.rgb *= mix(0.55, 1.0, vH);' : ''}        float snowN = vnoise(vWPos.xz * 3.0) * .35 + vnoise(vWPos.xz * 11.0) * .15;
        float snowM = smoothstep(.25, .65, triN.y + snowN - .25) * uSnow * above;
        ${grass ? 'snowM = uSnow * smoothstep(.2, 1.0, vH) * .85;' : ''}
        diffuseColor.rgb *= 1.0 - .4 * uWet * above;
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.9, .92, .96), snowM);`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        #ifdef TRI
          roughnessFactor *= triRough;
        #endif
        roughnessFactor = mix(roughnessFactor, ${grass ? '.6' : mode === 'ground' ? '.5' : '.22'}, uWet * above * (1.0 - snowM));
        roughnessFactor = mix(roughnessFactor, .8, snowM);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        #ifdef GLOWATTR
          totalEmissiveRadiance += uFoxGlowCol * uFoxGlow * vGlow * (.8 + .2 * sin(uTime * 1.3 + vWPos.y * 9.));
        #endif`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
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

    if (underwater) {
      sh.fragmentShader = sh.fragmentShader.replace('#include <opaque_fragment>', `
        float dW = -vWPos.y;
        if (dW > 0.0) {
          float cs = caustic(vWPos.xz * 1.15, uTime * .9) * (.35 + .65 * vnoise(vWPos.xz * .5 + uTime * .05));
          float att = exp(-dW * 1.4);
          outgoingLight += uSunCol * cs * att * uCaustic * max(triN.y, 0.0) * (diffuseColor.rgb + .08) * .55;
          outgoingLight *= vec3(.85, .95, .9);
          // 越深越被水"吃掉"：红光最先消失，然后是绿光，深处只剩幽暗的蓝绿色
          vec3 tr = exp(-dW * vec3(2.6, 1.05, .82));
          outgoingLight = outgoingLight * tr + uWaterCol * (1.0 - tr.b);
          // 夜里池心深处一团柔和的微光：越深越亮，缓慢地呼吸
          if (uDeepGlow > 0.0) {
            float deep = smoothstep(1.0, 2.7, dW);
            float pulse = .8 + .2 * sin(uTime * .4);
            outgoingLight += uDeepGlowCol * uDeepGlow * deep * pulse;
          }
        }
        #include <opaque_fragment>`);
    }
  };
  return mat;
}
