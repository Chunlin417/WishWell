// 小殿里面：一方浅水池，池边一圈白卵石；池子靠后的苔石上端坐着一尊青铜猫像，水面映着它的倒影，水光晃在顶棚上。
// 殿的墙、窗、门在 courtyard.js；这里只做池子里外的东西
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { NOISE_GLSL } from './shaders.js';
import { triMat, statueMat } from './courtyardMats.js';

const BASE = `${import.meta.env.BASE_URL}models/`;
export const REFLECT_LAYER = 1;   // 水面倒影只画这一层的东西（殿本身、猫像、天空），院子里的树和草不画
const rng = seed => () => (seed = (seed * 16807) % 2147483647) / 2147483647;

// 猫像坐的石头：一块扁而宽的天然石头，顶上是略有起伏的平台，底部削平。rx / rz：两个方向的半径，h：平台的高度
function seatRockGeo(rx, rz, h, seed, detail = 4) {
  const g = mergeVertices(new THREE.IcosahedronGeometry(1, detail).deleteAttribute('uv').deleteAttribute('normal')), p = g.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = Math.sin(v.x * 2.3 + seed) * Math.sin(v.y * 2.9 + seed * 1.7) * Math.sin(v.z * 2.1 + seed * .6) * .16 + Math.sin(v.x * 5.3 + v.z * 4.1 + seed * 2.3) * .045 + Math.sin(v.x * 9.1 - v.z * 7.7 + seed) * .018;
    v.multiplyScalar(1 + n);
    let y = v.y * h * 1.4;
    if (y > h * .92) y = h * .92 + (y - h * .92) * .16;   // 压出顶上的平台
    p.setXYZ(i, v.x * rx, Math.max(y, -h * .45), v.z * rz);
  }
  g.computeVertexNormals();
  return g;
}

// 池边的卵石：一圈压扁的圆石头，大小、深浅各不相同。rect：[x0, x1, z0, z1] 是水池的范围，卵石铺在它外面 border 宽的一圈里
function createPebbles(rect, border, y, count, seed = 7) {
  const [x0, x1, z0, z1] = rect, R = rng(seed), w = x1 - x0, d = z1 - z0, per = 2 * (w + d) + 4 * border;
  const geo = mergeVertices(new THREE.IcosahedronGeometry(1, 1).deleteAttribute('uv').deleteAttribute('normal')); geo.computeVertexNormals();
  const im = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ roughness: .62 }), count);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(), p = new THREE.Vector3(), col = new THREE.Color();
  for (let i = 0; i < count; i++) {
    // 沿着这一圈走 t 米，再往外偏 o 米（靠水的一侧稍微探出池沿）
    let t = R() * per; const o = -.03 + Math.pow(R(), .8) * (border + .02), a = .034 + R() * R() * .05;
    if (t < w + 2 * border) p.set(x0 - border + t, 0, z1 + o);
    else if ((t -= w + 2 * border) < w + 2 * border) p.set(x0 - border + t, 0, z0 - o);
    else if ((t -= w + 2 * border) < d) p.set(x0 - o, 0, z0 + t);
    else p.set(x1 + o, 0, z0 + t - d);
    const flat = .42 + R() * .25;
    p.y = y + a * flat * .7 + R() * .022;
    m.compose(p, q.setFromEuler(e.set((R() - .5) * .5, R() * 6.283, (R() - .5) * .5)), s.set(a, a * flat, a * (.62 + R() * .3)));
    im.setMatrixAt(i, m);
    const k = R(), l = .32 + R() * .34;   // 多数是米白、浅灰，少数偏黄褐或青灰
    im.setColorAt(i, k < .62 ? col.setRGB(l, l * .97, l * .9) : k < .85 ? col.setRGB(l * .86, l * .8, l * .68) : col.setRGB(l * .62, l * .68, l * .66));
  }
  im.castShadow = false; im.receiveShadow = true;
  return im;
}

