import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { triMat } from './courtyardMats.js';

// Architectural details share materials and geometry; relief is real shallow geometry.
export function createSanctuary({ parent, tex, manager, baseH, room, pool, statue }) {
  const stone = triMat({ set: tex.rock, scale: .85, color: 0xd5cbb4, roughMul: 1.2, norK: .28 });
  stone.color.multiplyScalar(1.7);
  const wood = triMat({ set: tex.wood, scale: .62, color: 0xc0a98a, wood: true, norK: .4 });
  wood.color.multiplyScalar(1.7);
  const dark = wood.clone(); dark.color.multiplyScalar(.65);
  const brass = new THREE.MeshStandardMaterial({ color: 0x9b8050, metalness: .65, roughness: .65 });
  const clay = new THREE.MeshStandardMaterial({ color: 0x677b72, roughness: .92 });
  const paper = new THREE.MeshStandardMaterial({ color: 0xb7a381, roughness: 1 });
  const unit = new THREE.BoxGeometry(1, 1, 1);
  const box = (w, h, d, m, x, y, z, target = parent) => {
    const o = new THREE.Mesh(unit, m); o.scale.set(w, h, d); o.position.set(x, y, z);
    o.castShadow = o.receiveShadow = true; target.add(o); return o;
  };
  const rounded = (w, h, d, x, y, z) => {
    const o = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 2, .035), stone);
    o.position.set(x, y, z); o.castShadow = o.receiveShadow = true; parent.add(o); return o;
  };
  // Coping hides the foundation edge; inner faces continue beneath water level.
  const mid = (pool.front + pool.back) / 2, length = pool.front - pool.back;
  for (const s of [-1, 1]) {
    rounded(.24, .14, length + .48, s * (pool.halfX + .12), baseH + .025, mid);
    box(.08, pool.depth, length, stone, s * (pool.halfX + .015), baseH - pool.depth / 2, mid);
  }
  for (const z of [pool.front, pool.back]) rounded(pool.halfX * 2, .14, .24, 0, baseH + .025, z);
  rounded(3.9, .15, 2.1, 0, baseH + .075, statue.z);
  rounded(3.5, .28, 1.85, 0, baseH + .29, statue.z);
  const moss = triMat({ set: tex.rock, moss: tex.moss, scale: 1.1, color: 0xc8c1a5, mossAmt: .4, mossAt: .7, norK: .5 });
  moss.color.multiplyScalar(1.6);
  box(3.36, .09, 1.72, moss, 0, baseH + .475, statue.z);

  // Bespoke mineral-pigment mural. The same restrained image drives a very
  // shallow bump response, so side light reveals carving without looking like
  // a glossy printed poster.
  const muralMap = new THREE.TextureLoader(manager).load(`${import.meta.env.BASE_URL}textures/hall_guardian_mural.svg`);
  muralMap.colorSpace = THREE.SRGBColorSpace;
  muralMap.anisotropy = 8;
  muralMap.wrapS = muralMap.wrapT = THREE.ClampToEdgeWrapping;
  const plaster = new THREE.MeshStandardMaterial({
    map: muralMap,
    bumpMap: muralMap,
    bumpScale: .026,
    color: 0xd8d0c1,
    roughness: .96,
    metalness: 0,
  });
  const panelW = 8.1, panelH = 3.0, py = baseH + 2.72, pz = room.back + .16;
  box(panelW, panelH, .11, plaster, 0, py, pz);
  for (const s of [-1, 1]) {
    box(panelW + .18, .09, .17, wood, 0, py + s * (panelH / 2 + .045), pz + .015);
    box(.09, panelH, .17, wood, s * (panelW / 2 + .045), py, pz + .015);
  }
  // A real raised rim catches the side light around the painted moon while the
  // foxes, cloud scrolls and water remain a quieter second reading.
  const rim = new THREE.Mesh(new THREE.TorusGeometry(.96, .014, 7, 96), brass);
  rim.position.set(0, py + .47, pz + .135);
  rim.castShadow = rim.receiveShadow = true;
  parent.add(rim);

  // Two closed-base wish archives fit the solid bays between side windows.
  for (const s of [-1, 1]) {
    const cabinet = new THREE.Group(); cabinet.position.set(s * (room.halfX - .13), baseH, room.front - 6.1);
    cabinet.rotation.y = -s * Math.PI / 2; parent.add(cabinet);
    box(2.05, 3.15, .12, dark, 0, 1.575, 0, cabinet);
    for (const x of [-1.02, 1.02]) box(.12, 3.25, .62, wood, x, 1.625, .26, cabinet);
    for (const y of [.08, 1.18, 2.12, 3.2]) box(2.12, .1, .64, wood, 0, y, .27, cabinet);
    for (const x of [-.49, .49]) {
      box(.94, .98, .085, wood, x, .63, .52, cabinet);
      box(.035, .13, .045, brass, x * .28, .72, .59, cabinet);
    }
    // Partially closed lattice shutter, with a quiet reveal behind it.
    for (let i = 0; i < 6; i++) box(.025, 1.88, .035, wood, -.92 + i * .105, 2.2, .6, cabinet);
    for (let i = 0; i < 11; i++) box(.56, .025, .035, wood, -.66, 1.3 + i * .17, .6, cabinet);
    box(.7, .38, .38, wood, .33, 1.43, .3, cabinet);
    box(.72, .045, .4, dark, .33, 1.64, .3, cabinet);
    box(.055, .13, .035, brass, .33, 1.47, .51, cabinet);
    for (let i = 0; i < 4; i++) {
      const plaque = box(.065, .43 + i * .02, .13, paper, .45 + i * .09, 2.4, .25, cabinet); plaque.rotation.z = -.12;
    }
    const vessel = new THREE.Mesh(new THREE.LatheGeometry([[.13, 0], [.22, .12], [.21, .27], [.09, .36], [.085, .43]].map(p => new THREE.Vector2(...p)), 20), clay);
    vessel.position.set(-.02, 2.17, .26); cabinet.add(vessel);

    const lx = s * (pool.halfX + .61), lz = pool.back + .7;
    rounded(.65, .17, .65, lx, baseH + .085, lz);
    rounded(.53, .3, .53, lx, baseH + .32, lz);
    const glass = new THREE.MeshStandardMaterial({ color: 0xd8be8c, emissive: 0xffc46c, emissiveIntensity: .32, roughness: .85 });
    box(.4, .34, .4, glass, lx, baseH + .64, lz);
    for (const dx of [-.23, .23]) for (const dz of [-.23, .23]) box(.045, .4, .045, brass, lx + dx, baseH + .64, lz + dz);
    rounded(.64, .09, .64, lx, baseH + .87, lz);
    rounded(.47, .055, .47, lx, baseH + .94, lz);
  }
  return { statueY: baseH + .52 };
}
