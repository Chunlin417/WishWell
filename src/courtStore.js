// 庭院里的数据：名字、木牌、炉里的香。两种来源：
//   - 服务器（Supabase，见 supabase/schema.sql 和 src/remote.js）：配置了 VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY 且连得上时使用。
//     所有规则和时间都在服务器上判断；这里只缓存最近一次拿到的状态，界面读缓存，写入走服务器。
//   - 本机（localStorage）：没配置服务器、或者连不上时的后备。只有自己的牌和香，规则一样，但是没有"别人"，也骗得过（改本机时钟）。
// 愿望的内容不在这里：只存名字、日期和时间。名字第一次挂牌时写下，之后固定，下次自动使用。
// 发牌限制：同一个人半小时只能挂 1 块，每天最多 3 块（按本地日期算）。一炷香 30 分钟，一人同时一炷，炉里最多 100 炷。
// 读的接口（getName / listPlaques / listIncense / canWish / canLightIncense / nowMs）是同步的，写的接口（addPlaque / lightIncense）是异步的。
const K = { name: 'wish.name', plaques: 'wish.plaques', incense: 'wish.incense' };
export const COOLDOWN_MS = 30 * 60e3, DAILY_MAX = 3, NAME_MAX = 6;
export const INCENSE_MS = 30 * 60e3, INCENSE_SLOTS = 100;
const TEXT = {
  cooldown: '心愿已寄出，稍后再来', daily: '今日三愿已满，明日再来', name: '这个名字不行，换一个吧',
  burning: '香正燃着，燃尽后再点', full: '炉中已满，稍后再来', network: '网络不通，稍后再来',
};

