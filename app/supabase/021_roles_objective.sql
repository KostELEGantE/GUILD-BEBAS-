-- =====================================================================
-- 021: Peran bisa dikoreksi moderator, hapus sesi GL, jadwal GL (slot 30 menit),
--      riwayat import mencatat hasil war.
-- =====================================================================

-- Koreksi peran per pemain per peta (null = otomatis dari angka hasil war)
alter table public.war_stats add column if not exists role text check (role in ('dps','tank','healer'));

-- Riwayat import: jenis baru 'war' (hasil war Main/Sub)
alter table public.imports drop constraint if exists imports_kind_check;
alter table public.imports add constraint imports_kind_check check (kind in ('members','attendance','war'));

create or replace function public.set_war_role(p_event_id bigint, p_map text, p_name text, p_role text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Hanya moderator'; end if;
  if p_role is not null and p_role not in ('dps','tank','healer') then raise exception 'Peran tidak valid'; end if;
  update public.war_stats set role = p_role
   where event_id = p_event_id and map = p_map and lower(name) = lower(btrim(p_name));
  if not found then raise exception 'Pemain tidak ditemukan di hasil war ini'; end if;
end $$;
revoke execute on function public.set_war_role(bigint, text, text, text) from public, anon;
grant execute on function public.set_war_role(bigint, text, text, text) to authenticated;

-- Import ulang tetap menyimpan koreksi peran yang sudah dibuat, dan dicatat di riwayat import
create or replace function public.import_war_stats(p_event_id bigint, p_map text, p_rows jsonb, p_meta jsonb default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_n int; v_unmatched text[]; v_title text;
begin
  if not public.is_admin() then raise exception 'Hanya moderator'; end if;
  if p_map not in ('main','sub') then raise exception 'Peta harus main atau sub'; end if;
  select title into v_title from public.events where id = p_event_id;
  if not found then raise exception 'Sesi war tidak ditemukan'; end if;
  create temp table if not exists _keep_roles (name_key text primary key, role text) on commit drop;
  truncate _keep_roles; -- (DELETE tanpa WHERE ditolak oleh safeupdate)
  insert into _keep_roles select lower(name), role from public.war_stats
   where event_id = p_event_id and map = p_map and role is not null on conflict do nothing;
  delete from public.war_stats where event_id = p_event_id and map = p_map;
  insert into public.war_stats (event_id, map, name, member_id, job, kills, assists, player_dmg, building_dmg, heal, endure,
                                deaths, revives, monsters, flag_repair, boss_kills, boss_dmg, role)
  select distinct on (lower(btrim(x->>'name')))
         p_event_id, p_map, btrim(x->>'name'),
         (select id from public.members m where m.name_key = lower(btrim(x->>'name'))),
         nullif(btrim(x->>'job'), ''),
         coalesce((x->>'kills')::int, 0), coalesce((x->>'assists')::int, 0),
         coalesce((x->>'player_dmg')::bigint, 0), coalesce((x->>'building_dmg')::bigint, 0),
         coalesce((x->>'heal')::bigint, 0), coalesce((x->>'endure')::bigint, 0),
         coalesce((x->>'deaths')::int, 0), coalesce((x->>'revives')::int, 0),
         coalesce((x->>'monsters')::int, 0), coalesce((x->>'flag_repair')::int, 0),
         coalesce((x->>'boss_kills')::int, 0), coalesce((x->>'boss_dmg')::bigint, 0),
         (select k.role from _keep_roles k where k.name_key = lower(btrim(x->>'name')))
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
  insert into public.imports(kind, filename, row_count, created_by)
  values ('war', v_title || ' · ' || initcap(p_map) || coalesce(' vs ' || (p_meta->>'enemy_guild'), ''), v_n, auth.uid());
  select coalesce(array_agg(name order by name), '{}') into v_unmatched
    from public.war_stats where event_id = p_event_id and map = p_map and member_id is null;
  return jsonb_build_object('rows', v_n, 'unmatched', v_unmatched);
end $$;
revoke execute on function public.import_war_stats(bigint, text, jsonb, jsonb) from public, anon;
grant execute on function public.import_war_stats(bigint, text, jsonb, jsonb) to authenticated;

-- Hapus satu sesi GL (salah input / tidak jadi). Hasil war, peta, dan kehadirannya ikut terhapus.
create or replace function public.delete_gl_session(p_event_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare ev public.events;
begin
  if not public.is_admin() then raise exception 'Hanya moderator'; end if;
  select * into ev from public.events where id = p_event_id;
  if not found then raise exception 'Sesi GL tidak ditemukan'; end if;
  if ev.is_permanent or ev.parent_id is null or ev.mode <> 'guild_league' then
    raise exception 'Hanya sesi Guild League yang bisa dihapus di sini';
  end if;
  delete from public.events where id = p_event_id;
end $$;
revoke execute on function public.delete_gl_session(bigint) from public, anon;
grant execute on function public.delete_gl_session(bigint) to authenticated;

-- Jadwal GL: dua GL bisa di hari yang sama (21:30 dan 22:00), jadi sesi lama dipakai ulang hanya jika selisih < 15 menit
create or replace function public.create_gl_session(p_played_at timestamptz)
returns bigint language plpgsql security definer set search_path = public as $$
declare b public.events; v_id bigint;
begin
  if not public.is_admin() then raise exception 'Hanya admin'; end if;
  select * into b from public.events where is_permanent and mode = 'guild_league' order by id limit 1;
  if not found then raise exception 'Papan Guild League tidak ditemukan'; end if;
  select id into v_id from public.events
   where parent_id = b.id and abs(extract(epoch from (starts_at - p_played_at))) < 15 * 60
   order by id limit 1;
  if v_id is not null then return v_id; end if;
  insert into public.events (mode, title, starts_at, party_count, party_size, main_count, sections, status, notes, created_by, parent_id)
  values (b.mode, b.title || ' – ' || to_char(p_played_at at time zone 'Asia/Jakarta', 'DD Mon YYYY HH24:MI'),
          p_played_at, b.party_count, b.party_size, b.main_count, b.sections, 'done', null, auth.uid(), b.id)
  returning id into v_id;
  return v_id;
end $$;

-- Pindahkan sesi GL ke tanggal/jam lain (salah slot)
create or replace function public.move_gl_session(p_event_id bigint, p_played_at timestamptz)
returns void language plpgsql security definer set search_path = public as $$
declare ev public.events;
begin
  if not public.is_admin() then raise exception 'Hanya moderator'; end if;
  select * into ev from public.events where id = p_event_id;
  if not found or ev.is_permanent or ev.parent_id is null or ev.mode <> 'guild_league' then
    raise exception 'Sesi GL tidak ditemukan';
  end if;
  update public.events
     set starts_at = p_played_at,
         title = 'Guild League – ' || to_char(p_played_at at time zone 'Asia/Jakarta', 'DD Mon YYYY HH24:MI')
   where id = p_event_id;
end $$;
revoke execute on function public.move_gl_session(bigint, timestamptz) from public, anon;
grant execute on function public.move_gl_session(bigint, timestamptz) to authenticated;
notify pgrst, 'reload schema';