// 水面：真实的倒影（把殿里的东西从水下再画一遍）+ 缓缓起伏的细波；正着往下看是透明的，能看到池底，越斜着看倒影越清楚
function createWater(w, d, size) {
  const water = new Reflector(new THREE.PlaneGeometry(w, d), {
    textureWidth: size, textureHeight: size, clipBias: .003, multisample: 0, color: 0x2a4a38,
    shader: {
      name: 'HallWater',
      uniforms: { color: { value: null }, tDiffuse: { value: null }, textureMatrix: { value: null }, uTime: { value: 0 }, uRefl: { value: 1 } },
      vertexShader: /* glsl */`
        uniform mat4 textureMatrix; varying vec4 vUv; varying vec3 vWp;
        void main(){
          vUv = textureMatrix * vec4(position, 1.);
          vWp = (modelMatrix * vec4(position, 1.)).xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.);
        }`,
      fragmentShader: /* glsl */`
        uniform vec3 color; uniform sampler2D tDiffuse; uniform float uTime, uRefl; varying vec4 vUv; varying vec3 vWp;
        ${NOISE_GLSL}
        float h(vec2 p){ return vnoise(p * 2.4 + vec2(uTime * .1, uTime * .06)) * .62 + vnoise(p * 6.1 - vec2(uTime * .12, -uTime * .08)) * .38; }
        void main(){
          vec2 p = vWp.xz; const float e = .04;
          vec2 g = vec2(h(p + vec2(e, 0.)) - h(p - vec2(e, 0.)), h(p + vec2(0., e)) - h(p - vec2(0., e))) / (2. * e);   // 水面的坡度
          vec3 N = normalize(vec3(-g.x * .012, 1., -g.y * .012));
          vec3 V = normalize(cameraPosition - vWp);
          float fres = mix(.23, .92, pow(1. - max(dot(N, V), 0.), 2.4));
          vec4 uv = vUv; uv.xy += N.xz * .18 * uv.w;
          vec3 sampleColor = texture2DProj(tDiffuse, uv).rgb;
          // Compress reflected highlights smoothly before bloom.
          sampleColor /= 1. + max(vec3(0.), sampleColor - 1.4) * .3;
          vec3 refl = mix(vec3(.05, .04, .03), sampleColor, uRefl);
          float a = fres + (1. - fres) * .34;
          gl_FragColor = vec4((refl * fres + color * (1. - fres) * .34) / a, a);
        }`,
    },
  });
  water.material.transparent = true; water.material.depthWrite = false;
  water.rotation.x = -Math.PI / 2; water.renderOrder = 3;
  return water;
}

// 水光：水面反上来的光在顶棚（和后墙的上半截）晃动的网纹。center / half：水池中心和它照到的范围（x、z 两个方向各多远）
function createCaustics(center, half, y0, y1) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    uniforms: { uTime: { value: 0 }, uC: { value: new THREE.Vector4(center.x, center.z, half.x, half.z) }, uY: { value: new THREE.Vector2(y0, y1) }, uCol: { value: new THREE.Color(1, .83, .6).multiplyScalar(.075) } },
    vertexShader: /* glsl */`varying vec3 vWp; void main(){ vWp = (modelMatrix * vec4(position, 1.)).xyz; gl_Position = projectionMatrix * viewMatrix * vec4(vWp, 1.); }`,
    fragmentShader: /* glsl */`
      uniform float uTime; uniform vec4 uC; uniform vec2 uY; uniform vec3 uCol; varying vec3 vWp;
      ${NOISE_GLSL}
      // 水面焦散的网纹：一格格不规则的亮线（细胞噪声里离最近两个格点一样远的地方），格点缓缓游动，网也跟着变形
      float net(vec2 p, float t){
        vec2 i = floor(p), f = fract(p); float d1 = 8., d2 = 8.;
        for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
          vec2 g = vec2(float(x), float(y)), r = g + .5 + .4 * sin(t + 6.2831853 * hash22(i + g)) - f; float d = dot(r, r);
          if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
        }
        float e = sqrt(d2) - sqrt(d1);
        return pow(1. - smoothstep(0., .3, e), 4.) + .12 * (1. - smoothstep(0., .8, e));   // 一道细亮线 + 两边淡淡的晕
      }
      void main(){
        vec2 q = vec2(vWp.x, vWp.z + vWp.y * .7);
        q += (vec2(vnoise(q * 1.3 + uTime * .07), vnoise(q * 1.3 + 7.3 - uTime * .06)) - .5) * .5;   // 整张网缓缓扭动
        float c = net(q * 2.1, uTime * .18) * .62 + net(q * 3.3 + 3.7, uTime * .23 + 2.) * .25;
        c *= .55 + .45 * vnoise(q * .65 + uTime * .025);
        float m = (1. - smoothstep(.5, 1., length((vWp.xz - uC.xy) / uC.zw))) * smoothstep(uY.x, uY.y, vWp.y);   // 只在水池上方；后墙上越往下越淡
        gl_FragColor = vec4(uCol * c * m, 1.);
      }`,
  });
}

