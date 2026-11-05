// 定位 + 实时天气（Open-Meteo，免费、无需 key）

const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));

export const PRESETS = {
  clear: { cloud: 0, rain: 0, snow: 0, fog: 0, thunder: 0, wind: .15 },
  partly: { cloud: .45, rain: 0, snow: 0, fog: 0, thunder: 0, wind: .3 },
  overcast: { cloud: 1, rain: 0, snow: 0, fog: 0, thunder: 0, wind: .3 },
  fog: { cloud: .7, rain: 0, snow: 0, fog: .85, thunder: 0, wind: .05 },
  drizzle: { cloud: .9, rain: .25, snow: 0, fog: .15, thunder: 0, wind: .2 },
  rain: { cloud: 1, rain: .8, snow: 0, fog: .2, thunder: 0, wind: .45 },
  storm: { cloud: 1, rain: 1, snow: 0, fog: .2, thunder: 1, wind: .8 },
  snow: { cloud: .9, rain: 0, snow: .8, fog: .15, thunder: 0, wind: .25 },
};
export const PRESET_NAME = { clear: '晴', partly: '多云', overcast: '阴', fog: '雾', drizzle: '毛毛雨', rain: '大雨', storm: '雷雨', snow: '雪' };
export const WX_NAME = { 0: '晴', 1: '晴间少云', 2: '多云', 3: '阴', 45: '雾', 48: '雾凇', 51: '毛毛雨', 53: '毛毛雨', 55: '毛毛雨',
  56: '冻毛毛雨', 57: '冻毛毛雨', 61: '小雨', 63: '中雨', 65: '大雨', 66: '冻雨', 67: '冻雨', 71: '小雪', 73: '中雪',
  75: '大雪', 77: '米雪', 80: '阵雨', 81: '阵雨', 82: '强阵雨', 85: '阵雪', 86: '强阵雪', 95: '雷雨', 96: '雷雨伴冰雹', 99: '雷雨伴冰雹' };

export function targetsFromLive(c) {
  const code = c.weather_code;
  const t = { cloud: (c.cloud_cover ?? 30) / 100, rain: 0, snow: 0, fog: 0, thunder: 0, wind: clamp((c.wind_speed_10m ?? 8) / 40) };
  if (code <= 1) t.cloud = Math.min(t.cloud, code === 0 ? .08 : .25);
  if (code === 45 || code === 48) { t.fog = .85; t.cloud = Math.max(t.cloud, .6); }
  if (code >= 51 && code <= 57) t.rain = .25;
  if (code >= 61 && code <= 67) t.rain = { 61: .4, 63: .7, 65: 1 }[code] ?? .55;
  if (code >= 80 && code <= 82) t.rain = [.5, .8, 1][code - 80];
  if (code >= 71 && code <= 77) t.snow = { 71: .4, 73: .7, 75: 1 }[code] ?? .5;
  if (code === 85 || code === 86) t.snow = code === 85 ? .6 : 1;
  if (code >= 95) { t.rain = .9; t.thunder = 1; t.wind = Math.max(t.wind, .6); }
  if (t.rain || t.snow) t.cloud = Math.max(t.cloud, .85);
  return t;
}

function fetchTimeout(url, ms) {
  const ac = new AbortController(); const id = setTimeout(() => ac.abort(), ms);
  return fetch(url, { signal: ac.signal }).finally(() => clearTimeout(id));
}

function gpsLocate() {
  return new Promise(res => {
    if (!navigator.geolocation) return res(null);
    navigator.geolocation.getCurrentPosition(
      p => res({ lat: p.coords.latitude, lon: p.coords.longitude, src: 'gps' }),
      () => res(null), { timeout: 10000, maximumAge: 30 * 60e3, enableHighAccuracy: false });
  });
}

const deviceOffset = () => -new Date().getTimezoneOffset();   // 分钟，东八区 = 480

async function ipLocate() {
  try {
    const j = await (await fetchTimeout('https://ipapi.co/json/', 6000)).json();
    if (typeof j.latitude !== 'number') return null;
    // 走代理 / VPN 时 IP 可能被认到国外：IP 所在时区和手机系统时区对不上，就不采信
    const m = /^([+-])(\d\d)(\d\d)$/.exec(j.utc_offset || '');
    if (m) {
      const off = (m[1] === '-' ? -1 : 1) * (+m[2] * 60 + +m[3]);
      if (Math.abs(off - deviceOffset()) > 60) return null;
    }
    return { lat: j.latitude, lon: j.longitude, src: 'ip' };
  } catch {}
  return null;
}

