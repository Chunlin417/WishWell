// 小殿里面：一方浅水池，池边一圈白卵石；池子靠后的苔石上端坐着一尊青铜猫像，水面映着它的倒影，水光晃在顶棚上。
// 殿的墙、窗、门在 courtyard.js；这里只做池子里外的东西
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { NOISE_GLSL } from './shaders.js';
import { createSanctuary } from './hallSanctuary.js';
import { statueMat } from './courtyardMats.js';

const BASE = `${import.meta.env.BASE_URL}models/`;
export const REFLECT_LAYER = 1;   // 水面倒影只画这一层的东西（殿本身、猫像、天空），院子里的树和草不画
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
          vec3 N = normalize(vec3(-g.x * .004, 1., -g.y * .004));
          vec3 V = normalize(cameraPosition - vWp);
          float fres = mix(.23, .92, pow(1. - max(dot(N, V), 0.), 2.4));
          vec4 uv = vUv; uv.xy += N.xz * .045 * uv.w;
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
export function createHallInterior({ parent, tex, manager, camera, baseH, pool, statue, room, floorMat, isMobile = false }) {
  const { halfX, front, back, depth, drop, border } = pool, waterY = baseH - drop, w = halfX * 2, d = front - back, cz = (front + back) / 2;
  const put = (o, x, y, z, { cast = true, recv = true } = {}) => { o.position.set(x, y, z); o.castShadow = cast; o.receiveShadow = recv; parent.add(o); return o; };
  const flat = (pw, pd, m, x, y, z) => { const o = put(new THREE.Mesh(new THREE.PlaneGeometry(pw, pd), m), x, y, z, { cast: false }); o.rotation.x = -Math.PI / 2; return o; };

  // 池底（和殿里的地面一样的石板）
  flat(w, d, floorMat, 0, baseH - depth, cz);

  // 池边的一圈卵石：下面垫一层卵石贴图（缝里不露石板），上面是一颗颗立体的石头
  const sanctuary = createSanctuary({ parent, tex, manager, baseH, room, pool, statue });

  const bronze = statueMat();
  const ready = new GLTFLoader(manager).loadAsync(BASE + 'temple_cat.glb').then(gltf => {
    const cat = gltf.scene.children[0];
    cat.traverse(o => { if (o.isMesh) { o.material = bronze; o.castShadow = o.receiveShadow = true; o.layers.enable(REFLECT_LAYER); } });
    cat.scale.setScalar(statue.scale); cat.position.set(0, sanctuary.statueY, statue.z + .02);
    parent.add(cat);
  }).catch(e => console.warn('猫像没有加载出来', e));

  // 水面和它的倒影。倒影不在正式画的过程中现画（那样每种材质每帧要换两次灯光，很慢），而是每帧开头单独画一遍（见 preRender）
  const water = put(createWater(w, d, isMobile ? 512 : 768), 0, waterY, cz, { cast: false, recv: false });
  water.getReflectionCamera(camera).layers.set(REFLECT_LAYER);
  water.updateMatrixWorld(true);
  const drawReflection = water.onBeforeRender; water.onBeforeRender = () => {};
  const reflRT = water.getRenderTarget(), corners = [[-1, front], [1, front], [1, back], [-1, back]].map(([s, z]) => new THREE.Vector3(s * halfX, waterY, z)), v = new THREE.Vector3();

  // 顶棚和后墙上的水光
  return {
    ready,
    update(t) { water.material.uniforms.uTime.value = t; },
    // 每帧正式画之前调用：画水面的倒影。水池不在画面里、或者离得远（8 米开外水面只剩一条线）时不画；
    // 画的时候也只画水面在画面上占的那一小块（倒影的画面是左右镜像的，所以这一块的 x 要反过来），其余的像素不用算
    preRender(renderer, scene) {
      camera.updateMatrixWorld();
      const k = 1 - THREE.MathUtils.smoothstep(Math.hypot(camera.position.x, camera.position.z - cz), 16, 24);
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
