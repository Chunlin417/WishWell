// 庭院里的木牌数据（现在只存在这台设备的 localStorage 里；P4 换成服务器，接口保持不变）。
// 愿望的内容不在这里：只存名字、日期和时间。名字第一次许愿时写下，之后固定，下次自动使用。
// 发牌限制：同一个人半小时只能挂 1 块，每天最多 3 块（按本地日期算）。真正的限制以后由服务器强制，这里只是让界面先有这个行为。
const K = { name: 'wish.name', plaques: 'wish.plaques' };
export const COOLDOWN_MS = 30 * 60e3, DAILY_MAX = 3, NAME_MAX = 6;

let memory = { name: null, plaques: [] }, memoryOnly = false;   // localStorage 不可用（隐私模式等）时，数据只放在内存里，刷新就没了
const read = (k, d) => { if (memoryOnly) return d; try { const v = localStorage.getItem(k); return v == null ? (k === K.plaques ? [] : null) : JSON.parse(v); } catch { memoryOnly = true; return d; } };
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
