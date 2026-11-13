// 庭院里的木牌数据（现在只存在这台设备的 localStorage 里；P4 换成服务器，接口保持不变）。
// 愿望的内容不在这里：只存名字、日期和时间。名字第一次许愿时写下，之后固定，下次自动使用。
// 发牌限制：同一个人半小时只能挂 1 块，每天最多 3 块（按本地日期算）。真正的限制以后由服务器强制，这里只是让界面先有这个行为。
const K = { name: 'wish.name', plaques: 'wish.plaques', incense: 'wish.incense' };
export const COOLDOWN_MS = 30 * 60e3, DAILY_MAX = 3, NAME_MAX = 6;

let memory = { name: null, plaques: [], incense: [] }, memoryOnly = false;   // localStorage 不可用（隐私模式等）时，数据只放在内存里，刷新就没了
const read = (k, d) => { if (memoryOnly) return d; try { const v = localStorage.getItem(k); return v == null ? (k === K.name ? null : []) : JSON.parse(v); } catch { memoryOnly = true; return d; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { memoryOnly = true; } };

export const getName = () => read(K.name, memory.name) || null;
export function setName(n) { n = [...String(n).trim()].slice(0, NAME_MAX).join(''); if (!n || getName()) return getName(); memory.name = n; write(K.name, n); return n; }   // 名字只能写一次

export const listPlaques = () => read(K.plaques, memory.plaques);
const pad = n => String(n).padStart(2, '0');
export const dateOf = ms => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

// 现在能不能挂一块新牌：{ ok: true } 或 { ok: false, reason: 'cooldown' | 'daily', text }
export function canWish(now = Date.now()) {
  const mine = listPlaques().filter(p => p.mine);
  const today = dateOf(now);
  if (mine.filter(p => dateOf(p.t) === today).length >= DAILY_MAX) return { ok: false, reason: 'daily', text: '今日三愿已满，明日再来' };
  if (mine.some(p => now - p.t < COOLDOWN_MS)) return { ok: false, reason: 'cooldown', text: '心愿已寄出，稍后再来' };
  return { ok: true };
}

// 挂上一块新牌（愿望扔进池里的那一刻调用）
export function addPlaque(name, now = Date.now()) {
  const rec = { id: `p${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`, name: [...name].slice(0, NAME_MAX).join(''), date: dateOf(now), t: now, mine: true };
  const all = [...listPlaques(), rec];
  memory.plaques = all; write(K.plaques, all);
  return rec;
}

// ---------- 香 ----------
// 一炷香烧 30 分钟；一个人同时只能点一炷，燃尽之后才能再点；香炉一共 100 个插位，满了就"稍后再来"。
// 时间一律用 nowMs()：现在是本机时钟，接服务器之后改成"服务器时间"（否则改本机时钟就能无限点香）；香按点燃的时间戳算已经烧了多少，离开院子再回来香也是接着烧的。
export const INCENSE_MS = 30 * 60e3, INCENSE_SLOTS = 100;
let serverOffset = 0;
export const nowMs = () => Date.now() + serverOffset;

// 现在炉里还燃着的香：[{ id, slot, t（点燃的时间）, mine }]
export function listIncense(now = nowMs()) {
  const all = read(K.incense, memory.incense || []), live = all.filter(i => now - i.t < INCENSE_MS);
  if (live.length !== all.length) { memory.incense = live; write(K.incense, live); }   // 燃尽的从记录里清掉
  return live;
}
// 现在能不能点香：{ ok: true } 或 { ok: false, reason: 'burning' | 'full', text }
export function canLightIncense(now = nowMs()) {
  const live = listIncense(now);
  if (live.some(i => i.mine)) return { ok: false, reason: 'burning', text: '香正燃着，燃尽后再点' };
  if (live.length >= INCENSE_SLOTS) return { ok: false, reason: 'full', text: '炉中已满，稍后再来' };
  return { ok: true };
}
// 点一炷香：随机挑一个空着的插位
export function lightIncense(now = nowMs()) {
  const c = canLightIncense(now); if (!c.ok) return c;
  const live = listIncense(now), used = new Set(live.map(i => i.slot)), free = [];
  for (let i = 0; i < INCENSE_SLOTS; i++) if (!used.has(i)) free.push(i);
  const rec = { id: `i${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`, slot: free[Math.floor(Math.random() * free.length)], t: now, mine: true };
  const all = [...live, rec]; memory.incense = all; write(K.incense, all);
  return { ok: true, rec };
}
