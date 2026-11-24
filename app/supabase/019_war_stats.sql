-- =====================================================================
-- 019: Statistik hasil war per pemain (dari tabel hasil di game) untuk cek pemain aktif.
-- Satu baris per (sesi war, peta main/sub, nama). Hanya pemain guild sendiri yang disimpan.
-- =====================================================================
create table if not exists public.war_stats (
  event_id   bigint not null references public.events(id) on delete cascade,
  map        text   not null check (map in ('main', 'sub')),
  name       text   not null,
  member_id  bigint references public.members(id) on delete set null,
  job        text,
  kills int not null default 0, assists int not null default 0,
  player_dmg bigint not null default 0, building_dmg bigint not null default 0,
  heal bigint not null default 0, endure bigint not null default 0,
  deaths int not null default 0, revives int not null default 0,
  monsters int not null default 0, flag_repair int not null default 0,
  boss_kills int not null default 0, boss_dmg bigint not null default 0,
  created_at timestamptz not null default now(),
  primary key (event_id, map, name)
);
create index if not exists war_stats_member on public.war_stats(member_id);

-- Ringkasan per peta: lawan siapa, dan apakah musuh benar-benar ada / aktif.
-- Kalau musuh tidak ada (enemy_active = 0), pemain kita yang 0 aktivitas tidak dianggap AFK.
create table if not exists public.war_maps (
  event_id      bigint not null references public.events(id) on delete cascade,
  map           text   not null check (map in ('main', 'sub')),
  our_guild     text,
  enemy_guild   text,
  our_players   int not null default 0,
  enemy_players int not null default 0,
  enemy_active  int not null default 0,
  enemy_kills   int not null default 0,
  enemy_dmg     bigint not null default 0,
  primary key (event_id, map)
);
alter table public.war_maps enable row level security;
alter table public.war_stats enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='war_stats' and policyname='read_war_stats') then
    create policy "read_war_stats" on public.war_stats for select to authenticated using (public.is_admin());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='war_stats' and policyname='not_banned') then
    create policy "not_banned" on public.war_stats as restrictive for all to authenticated
      using (not public.is_banned()) with check (not public.is_banned());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='war_maps' and policyname='read_war_maps') then
    create policy "read_war_maps" on public.war_maps for select to authenticated using (public.is_admin());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='war_maps' and policyname='not_banned') then
    create policy "not_banned" on public.war_maps as restrictive for all to authenticated
      using (not public.is_banned()) with check (not public.is_banned());
  end if;
end $$;

-- Ganti statistik satu peta di satu sesi war. p_rows: [{name, job, kills, assists, player_dmg, ...}]
create or replace function public.import_war_stats(p_event_id bigint, p_map text, p_rows jsonb, p_meta jsonb default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_n int; v_unmatched text[];
begin
  if not public.is_admin() then raise exception 'Hanya moderator'; end if;
  if p_map not in ('main','sub') then raise exception 'Peta harus main atau sub'; end if;
  if not exists (select 1 from public.events where id = p_event_id) then raise exception 'Sesi war tidak ditemukan'; end if;
  delete from public.war_stats where event_id = p_event_id and map = p_map;
  insert into public.war_stats (event_id, map, name, member_id, job, kills, assists, player_dmg, building_dmg, heal, endure,
                                deaths, revives, monsters, flag_repair, boss_kills, boss_dmg)
  select distinct on (lower(btrim(x->>'name')))
         p_event_id, p_map, btrim(x->>'name'),
         (select id from public.members m where m.name_key = lower(btrim(x->>'name'))),
         nullif(btrim(x->>'job'), ''),
         coalesce((x->>'kills')::int, 0), coalesce((x->>'assists')::int, 0),
         coalesce((x->>'player_dmg')::bigint, 0), coalesce((x->>'building_dmg')::bigint, 0),
         coalesce((x->>'heal')::bigint, 0), coalesce((x->>'endure')::bigint, 0),
         coalesce((x->>'deaths')::int, 0), coalesce((x->>'revives')::int, 0),
         coalesce((x->>'monsters')::int, 0), coalesce((x->>'flag_repair')::int, 0),
         coalesce((x->>'boss_kills')::int, 0), coalesce((x->>'boss_dmg')::bigint, 0)
    from jsonb_array_elements(p_rows) x
   where coalesce(btrim(x->>'name'), '') <> '';
  get diagnostics v_n = row_count;
  if p_meta is not null then
    insert into public.war_maps (event_id, map, our_guild, enemy_guild, our_players, enemy_players, enemy_active, enemy_kills, enemy_dmg)
    values (p_event_id, p_map, p_meta->>'our_guild', p_meta->>'enemy_guild', coalesce((p_meta->>'our_players')::int, v_n),
            coalesce((p_meta->>'enemy_players')::int, 0), coalesce((p_meta->>'enemy_active')::int, 0),
            coalesce((p_meta->>'enemy_kills')::int, 0), coalesce((p_meta->>'enemy_dmg')::bigint, 0))
    on conflict (event_id, map) do update set our_guild = excluded.our_guild, enemy_guild = excluded.enemy_guild,
      our_players = excluded.our_players, enemy_players = excluded.enemy_players, enemy_active = excluded.enemy_active,
      enemy_kills = excluded.enemy_kills, enemy_dmg = excluded.enemy_dmg;
  end if;
  select coalesce(array_agg(name order by name), '{}') into v_unmatched
    from public.war_stats where event_id = p_event_id and map = p_map and member_id is null;
  return jsonb_build_object('rows', v_n, 'unmatched', v_unmatched);
end $$;
revoke execute on function public.import_war_stats(bigint, text, jsonb, jsonb) from public, anon;
grant execute on function public.import_war_stats(bigint, text, jsonb, jsonb) to authenticated;
notify pgrst, 'reload schema';

-- Buat sesi GL kosong (tanpa party) untuk slot GL yang belum dikonfirmasi di papan.
-- Kalau sudah ada sesi GL dalam ±3 jam dari waktu itu, pakai yang lama.
create or replace function public.create_gl_session(p_played_at timestamptz)
returns bigint language plpgsql security definer set search_path = public as $$
declare b public.events; v_id bigint;
begin
  if not public.is_admin() then raise exception 'Hanya admin'; end if;
  select * into b from public.events where is_permanent and mode = 'guild_league' order by id limit 1;
  if not found then raise exception 'Papan Guild League tidak ditemukan'; end if;
  select id into v_id from public.events
   where parent_id = b.id and abs(extract(epoch from (starts_at - p_played_at))) < 3 * 3600
   order by id limit 1;
  if v_id is not null then return v_id; end if;
  insert into public.events (mode, title, starts_at, party_count, party_size, main_count, sections, status, notes, created_by, parent_id)
  values (b.mode, b.title || ' – ' || to_char(p_played_at at time zone 'Asia/Jakarta', 'DD Mon YYYY HH24:MI'),
          p_played_at, b.party_count, b.party_size, b.main_count, b.sections, 'done', null, auth.uid(), b.id)
  returning id into v_id;
  return v_id;
end $$;
revoke execute on function public.create_gl_session(timestamptz) from public, anon;
grant execute on function public.create_gl_session(timestamptz) to authenticated;
notify pgrst, 'reload schema';
