-- WishWell 庭院的数据库：木牌、香、名字，以及所有"规则"。
-- 在 Supabase 控制台 → SQL Editor 里整段粘贴运行即可（可以重复运行）。运行之前先在 Authentication → Sign In / Providers 里打开 "Allow anonymous sign-ins"。
--
-- 安全的思路：浏览器里的 anon key 是公开的，所以表一律打开行级安全（RLS）且不写任何策略——浏览器不能直接读写表；
-- 所有读写都走下面几个函数（security definer），规则（名字固定、半小时一块、每天三块、一人一炷香、100 个插位）和时间（now()）都在服务器上判断。

create extension if not exists pgcrypto;

-- ---------- 表 ----------
create table if not exists public.profiles (      -- 每个匿名用户的名字：第一次挂牌时写下，之后固定
  user_id    uuid primary key references auth.users (id) on delete cascade,
  name       text not null check (char_length(name) between 1 and 6),
  created_at timestamptz not null default now()
);

create table if not exists public.plaques (       -- 树上的木牌：只有名字和日期，没有愿望
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  name       text not null,
  date       text not null,                       -- 挂牌当天（挂牌人所在时区）的日期，如 2026-11-13
  created_at timestamptz not null default now()
);
create index if not exists plaques_created_idx on public.plaques (created_at);
create index if not exists plaques_user_idx on public.plaques (user_id, created_at desc);

create table if not exists public.incense (       -- 炉里燃着的香：燃尽（30 分钟）后会被清掉
  id      uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  slot    int  not null check (slot between 0 and 99),
  lit_at  timestamptz not null default now()
);
create index if not exists incense_lit_idx on public.incense (lit_at);
create index if not exists incense_user_idx on public.incense (user_id);

alter table public.profiles enable row level security;
alter table public.plaques  enable row level security;
alter table public.incense  enable row level security;
-- 不创建任何策略 = 浏览器（anon / authenticated 角色）不能直接访问这些表；下面的函数以表所有者身份运行，可以访问。
revoke all on public.profiles, public.plaques, public.incense from anon, authenticated;

-- ---------- 函数 ----------
-- 当前状态：自己的名字、所有木牌（最近 300 块）、炉里燃着的香、服务器此刻的时间（毫秒）
create or replace function public.get_state() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not signed in'; end if;
  return jsonb_build_object(
    'now', (extract(epoch from now()) * 1000)::bigint,
    'name', (select p.name from public.profiles p where p.user_id = uid),
    'plaques', coalesce((
      select jsonb_agg(jsonb_build_object('id', q.id, 'name', q.name, 'date', q.date, 't', (extract(epoch from q.created_at) * 1000)::bigint, 'mine', q.user_id = uid) order by q.created_at)
      from (select * from public.plaques order by created_at desc limit 300) q
    ), '[]'::jsonb),
    'incense', coalesce((
      select jsonb_agg(jsonb_build_object('id', i.id, 'slot', i.slot, 't', (extract(epoch from i.lit_at) * 1000)::bigint, 'mine', i.user_id = uid) order by i.lit_at)
      from public.incense i where i.lit_at > now() - interval '30 minutes'
    ), '[]'::jsonb)
  );
end $$;

-- 挂一块木牌。名字只在第一次时采用（之后用已经固定的名字）；同一个人半小时一块、每天最多三块（"一天"按 p_tz 给的时区算）
create or replace function public.add_plaque(p_name text, p_tz int default 0) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid(); nm text; last_t timestamptz; today_n int; d text; new_id uuid;
  tz int := greatest(-840, least(840, coalesce(p_tz, 0)));
begin
  if uid is null then raise exception 'not signed in'; end if;
  perform pg_advisory_xact_lock(hashtext('plaque:' || uid::text));   -- 同一个人的两次请求不会同时通过检查

  select p.name into nm from public.profiles p where p.user_id = uid;
  if nm is null then
    nm := btrim(regexp_replace(coalesce(p_name, ''), '[[:cntrl:]]', '', 'g'));
    if char_length(nm) < 1 or char_length(nm) > 6 then return jsonb_build_object('ok', false, 'reason', 'name'); end if;
    insert into public.profiles (user_id, name) values (uid, nm);
  end if;

  select max(q.created_at) into last_t from public.plaques q where q.user_id = uid;
  if last_t is not null and now() - last_t < interval '30 minutes' then return jsonb_build_object('ok', false, 'reason', 'cooldown'); end if;

  select count(*) into today_n from public.plaques q
   where q.user_id = uid and ((q.created_at at time zone 'utc') + make_interval(mins => tz))::date = ((now() at time zone 'utc') + make_interval(mins => tz))::date;
  if today_n >= 3 then return jsonb_build_object('ok', false, 'reason', 'daily'); end if;

  d := to_char((now() at time zone 'utc') + make_interval(mins => tz), 'YYYY-MM-DD');
  insert into public.plaques (user_id, name, date) values (uid, nm, d) returning id into new_id;
  return jsonb_build_object('ok', true, 'id', new_id, 'name', nm, 'date', d);
end $$;

-- 点一炷香：一个人同时只能一炷，炉里最多 100 炷，随机挑一个空着的插位
create or replace function public.light_incense() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); s int; new_id uuid; t timestamptz;
begin
  if uid is null then raise exception 'not signed in'; end if;
  perform pg_advisory_xact_lock(hashtext('incense'));
  delete from public.incense where lit_at <= now() - interval '30 minutes';   -- 燃尽的清掉
  if exists (select 1 from public.incense i where i.user_id = uid) then return jsonb_build_object('ok', false, 'reason', 'burning'); end if;
  select g into s from generate_series(0, 99) g where not exists (select 1 from public.incense i where i.slot = g) order by random() limit 1;
  if s is null then return jsonb_build_object('ok', false, 'reason', 'full'); end if;
  insert into public.incense (user_id, slot) values (uid, s) returning id, lit_at into new_id, t;
  return jsonb_build_object('ok', true, 'id', new_id, 'slot', s, 't', (extract(epoch from t) * 1000)::bigint);
end $$;

-- 只有登录过（含匿名登录）的用户能调用
revoke all on function public.get_state(), public.add_plaque(text, int), public.light_incense() from public, anon;
grant execute on function public.get_state(), public.add_plaque(text, int), public.light_incense() to authenticated;
