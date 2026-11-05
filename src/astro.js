// 天文计算：太阳 / 月亮的高度角与方位角、月相、按太阳高度插值的天空颜色

export const RAD = Math.PI / 180;

function altAz(ra, dec, d, lat, lon) {
  const gmst = (280.46061837 + 360.98564736629 * d) % 360;
  const H = (gmst + lon) * RAD - ra, phi = lat * RAD;
  const alt = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H));
  const az = Math.atan2(-Math.sin(H), Math.tan(dec) * Math.cos(phi) - Math.sin(phi) * Math.cos(H));
  return { alt: alt / RAD, az: (az / RAD + 360) % 360 }; // az：从正北顺时针
}

export function sunPos(ms, lat, lon) {
  const d = ms / 864e5 - 10957.5;
  const g = (357.529 + 0.98560028 * d) * RAD, q = 280.459 + 0.98564736 * d;
  const L = (q + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * RAD, e = (23.439 - 0.00000036 * d) * RAD;
  return altAz(Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L)), Math.asin(Math.sin(e) * Math.sin(L)), d, lat, lon);
}

export function moonPos(ms, lat, lon) {
  const d = ms / 864e5 - 10957.5, e = 23.439 * RAD;
  const L = (218.316 + 13.176396 * d) * RAD, M = (134.963 + 13.064993 * d) * RAD, F = (93.272 + 13.229350 * d) * RAD;
  const l = L + 6.289 * RAD * Math.sin(M), b = 5.128 * RAD * Math.sin(F);
  const ra = Math.atan2(Math.sin(l) * Math.cos(e) - Math.tan(b) * Math.sin(e), Math.cos(l));
  const dec = Math.asin(Math.sin(b) * Math.cos(e) + Math.cos(b) * Math.sin(e) * Math.sin(l));
  return altAz(ra, dec, d, lat, lon);
}

// 0 新月, 0.5 满月
export const moonPhase = ms => (((ms - 947182440000) / 864e5 / 29.530588853) % 1 + 1) % 1;

const hex = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

// [太阳高度, 天顶色, 地平线色]（sRGB）
const SKY = [
  [-90, '#0b1430', '#18244a'], [-18, '#0d1736', '#1b2850'], [-12, '#0f1a3c', '#222e58'],
  [-7, '#16224d', '#4a3a66'], [-3, '#24386e', '#c46a5a'], [0, '#35548f', '#f08c4e'],
  [3, '#4570b0', '#f5ad6a'], [8, '#4a82c8', '#e9cfa8'], [15, '#4486d4', '#b9d5ee'],
  [40, '#3a7bd5', '#a6cbef'], [90, '#2f6cd0', '#9ac4ef'],
].map(([e, z, h]) => [e, hex(z), hex(h)]);

export function skyAt(el) {
  for (let i = 1; i < SKY.length; i++) {
    if (el <= SKY[i][0]) {
      const [e0, z0, h0] = SKY[i - 1], [e1, z1, h1] = SKY[i], t = (el - e0) / (e1 - e0);
      return [mix(z0, z1, t), mix(h0, h1, t)];
    }
  }
  return [SKY.at(-1)[1], SKY.at(-1)[2]];
}

export function seasonOf(ms, lat) {
  let m = new Date(ms).getMonth();
  if (lat < 0) m = (m + 6) % 12;
  return m === 11 || m <= 1 ? 'winter' : m <= 4 ? 'spring' : m <= 7 ? 'summer' : 'autumn';
}
