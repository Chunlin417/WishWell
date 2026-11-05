// 天空穹顶：渐变、晚霞、太阳、带月相的月亮、星星、云层。
// 近景里看不到天空本身，但它会出现在水面倒影里，并作为环境光照亮整个场景。
import * as THREE from 'three';
import { NOISE_GLSL } from './shaders.js';

const VS = /* glsl */`
varying vec3 vDir;
void main(){ vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.); gl_Position = p.xyww; }`;

const FS = /* glsl */`
uniform vec3 uZen; uniform vec3 uHor; uniform vec3 uSunDir; uniform vec3 uSunCol; uniform vec3 uMoonDir;
uniform vec3 uGlowCol; uniform vec3 uCloudCol; uniform vec3 uFogCol;
uniform float uSunVis; uniform float uMoonVis; uniform float uPhase; uniform float uStars; uniform float uCloud;
uniform float uTime; uniform float uGlow; uniform float uFog; uniform float uFlash; uniform float uNight; uniform float uDisc;
varying vec3 vDir;
${NOISE_GLSL}
void main(){
  vec3 d = normalize(vDir); float h = d.y;
  vec3 col = mix(uHor, uZen, pow(clamp(h, 0., 1.), .45));
  if (h < 0.) col = uHor * mix(1., .35, clamp(-h * 4., 0., 1.));
  float sd = max(dot(d, uSunDir), 0.);
  col += uGlowCol * uGlow * (pow(sd, 8.) * .8 + pow(sd, 2.) * .15) * (1. - clamp(h, 0., 1.) * .6);

  if (uStars > .001 && h > 0.) {
    vec3 sp = d * 220.; vec3 cell = floor(sp);
    float r = fract(sin(dot(cell, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
    float st = (1. - smoothstep(0., .15, length(fract(sp) - .5))) * step(.985, r);
    col += vec3(st * (.6 + .4 * sin(uTime * 2. + r * 90.))) * uStars * 1.5;
  }

  col += uSunCol * uSunVis * uDisc * (smoothstep(.99985, .99993, sd) * 6. + pow(sd, 900.) * 1.5);

  float md = dot(d, uMoonDir);
  col += vec3(.6, .66, .85) * pow(max(md, 0.), 300.) * uMoonVis * .25 * uNight;
  if (md > .999 && uMoonVis > .001) {
    vec3 t1 = normalize(cross(uMoonDir, vec3(1e-4, 1., 0.))); vec3 t2 = cross(t1, uMoonDir);
    vec2 q = vec2(dot(d - uMoonDir, t1), dot(d - uMoonDir, t2)) / .02;
    float rr = dot(q, q);
    if (rr < 1.) {
      vec3 n = vec3(q, sqrt(1. - rr)); float a = uPhase * 6.2831853;
      float lit = smoothstep(-.06, .06, dot(n, vec3(sin(a), 0., -cos(a))));
      float mare = .78 + .22 * vnoise(q * 3. + 7.);
      vec3 moonC = vec3(1., .97, .9) * mix(.35, 2.2, uNight) * mare * lit;
      col = mix(col, moonC + col * mix(.9, .4, uNight), uMoonVis * (1. - smoothstep(.9, 1., rr)));
    }
  }

  if (h > 0.) {
    vec2 uv = d.xz / (h + .12) * .9 + uTime * vec2(.012, .005);
    float n = fbm2(uv * 1.6), n2 = fbm2(uv * 4. + n);
    float cov = smoothstep(1.05 - uCloud, 1.35 - uCloud * .8, n + n2 * .35);
    vec3 cc = uCloudCol * (.75 + .5 * n2) + uGlowCol * uGlow * pow(sd, 4.) * .5;
    col = mix(col, cc, cov * smoothstep(0., .12, h));
  }
  col = mix(col, uFogCol, uFog);
  col += uFlash * vec3(.8, .85, 1.);
  gl_FragColor = vec4(col, 1.);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export function createSky() {
  const C = () => ({ value: new THREE.Color() }), V = () => ({ value: new THREE.Vector3(0, 1, 0) }), F = v => ({ value: v });
  const uniforms = {
    uZen: C(), uHor: C(), uSunDir: V(), uSunCol: C(), uMoonDir: V(), uGlowCol: C(), uCloudCol: C(), uFogCol: C(),
    uSunVis: F(0), uMoonVis: F(0), uNight: F(0), uPhase: F(0), uStars: F(0), uCloud: F(0), uTime: F(0), uGlow: F(0), uFog: F(0), uFlash: F(0),
  };
  const opts = { vertexShader: VS, fragmentShader: FS, side: THREE.BackSide, depthWrite: false, fog: false };
  const mat = new THREE.ShaderMaterial({ ...opts, uniforms: { ...uniforms, uDisc: F(1) } });
  // 环境光照用的天空不画太阳圆盘，否则金属铜钱会反射出刺眼的光点
  const envMat = new THREE.ShaderMaterial({ ...opts, uniforms: { ...uniforms, uDisc: F(.04) } });
  const geo = new THREE.SphereGeometry(60, 48, 24);
  const mesh = new THREE.Mesh(geo, mat); mesh.frustumCulled = false; mesh.renderOrder = -1;
  const envMesh = new THREE.Mesh(geo, envMat); envMesh.frustumCulled = false;
  return { mesh, envMesh, uniforms };
}