// ---------- 本机存储 ----------
let memory = { name: null, plaques: [], incense: [] }, memoryOnly = false;   // localStorage 不可用（隐私模式等）时，数据只放在内存里，刷新就没了
const read = (k, d) => { if (memoryOnly) return d; try { const v = localStorage.getItem(k); return v == null ? (k === K.name ? null : []) : JSON.parse(v); } catch { memoryOnly = true; return d; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { memoryOnly = true; } };

// ---------- 服务器 ----------
let api = null;                                                   // 连上服务器之后是 makeApi() 的返回值；null = 用本机存储
let cache = { name: null, plaques: [], incense: [], offset: 0 };  // 最近一次从服务器拿到的状态；offset = 服务器时间 − 本机时间
let signature = '';
const listeners = new Set();
export const storeMode = () => (api ? 'remote' : 'local');
export const onStoreChange = fn => { listeners.add(fn); return () => listeners.delete(fn); };   // 服务器上的数据变了（别人挂了牌、点了香）时调用
// opts.api：直接给一个现成的接口（测试用）；否则按环境变量连 Supabase
export async function initStore(opts = {}) {
  try {
    if (opts.api) api = opts.api;
    else {
      const url = import.meta.env.VITE_SUPABASE_URL, key = import.meta.env.VITE_SUPABASE_ANON_KEY;
      if (!url || !key) return 'local';
      api = await (await import('./remote.js')).connectRemote({ url, key });
    }
    await refreshStore();
    return 'remote';
  } catch (e) { console.warn('服务器连不上，改用本机数据', e); api = null; return 'local'; }
}
// 重新向服务器要一次最新状态；返回有没有变化
export async function refreshStore() {
  if (!api) return false;
  try {
    const s = await api.getState();
    cache = { name: s.name || null, plaques: s.plaques || [], incense: s.incense || [], offset: (s.now ?? Date.now()) - Date.now() };
    const sig = JSON.stringify([cache.name, cache.plaques.map(p => p.id), cache.incense.map(i => i.id)]);
    if (sig === signature) return false;
    signature = sig; listeners.forEach(f => f());
    return true;
  } catch { return false; }
}

// ---------- 时间 ----------
// 一律用 nowMs()：连上服务器后是服务器的时间（本机时钟改了也没用），否则是本机时钟
export const nowMs = () => Date.now() + (api ? cache.offset : 0);
const pad = n => String(n).padStart(2, '0');
export const dateOf = ms => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

// ---------- 名字 ----------
// 服务器上已经有名字就用服务器的；没有的话用这台设备上刚写下的（还没挂牌，服务器在第一次挂牌时才记下）
export const getName = () => (api && cache.name) || read(K.name, memory.name) || null;
export function setName(n) {
  n = [...String(n).trim()].slice(0, NAME_MAX).join('');
  if (!n || getName()) return getName();   // 名字只能写一次
  memory.name = n; write(K.name, n); return n;
}

// ---------- 木牌 ----------
export const listPlaques = () => (api ? cache.plaques : read(K.plaques, memory.plaques));
// 现在能不能挂一块新牌：{ ok: true } 或 { ok: false, reason: 'cooldown' | 'daily', text }（服务器最终说了算，这里让界面先有这个反应）
export function canWish(now = nowMs()) {
  const mine = listPlaques().filter(p => p.mine);
  const today = dateOf(now);
  if (mine.filter(p => dateOf(p.t) === today).length >= DAILY_MAX) return { ok: false, reason: 'daily', text: TEXT.daily };
  if (mine.some(p => now - p.t < COOLDOWN_MS)) return { ok: false, reason: 'cooldown', text: TEXT.cooldown };
  return { ok: true };
}
// 挂上一块新牌（愿望扔进池里的那一刻调用）。返回 { ok: true, rec } 或 { ok: false, reason, text }
export async function addPlaque(name, now = nowMs()) {
  name = [...String(name)].slice(0, NAME_MAX).join('');
  if (api) {
    try {
      const r = await api.addPlaque(name);
      if (!r.ok) return { ok: false, reason: r.reason, text: TEXT[r.reason] || TEXT.network };
      await refreshStore();
      return { ok: true, rec: { id: r.id, name: r.name, date: r.date, t: nowMs(), mine: true } };
    } catch { return { ok: false, reason: 'network', text: TEXT.network }; }
  }
  const rec = { id: `p${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`, name, date: dateOf(now), t: now, mine: true };
  const all = [...listPlaques(), rec];
  memory.plaques = all; write(K.plaques, all);
  return { ok: true, rec };
}

// ---------- 香 ----------
// 一炷香烧 30 分钟；按点燃的时间戳算已经烧了多少，离开院子再回来香也是接着烧的
export function listIncense(now = nowMs()) {
  if (api) return cache.incense.filter(i => now - i.t < INCENSE_MS);
  const all = read(K.incense, memory.incense), live = all.filter(i => now - i.t < INCENSE_MS);
  if (live.length !== all.length) { memory.incense = live; write(K.incense, live); }   // 燃尽的从记录里清掉
  return live;
}
// 现在能不能点香：{ ok: true } 或 { ok: false, reason: 'burning' | 'full', text }
export function canLightIncense(now = nowMs()) {
  const live = listIncense(now);
  if (live.some(i => i.mine)) return { ok: false, reason: 'burning', text: TEXT.burning };
  if (live.length >= INCENSE_SLOTS) return { ok: false, reason: 'full', text: TEXT.full };
  return { ok: true };
}
// 点一炷香：服务器（或本机）随机挑一个空着的插位。返回 { ok: true, rec } 或 { ok: false, reason, text }
export async function lightIncense(now = nowMs()) {
  if (api) {
    try {
      const r = await api.lightIncense();
      await refreshStore();
      if (!r.ok) return { ok: false, reason: r.reason, text: TEXT[r.reason] || TEXT.network };
      return { ok: true, rec: { id: r.id, slot: r.slot, t: r.t, mine: true } };
    } catch { return { ok: false, reason: 'network', text: TEXT.network }; }
  }
  const c = canLightIncense(now); if (!c.ok) return c;
  const live = listIncense(now), used = new Set(live.map(i => i.slot)), free = [];
  for (let i = 0; i < INCENSE_SLOTS; i++) if (!used.has(i)) free.push(i);
  const rec = { id: `i${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`, slot: free[Math.floor(Math.random() * free.length)], t: now, mine: true };
  const all = [...live, rec]; memory.incense = all; write(K.incense, all);
  return { ok: true, rec };
}
