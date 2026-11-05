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

export class Rain {
  constructor(groundAt, onHit, count = 2600) {
    this.g = groundAt; this.hit = onHit; this.n = count; this.d = [];
    this.pos = new Float32Array(count * 6);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setDrawRange(0, 0);
    this.mat = new THREE.LineBasicMaterial({ color: 0xc0cad8, transparent: true, opacity: .35, depthWrite: false });
    this.obj = new THREE.LineSegments(this.geo, this.mat); this.obj.frustumCulled = false;
    for (let i = 0; i < count; i++) { const d = {}; this.spawn(d, false); this.d.push(d); }
  }
  spawn(d, top) {
    d.x = rand(-10, 10); d.z = rand(-11, 8); d.y = top ? rand(9, 12) : rand(0, 12);
    d.v = rand(10, 13); d.gy = this.g(d.x, d.z);
  }
  update(dt, amount, wind, light) {
    const n = Math.floor(amount * this.n), p = this.pos, wx = wind * 3, L = .5;
    for (let i = 0; i < n; i++) {
      const d = this.d[i];
      d.y -= d.v * dt; d.x += wx * dt;
      if (d.y < d.gy) { this.hit(d.x, d.z); this.spawn(d, true); }
      const j = i * 6;
      p[j] = d.x; p[j + 1] = d.y; p[j + 2] = d.z;
      p[j + 3] = d.x - wx / d.v * L; p[j + 4] = d.y + L; p[j + 5] = d.z;
    }
    this.geo.setDrawRange(0, n * 2);
    this.geo.attributes.position.needsUpdate = true;
    this.obj.visible = n > 0;
    this.mat.color.setRGB(.75, .8, .88).multiplyScalar(.25 + .75 * light);
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
    d.x = rand(-10, 10); d.z = rand(-11, 8); d.y = top ? rand(8, 10) : rand(0, 10);
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