// pool：{ halfX, front, back, depth, drop, border }（见 courtyard.js 的布局）；statue：{ z, scale }；room：{ halfX, front, back, top }（殿内的范围和顶棚高度）
// floorMat：殿里的石板地（池底也用它）；camera：院子的镜头（水面倒影要一台对应的"水下镜头"）
export function createHallInterior({ parent, tex, manager, camera, baseH, pool, statue, room, floorMat, isMobile = false }) {
  const { halfX, front, back, depth, drop, border } = pool, waterY = baseH - drop, w = halfX * 2, d = front - back, cz = (front + back) / 2;
  const put = (o, x, y, z, { cast = true, recv = true } = {}) => { o.position.set(x, y, z); o.castShadow = cast; o.receiveShadow = recv; parent.add(o); return o; };
  const flat = (pw, pd, m, x, y, z) => { const o = put(new THREE.Mesh(new THREE.PlaneGeometry(pw, pd), m), x, y, z, { cast: false }); o.rotation.x = -Math.PI / 2; return o; };

  // 池底（和殿里的地面一样的石板）
  flat(w, d, floorMat, 0, baseH - depth, cz);

  // 池边的一圈卵石：下面垫一层卵石贴图（缝里不露石板），上面是一颗颗立体的石头
  const gravel = triMat({ set: tex.pebbles, scale: 1.5, color: 0xd9d2c4 });
  gravel.color.multiplyScalar(1.2);
  const by = baseH + .01;
  for (const s of [-1, 1]) {
    flat(w + border * 2, border, gravel, 0, by, s > 0 ? front + border / 2 : back - border / 2);
    flat(border, d, gravel, s * (halfX + border / 2), by, cz);
  }
  const pebbles = put(createPebbles([-halfX, halfX, back, front], border, by, isMobile ? 720 : 1300), 0, 0, 0, { cast: false });
  pebbles.userData.noReflect = true;   // 倒影里不画卵石（太小，看不出来）

  // 苔石：一半泡在水里，顶上是猫像；池角再堆两小团青苔
  const rockMat = triMat({ set: tex.rock, moss: tex.moss, scale: .72, mossAmt: .86, mossAt: .42, mossScale: 1.2, grime: .5, roughMul: 1.15 });
  rockMat.color.setScalar(1.35);
  const seatScale = statue.scale / 1.25;
  const rockH = (depth - drop + .36 * Math.sqrt(seatScale)) / 1.37, rockY = baseH - depth + rockH * .45;   // 石头底面落在池底，顶上的平台高出水面 0.36 米
  put(new THREE.Mesh(seatRockGeo(1.15 * seatScale, .8 * seatScale, rockH, 3.7), rockMat), 0, rockY, statue.z);
  const mossMat = triMat({ set: tex.rock, moss: tex.moss, scale: .6, mossAmt: 1, mossAt: -.4, mossScale: 1.3 });
  for (const [x, z, r, sd] of [[-halfX - .12, front + .1, .26, 1.3], [halfX + .1, front + .14, .2, 4.1], [halfX - .5, back - .08, .17, 6.2]])
    put(new THREE.Mesh(seatRockGeo(r * 1.2, r, .1, sd, 2), mossMat), x, baseH + .03, z, { cast: false });

  // 猫像（scripts/build-cat.mjs 雕出来的模型）：青铜，凸起的卷草纹露着铜色
  const bronze = statueMat();
  const ready = new GLTFLoader(manager).loadAsync(BASE + 'temple_cat.glb').then(gltf => {
    const cat = gltf.scene.children[0];
    cat.traverse(o => { if (o.isMesh) { o.material = bronze; o.castShadow = o.receiveShadow = true; o.layers.enable(REFLECT_LAYER); } });
    cat.scale.setScalar(statue.scale); cat.position.set(0, rockY + rockH * .94, statue.z + .02);
    parent.add(cat);
  }).catch(e => console.warn('猫像没有加载出来', e));

  // 水面和它的倒影。倒影不在正式画的过程中现画（那样每种材质每帧要换两次灯光，很慢），而是每帧开头单独画一遍（见 preRender）
  const water = put(createWater(w, d, isMobile ? 512 : 768), 0, waterY, cz, { cast: false, recv: false });
  water.getReflectionCamera(camera).layers.set(REFLECT_LAYER);
  water.updateMatrixWorld(true);
  const drawReflection = water.onBeforeRender; water.onBeforeRender = () => {};
  const reflRT = water.getRenderTarget(), corners = [[-1, front], [1, front], [1, back], [-1, back]].map(([s, z]) => new THREE.Vector3(s * halfX, waterY, z)), v = new THREE.Vector3();

  // 顶棚和后墙上的水光
  const caus = createCaustics({ x: 0, z: cz }, { x: halfX + 2.1, z: d / 2 + 2 }, baseH + 1.5, room.top);
  const ceil = put(new THREE.Mesh(new THREE.PlaneGeometry(room.halfX * 2, room.front - room.back), caus), 0, room.top - .035, (room.front + room.back) / 2, { cast: false, recv: false });
  ceil.rotation.x = Math.PI / 2;
  put(new THREE.Mesh(new THREE.PlaneGeometry(room.halfX * 2, room.top - baseH - 1.2), caus), 0, (room.top + baseH + 1.2) / 2, room.back + .035, { cast: false, recv: false });

  return {
    ready,
    update(t) { water.material.uniforms.uTime.value = t; caus.uniforms.uTime.value = t; },
    // 每帧正式画之前调用：画水面的倒影。水池不在画面里、或者离得远（8 米开外水面只剩一条线）时不画；
    // 画的时候也只画水面在画面上占的那一小块（倒影的画面是左右镜像的，所以这一块的 x 要反过来），其余的像素不用算
    preRender(renderer, scene) {
      camera.updateMatrixWorld();
      const k = 1 - THREE.MathUtils.smoothstep(Math.hypot(camera.position.x, camera.position.z - cz), 7.5, 10);
      water.material.uniforms.uRefl.value = k;
      if (k <= 0) return;
      let x0 = 1, x1 = -1, y0 = 1, y1 = -1, whole = false;
      for (const c of corners) {
        v.copy(c).applyMatrix4(camera.matrixWorldInverse);
        if (v.z > -camera.near * 2) { whole = true; break; }   // 有一个角在镜头后面：算不出范围，整张都画
        v.applyMatrix4(camera.projectionMatrix);
        x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x); y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y);
      }
      const S = reflRT.width, pad = S * .05, px = t => Math.max(0, Math.min(S, Math.round((t * .5 + .5) * S)));   // pad：水波会把倒影晃出去一点
      if (whole) reflRT.scissor.set(0, 0, S, S);
      else {
        const sx0 = px(-x1 - pad * 2 / S), sx1 = px(-x0 + pad * 2 / S), sy0 = px(y0 - pad * 2 / S), sy1 = px(y1 + pad * 2 / S);
        if (sx1 <= sx0 || sy1 <= sy0) return;
        reflRT.scissor.set(sx0, sy0, sx1 - sx0, sy1 - sy0);
      }
      reflRT.scissorTest = true;
      drawReflection.call(water, renderer, scene, camera);
    },
  };
}
