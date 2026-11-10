// 天气粒子：雨、雪、萤火虫、飘落的枫叶
import * as THREE from 'three';
import { patch } from './patch.js';

const rand = (a, b) => a + Math.random() * (b - a);

function dotTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(.4, 'rgba(255,255,255,.6)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const DOT = dotTexture();
// 萤火虫的光：一个很小的亮核 + 一圈很淡、很宽的光晕（不是一整块白色圆片）
function glowTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(.07, 'rgba(255,255,255,.85)'); gr.addColorStop(.16, 'rgba(255,255,255,.22)');
  gr.addColorStop(.4, 'rgba(255,255,255,.06)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const GLOW = glowTexture();

// 雨丝：细而淡的线，雨滴那一头稍亮、尾巴渐隐，看起来像高速下落的模糊；落地时溅起细小的水花
const RAIN_VS = /* glsl */`
attribute float aA; varying float vA;
void main(){ vA = aA; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`;
const RAIN_FS = /* glsl */`
uniform vec3 uColor; uniform float uOpacity; varying float vA;
void main(){ gl_FragColor = vec4(uColor, vA * uOpacity);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
const SPLASH_VS = /* glsl */`
attribute float aLife; uniform float uScale; varying float vLife;
void main(){ vLife = aLife; vec4 mv = modelViewMatrix * vec4(position, 1.);
  gl_PointSize = (.03 + .08 * (1. - aLife)) * uScale / -mv.z; gl_Position = projectionMatrix * mv; }`;
const SPLASH_FS = /* glsl */`
uniform vec3 uColor; uniform float uOpacity; varying float vLife;
void main(){ vec2 q = gl_PointCoord - .5; float r = length(q);
  float ring = smoothstep(.5, .35, r) * smoothstep(.1, .3, r);   // 一圈小小的水花
  gl_FragColor = vec4(uColor, ring * vLife * uOpacity);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export class Rain {
  constructor(groundAt, onHit, count = 2600) {
    this.g = groundAt; this.hit = onHit; this.n = count; this.d = [];
    this.pos = new Float32Array(count * 6);
    const alpha = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) { alpha[i * 2] = 1; alpha[i * 2 + 1] = 0; }
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aA', new THREE.BufferAttribute(alpha, 1));
    this.geo.setDrawRange(0, 0);
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(.75, .8, .88) }, uOpacity: { value: .15 } },
      vertexShader: RAIN_VS, fragmentShader: RAIN_FS, transparent: true, depthWrite: false,
    });
    this.obj = new THREE.Group();
    this.lines = new THREE.LineSegments(this.geo, this.mat); this.lines.frustumCulled = false;
    this.obj.add(this.lines);
    // 落地的水花
    const SN = 400;
    this.sp = new Float32Array(SN * 3); this.life = new Float32Array(SN); this.si = 0;
    this.sgeo = new THREE.BufferGeometry();
    this.sgeo.setAttribute('position', new THREE.BufferAttribute(this.sp, 3).setUsage(THREE.DynamicDrawUsage));
    this.sgeo.setAttribute('aLife', new THREE.BufferAttribute(this.life, 1).setUsage(THREE.DynamicDrawUsage));
    this.smat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(.8, .85, .92) }, uOpacity: { value: .45 }, uScale: { value: 400 } },
      vertexShader: SPLASH_VS, fragmentShader: SPLASH_FS, transparent: true, depthWrite: false,
    });
    this.splash = new THREE.Points(this.sgeo, this.smat); this.splash.frustumCulled = false;
    this.obj.add(this.splash);
    for (let i = 0; i < count; i++) { const d = {}; this.spawn(d, false); this.d.push(d); }
  }
  spawn(d, top) {
    // 雨只在镜头下方生成：离镜头太近的雨滴会被拉成又长又亮的白线
    d.x = rand(-10, 10); d.z = rand(-11, 8); d.y = top ? rand(5, 6) : rand(0, 6);
    d.v = rand(10, 13); d.gy = this.g(d.x, d.z);
  }
  update(dt, amount, wind, light) {
    const n = Math.floor(amount * this.n), p = this.pos, wx = wind * 3, L = .45;
    const SN = this.life.length;
    for (let k = 0; k < SN; k++) this.life[k] = Math.max(0, this.life[k] - dt * 6);   // 水花约 0.17 秒消失
    for (let i = 0; i < n; i++) {
      const d = this.d[i];
      d.y -= d.v * dt; d.x += wx * dt;
      if (d.y < d.gy) {
        this.hit(d.x, d.z);
        if (d.gy > .01 && Math.random() < .5) {   // 落在地上（不是水面）才溅水花
          const s = this.si = (this.si + 1) % SN;
          this.sp[s * 3] = d.x; this.sp[s * 3 + 1] = d.gy + .02; this.sp[s * 3 + 2] = d.z; this.life[s] = 1;
        }
        this.spawn(d, true);
      }
      const j = i * 6;
      p[j] = d.x; p[j + 1] = d.y; p[j + 2] = d.z;
      p[j + 3] = d.x - wx / d.v * L; p[j + 4] = d.y + L; p[j + 5] = d.z;
    }
    this.geo.setDrawRange(0, n * 2);
    this.geo.attributes.position.needsUpdate = true;
    this.sgeo.attributes.position.needsUpdate = true; this.sgeo.attributes.aLife.needsUpdate = true;
    this.obj.visible = n > 0;
    const k = .25 + .75 * light;
    this.mat.uniforms.uColor.value.setRGB(.72, .78, .86).multiplyScalar(k);
    this.smat.uniforms.uColor.value.setRGB(.8, .85, .92).multiplyScalar(k);
    this.smat.uniforms.uScale.value = innerHeight * Math.min(devicePixelRatio || 1, 2) * .5;
  }
}

