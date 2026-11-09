// 实时天气（Open-Meteo，免费、无需 key）：这口井固定在富士山下，只查那里的天气

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

export async function fetchWeather(lat, lon) {
  // 坐标只保留两位小数（约 1 公里），够用且不暴露精确位置
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(2)}&longitude=${lon.toFixed(2)}` +
    `&current=temperature_2m,weather_code,cloud_cover,precipitation,wind_speed_10m&timezone=auto`;
  const j = await (await fetchTimeout(url, 8000)).json();
  if (!j.current) throw new Error('no weather');
  return j.current;
}
