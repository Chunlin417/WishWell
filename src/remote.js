// 和 Supabase 服务器说话：匿名登录（浏览器里存一个匿名身份，用户无感），然后只调 supabase/schema.sql 里的三个函数。
// makeApi 接收任何"长得像 supabase 客户端"的对象（要有 rpc），所以不连真服务器也能用假的客户端测试。
// 这个文件（连同 @supabase/supabase-js）只在配置了服务器地址时才会被下载。

export function makeApi(sb) {
  const tz = () => -new Date().getTimezoneOffset();   // 本地时区比 UTC 快几分钟（东八区 = 480），服务器据此算"今天"
  const call = async (fn, args) => { const { data, error } = await sb.rpc(fn, args); if (error) throw error; return data; };
  return {
    getState: () => call('get_state'),
    addPlaque: name => call('add_plaque', { p_name: name, p_tz: tz() }),
    lightIncense: () => call('light_incense'),
  };
}

export async function connectRemote({ url, key }) {
  const { createClient } = await import('@supabase/supabase-js');
  const sb = createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true } });
  const { data } = await sb.auth.getSession();
  if (!data.session) {
    const r = await sb.auth.signInAnonymously();   // 需要在 Supabase 控制台打开 "Allow anonymous sign-ins"
    if (r.error) throw r.error;
  }
  return makeApi(sb);
}