export class Snow {
  constructor(groundAt, count = 3500) {
    this.g = groundAt; this.n = count; this.d = [];
    this.pos = new Float32Array(count * 3);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setDrawRange(0, 0);
    this.mat = new THREE.PointsMaterial({ size: .07, map: DOT, transparent: true, depthWrite: false, color: 0xffffff });
    this.obj = new THREE.Points(this.geo, this.mat); this.obj.frustumCulled = false;
    for (let i = 0; i < count; i++) { const d = {}; this.spawn(d, false); this.d.push(d); }
  }
  spawn(d, top) {
    d.x = rand(-10, 10); d.z = rand(-11, 8); d.y = top ? rand(5, 6) : rand(0, 6);   // 也只在镜头下方，不会有雪花贴在镜头前
    d.v = rand(.6, 1.1); d.p = rand(0, 6.28); d.gy = this.g(d.x, d.z);
  }
  update(dt, amount, wind, T, light) {
    const n = Math.floor(amount * this.n), p = this.pos;
    for (let i = 0; i < n; i++) {
      const d = this.d[i];
      d.y -= d.v * dt;
      d.x += (Math.sin(T * .8 + d.p) * .25 + wind * .8) * dt;
      d.z += Math.cos(T * .6 + d.p * 1.7) * .15 * dt;
      if (d.y < d.gy) this.spawn(d, true);
      p[i * 3] = d.x; p[i * 3 + 1] = d.y; p[i * 3 + 2] = d.z;
    }
    this.geo.setDrawRange(0, n);
    this.geo.attributes.position.needsUpdate = true;
    this.obj.visible = n > 0;
    this.mat.color.setScalar(.3 + .7 * light);
  }
}