// 按系统时区推一个代表城市（最后的兜底）
const TZ_CITIES = {
  'Asia/Shanghai': [31.23, 121.47, '上海'], 'Asia/Chongqing': [29.56, 106.55, '重庆'], 'Asia/Harbin': [45.8, 126.53, '哈尔滨'],
  'Asia/Urumqi': [43.83, 87.62, '乌鲁木齐'], 'Asia/Hong_Kong': [22.32, 114.17, '香港'], 'Asia/Macau': [22.2, 113.55, '澳门'],
  'Asia/Taipei': [25.03, 121.56, '台北'], 'Asia/Tokyo': [35.68, 139.69, '东京'], 'Asia/Seoul': [37.57, 126.98, '首尔'],
  'Asia/Singapore': [1.35, 103.82, '新加坡'], 'Asia/Kuala_Lumpur': [3.14, 101.69, '吉隆坡'], 'Asia/Bangkok': [13.76, 100.5, '曼谷'],
  'Europe/London': [51.51, -.13, '伦敦'], 'Europe/Paris': [48.86, 2.35, '巴黎'], 'Europe/Berlin': [52.52, 13.4, '柏林'],
  'America/New_York': [40.71, -74.01, '纽约'], 'America/Los_Angeles': [34.05, -118.24, '洛杉矶'], 'America/Chicago': [41.88, -87.63, '芝加哥'],
  'America/Toronto': [43.65, -79.38, '多伦多'], 'America/Vancouver': [49.28, -123.12, '温哥华'], 'Australia/Sydney': [-33.87, 151.21, '悉尼'],
  'Australia/Melbourne': [-37.81, 144.96, '墨尔本'],
};
export function tzGuess() {
  const c = TZ_CITIES[Intl.DateTimeFormat().resolvedOptions().timeZone];
  if (c) return { lat: c[0], lon: c[1], name: c[2], src: 'tz' };
  return { lat: 30, lon: deviceOffset() / 4, name: '', src: 'tz' };
}

// 坐标 → 中文地名（BigDataCloud 的免费客户端接口，坐标只保留两位小数）
export async function placeName(lat, lon) {
  try {
    const j = await (await fetchTimeout(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat.toFixed(2)}&longitude=${lon.toFixed(2)}&localityLanguage=zh`, 6000)).json();
    return j.city || j.locality || j.principalSubdivision || '';
  } catch { return ''; }
}

// 城市搜索（Open-Meteo 地理编码，支持中文）
export async function searchCity(q) {
  const j = await (await fetchTimeout(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=8&language=zh&format=json`, 6000)).json();
  return (j.results || []).map(r => ({ lat: r.latitude, lon: r.longitude, name: r.name, desc: [r.admin1, r.country].filter(Boolean).join(' · ') }));
}

// 定位优先级：手动选择的城市 > 浏览器定位 > IP（时区一致才用）> 系统时区
const SAVED_KEY = 'wish.city';
export const savedCity = () => { try { return JSON.parse(localStorage.getItem(SAVED_KEY)); } catch { return null; } };
export const saveCity = c => c ? localStorage.setItem(SAVED_KEY, JSON.stringify(c)) : localStorage.removeItem(SAVED_KEY);

export async function locate() {
  const saved = savedCity();
  if (saved) return { ...saved, src: 'manual' };
  const p = (await gpsLocate()) || (await ipLocate());
  if (!p) return tzGuess();
  p.name = await placeName(p.lat, p.lon);
  return p;
}

export async function fetchWeather(lat, lon) {
  // 坐标只保留两位小数（约 1 公里），够用且不暴露精确位置
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(2)}&longitude=${lon.toFixed(2)}` +
    `&current=temperature_2m,weather_code,cloud_cover,precipitation,wind_speed_10m&timezone=auto`;
  const j = await (await fetchTimeout(url, 8000)).json();
  if (!j.current) throw new Error('no weather');
  return j.current;
}
