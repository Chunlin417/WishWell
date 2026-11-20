// 木牌下面挂的小铜铃（池边的木牌和庭院树上的木牌共用）：照着参考图做的铃铛——
// 圆铃身、腰上略凸的一道箍、顶上一截短颈和一个吊环、底部一道上端圆头的开口；旧青铜的颜色，凹处发暗、凸处磨亮
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// 尺寸以铃身半径为 1 来定，最后整体缩放到 r 米；原点在吊环的顶端（挂点），铃铛向 -y 垂下
const LOOP_Y = 1.48, LOOP_R = .22, LOOP_TUBE = .11, BAND_Y = .08, BAND_H = .12, BAND_OUT = .06;
export const BELL_HEIGHT = LOOP_Y + LOOP_R + LOOP_TUBE + 1;   // 挂点到铃底的距离（乘以 r）

export function bellGeometry(r = .016) {
  // 铃身的轮廓：从底部中心沿球面往上；腰上的箍是一圈圆润的鼓起；顶上收成短颈
  const pts = [];
  const N = 40;
  for (let i = 0; i <= N; i++) {
    const a = -Math.PI / 2 + Math.PI * i / N, y = Math.sin(a);
    let x = Math.cos(a);
    const b = (y - BAND_Y) / BAND_H;
    if (Math.abs(b) < 1) x += BAND_OUT * Math.sqrt(1 - b * b) + .02;   // 箍：截面是半圆，再整体略微外扩，让上下两条边分明
    pts.push(new THREE.Vector2(Math.max(x, 1e-3), y));
  }
  pts.push(new THREE.Vector2(.3, 1.02), new THREE.Vector2(.26, 1.12), new THREE.Vector2(.18, 1.2), new THREE.Vector2(1e-3, 1.2));   // 颈
  const body = new THREE.LatheGeometry(pts, 28);
  const loop = new THREE.TorusGeometry(LOOP_R, LOOP_TUBE, 8, 20).translate(0, LOOP_Y, 0);
  // 吊环不需要贴图上的花纹：uv 都指到贴图上方那段干净的铜色
  const lu = loop.attributes.uv; for (let i = 0; i < lu.count; i++) lu.setXY(i, lu.getX(i), .97);
  const g = mergeGeometries([body, loop]);
  g.translate(0, -(LOOP_Y + LOOP_R + LOOP_TUBE), 0).scale(r, r, r);
  return g;
}

// 青铜的颜色贴图（u 绕一圈、v 从底到顶）：斑驳的铜锈和氧化、腰箍和上半球磨得亮一点、前后两道开口
let bronzeTex = null;
export function bronzeTexture() {
  if (bronzeTex) return bronzeTex;
  const W = 256, H = 128, c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  let s = 7; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  g.fillStyle = '#a07a3c'; g.fillRect(0, 0, W, H);
  for (let i = 0; i < 260; i++) {   // 深色的氧化斑和浅色的磨亮处
    const x = rnd() * W, y = rnd() * H, rr = 2 + rnd() * 10, dark = rnd() < .62;
    const gr = g.createRadialGradient(x, y, 0, x, y, rr);
    gr.addColorStop(0, dark ? `rgba(38,26,12,${.25 + rnd() * .3})` : `rgba(200,160,90,${.12 + rnd() * .2})`); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(x - rr, y - rr, rr * 2, rr * 2);
  }
  // 腰箍（轮廓 45 个点里的第 19～23 个，v ≈ 0.43～0.53）：凸起的地方被摸得发亮
  const bv = y => H * (1 - y);
  const band = g.createLinearGradient(0, bv(.53), 0, bv(.43)); band.addColorStop(0, 'rgba(210,170,100,0)'); band.addColorStop(.5, 'rgba(210,170,100,.4)'); band.addColorStop(1, 'rgba(210,170,100,0)');
  g.fillStyle = band; g.fillRect(0, bv(.53), W, bv(.43) - bv(.53));
  // 开口：从底部往上到下半球的一半，上端是圆头（u = 0 朝前，u = 0.5 朝后）
  g.fillStyle = '#0d0905';
  for (const u of [0, .5, 1]) {
    const x = u * W, w = 6;
    g.fillRect(x - w / 2, bv(.24), w, bv(0) - bv(.24));
    g.beginPath(); g.arc(x, bv(.24), w * .9, 0, Math.PI * 2); g.fill();
  }
  bronzeTex = new THREE.CanvasTexture(c); bronzeTex.colorSpace = THREE.SRGBColorSpace; bronzeTex.anisotropy = 4;
  return bronzeTex;
}

// 红穗：两片十字交叉的透明卡片，上面画着照参考图做的流苏——顶上一个圆结、一段缠紧的箍，下面几百根丝线微微散开，末端参差
// 原点在顶端，向 -y 垂下；w：底部的宽，h：长（米）
export function tasselGeometry(w = .03, h = .1) {
  const a = new THREE.PlaneGeometry(w, h).translate(0, -h / 2, 0), b = a.clone().rotateY(Math.PI / 2);
  return mergeGeometries([a, b]);
}
let tasselTex = null;
export function tasselTexture() {
  if (tasselTex) return tasselTex;
  const W = 128, H = 512, c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  let s = 11; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const top = H * .13;   // 箍的下沿：丝线从这里散开
  for (let i = 0; i < 150; i++) {   // 上端收在铃底那么宽，往下散开到将近两倍；丝线之间透光
    const x0 = W / 2 + (rnd() - .5) * W * .4, spread = (x0 - W / 2) / (W * .2);
    const x1 = W / 2 + spread * W * .4 + (rnd() - .5) * W * .12, y1 = H * (.88 + rnd() * .12);
    const l = 36 + rnd() * 22;
    g.strokeStyle = `hsla(${357 + rnd() * 6}, ${74 + rnd() * 14}%, ${l}%, ${.55 + rnd() * .4})`;
    g.lineWidth = .7 + rnd() * .7;
    g.beginPath(); g.moveTo(x0, top); g.quadraticCurveTo(x0 + (x1 - x0) * .3 + (rnd() - .5) * 6, (top + y1) / 2, x1, y1); g.stroke();
  }
  // 缠绕的箍：一圈圈细线
  const bw = W * .44;
  g.fillStyle = '#8e1414'; g.fillRect(W / 2 - bw / 2 + 4, H * .07, bw - 8, top - H * .07);
  for (let y = H * .072; y < top; y += 3.2) { g.strokeStyle = 'rgba(220,60,50,.55)'; g.lineWidth = 1.2; g.beginPath(); g.moveTo(W / 2 - bw / 2 + 4, y); g.lineTo(W / 2 + bw / 2 - 4, y + 1); g.stroke(); }
  // 顶上的圆结
  const kg = g.createRadialGradient(W / 2 - 6, H * .03, 2, W / 2, H * .04, W * .2);
  kg.addColorStop(0, '#e2443a'); kg.addColorStop(1, '#7a1010');
  g.fillStyle = kg; g.beginPath(); g.ellipse(W / 2, H * .045, W * .2, H * .035, 0, 0, Math.PI * 2); g.fill();
  tasselTex = new THREE.CanvasTexture(c); tasselTex.colorSpace = THREE.SRGBColorSpace; tasselTex.anisotropy = 4;
  return tasselTex;
}