export class Fireflies {
  constructor(spots) {
    this.obj = new THREE.Group();
    this.items = spots.map(base => {
      // 颜色不再乘 5：太亮会被泛光吹成白色；黄绿色、亮度适中，光晕交给贴图
      const m = new THREE.SpriteMaterial({ map: GLOW, color: new THREE.Color(.75, 1, .35).multiplyScalar(1.8), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false, opacity: 0 });
      const s = new THREE.Sprite(m); s.scale.setScalar(.16); s.position.copy(base);
      this.obj.add(s);
      return { s, base, p: rand(0, 6.28) };
    });
    this.obj.visible = false;
  }
  update(T, amount) {
    this.obj.visible = amount > .01;
    if (!this.obj.visible) return;
    for (const f of this.items) {
      f.s.position.set(
        f.base.x + Math.sin(T * .4 + f.p) * .4,
        f.base.y + Math.sin(T * .7 + f.p * 2) * .15,
        f.base.z + Math.cos(T * .33 + f.p) * .4);
      f.s.material.opacity = amount * Math.pow(.5 + .5 * Math.sin(T * 2.1 + f.p * 3), 3);
    }
  }
}

// 秋天飘落的枫叶：几十片红叶 / 橙叶从高处缓缓落下，一边左右摆动一边翻转；落在水面上会荡开一圈很小的涟漪，落在地上就在上面重新生成。
// 用落叶图集（leaves_atlas）里的第 0、1 行（暗红、橙黄枫叶）；一个 InstancedMesh，每片自带它在图集里的 uv（aCell）
export class FallingLeaves {
  constructor({ map, cells, groundAt, onWater, count = 30 }) {
    this.g = groundAt; this.onWater = onWater; this.n = count; this.d = [];
    const geo = new THREE.PlaneGeometry(1, 1, 3, 3); geo.rotateX(-Math.PI / 2);
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) p.setY(i, (p.getX(i) ** 2 + p.getZ(i) ** 2) * .5);   // 略微卷翘
    geo.computeVertexNormals();
    this.cell = new Float32Array(count * 4);
    geo.setAttribute('aCell', new THREE.InstancedBufferAttribute(this.cell, 4));
    const mat = patch(new THREE.MeshStandardMaterial({ map, alphaTest: .5, side: THREE.DoubleSide, roughness: .8 }), { cell: 'flat', underwater: false });
    this.mesh = new THREE.InstancedMesh(geo, mat, count);
    this.mesh.frustumCulled = false; this.mesh.count = 0;
    this.obj = this.mesh;
    this.dummy = new THREE.Object3D();
    for (let i = 0; i < count; i++) {
      const d = { i }; this.spawn(d, false);
      const [u0, v0, u1, v1] = cells[Math.floor(Math.random() * 2)][Math.floor(Math.random() * 5)].uv;   // 暗红或橙黄的一片
      this.cell.set([u0, v0, u1 - u0, v1 - v0], i * 4);
      this.d.push(d);
    }
    geo.attributes.aCell.needsUpdate = true;
  }
  spawn(d, top) {
    // 主要落在池子和石圈附近（镜头看得见的地方），高度错开，不会同时落下
    d.x = rand(-6, 6); d.z = rand(-5, 6); d.y = top ? rand(5, 7) : rand(0, 7);
    d.v = rand(.28, .5); d.p = rand(0, 6.28); d.s = rand(.16, .26); d.spin = rand(.6, 1.6) * (Math.random() < .5 ? -1 : 1);
  }
  update(dt, amount, wind, T) {
    const n = Math.floor(amount * this.n), o = this.dummy;
    for (let i = 0; i < n; i++) {
      const d = this.d[i];
      d.y -= d.v * dt;
      d.x += (Math.sin(T * .9 + d.p) * .35 + wind * .8) * dt;
      d.z += Math.cos(T * .7 + d.p * 1.7) * .25 * dt;
      const gy = this.g(d.x, d.z);
      if (d.y < gy + .02) {
        if (gy <= .01) this.onWater?.(d.x, d.z);   // 落在水面上
        this.spawn(d, true);
      }
      o.position.set(d.x, d.y, d.z);
      o.rotation.set(Math.sin(T * 1.7 + d.p) * .9, T * d.spin + d.p, Math.cos(T * 1.3 + d.p * 2) * .9);   // 翻转着飘落
      o.scale.setScalar(d.s); o.updateMatrix();
      this.mesh.setMatrixAt(i, o.matrix);
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.visible = n > 0;
  }
}
