// 天气粒子：雨、雪、萤火虫
import * as THREE from 'three';

const rand = (a, b) => a + Math.random() * (b - a);

function dotTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(.4, 'rgba(255,255,255,.6)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const DOT = dotTexture();

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
      const m = new THREE.SpriteMaterial({ map: DOT, color: new THREE.Color(.85, 1, .55).multiplyScalar(5), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false, opacity: 0 });
      const s = new THREE.Sprite(m); s.scale.setScalar(.12); s.position.copy(base);
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
