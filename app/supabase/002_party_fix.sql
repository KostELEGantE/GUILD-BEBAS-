-- =====================================================================
-- 002: Papan tetap (GL & PZ), sesi kehadiran, Party Fix, hak anggota party
-- Jalankan sekali di SQL Editor Supabase setelah schema.sql.
-- =====================================================================

-- ---------- Papan tetap & sesi ----------
alter table public.events add column if not exists is_permanent boolean not null default false;
alter table public.events add column if not exists parent_id bigint references public.events(id) on delete set null;
create unique index if not exists events_one_board_per_mode on public.events(mode) where is_permanent;
create index if not exists events_parent_idx on public.events(parent_id);
-- party 1..main_count = Main, sisanya = party Sub. NULL = semua party adalah Main.
alter table public.events add column if not exists main_count int;
alter table public.events drop constraint if exists events_party_count_check;
alter table public.events add constraint events_party_count_check check (party_count between 1 and 60);

-- ---------- Party Fix (grup teman) ----------
create table if not exists public.groups (
  id         bigint generated always as identity primary key,
  name       text not null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.group_members (
  group_id  bigint not null references public.groups(id) on delete cascade,
  member_id bigint not null unique references public.members(id) on delete cascade,
  added_by  uuid references public.profiles(id) on delete set null,
  added_at  timestamptz not null default now(),
  primary key (group_id, member_id)
);

alter table public.groups        enable row level security;
alter table public.group_members enable row level security;
do $$
declare t text;
begin
  foreach t in array array['groups','group_members'] loop
    execute format('drop policy if exists "read_%1$s" on public.%1$I', t);
    execute format('create policy "read_%1$s" on public.%1$I for select to authenticated using (true)', t);
    execute format('drop policy if exists "admin_write_%1$s" on public.%1$I', t);
    execute format('create policy "admin_write_%1$s" on public.%1$I for all to authenticated using (public.is_admin()) with check (public.is_admin())', t);
  end loop;
end $$;

-- ---------- Helper ----------
-- Apakah user yang login punya karakter di party tertentu pada event ini
create or replace function public.my_in_party(p_event_id bigint, p_party_no int)
returns boolean language sql stable security definer set search_path = public as $$
  select p_party_no is not null and exists (
    select 1 from public.event_signups s join public.members m on m.id = s.member_id
     where s.event_id = p_event_id and s.party_no = p_party_no and m.user_id = auth.uid());
$$;

-- Apakah user yang login punya karakter di party fix ini
create or replace function public.in_my_group(p_group_id bigint)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.group_members gm join public.members m on m.id = gm.member_id
     where gm.group_id = p_group_id and m.user_id = auth.uid());
$$;

-- ---------- Slot party: anggota party boleh mengatur party-nya ----------
create or replace function public.join_slot(p_event_id bigint, p_member_id bigint,
                                            p_party_no int, p_slot_no int)
returns void language plpgsql security definer set search_path = public as $$
declare ev public.events; m public.members; cur int;
begin
  select * into ev from public.events where id = p_event_id;
  if not found then raise exception 'Event tidak ditemukan'; end if;
  select * into m from public.members where id = p_member_id;
  if not found then raise exception 'Karakter tidak ditemukan'; end if;

  if not public.is_admin() then
    if ev.status <> 'open' then raise exception 'Party sudah dikunci oleh admin'; end if;
    select party_no into cur from public.event_signups where event_id = p_event_id and member_id = p_member_id;
    -- karakter sendiri: bebas. Karakter orang lain: hanya ke party sendiri,
    -- dan hanya jika orang itu belum ada di party Main lain.
    if m.user_id is distinct from auth.uid() and not (
         public.my_in_party(p_event_id, p_party_no)
         and (cur is null or cur = p_party_no or cur > ev.party_count)) then
      raise exception 'Anda hanya bisa mengatur karakter sendiri atau party tempat Anda berada';
    end if;
  end if;

  if (p_party_no is null) <> (p_slot_no is null) then raise exception 'Slot tidak valid'; end if;
  if p_party_no is not null and (p_party_no < 1 or p_party_no > ev.party_count
                                 or p_slot_no < 1 or p_slot_no > ev.party_size) then
    raise exception 'Slot di luar jumlah party';
  end if;
  if p_party_no is not null and exists (
      select 1 from public.event_signups
       where event_id = p_event_id and party_no = p_party_no and slot_no = p_slot_no
         and member_id <> p_member_id) then
    raise exception 'Slot sudah terisi';
  end if;

  insert into public.event_signups (event_id, member_id, party_no, slot_no, created_by)
  values (p_event_id, p_member_id, p_party_no, p_slot_no, auth.uid())
  on conflict (event_id, member_id)
  do update set party_no = excluded.party_no, slot_no = excluded.slot_no;
end $$;

create or replace function public.leave_event(p_event_id bigint, p_member_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare ev public.events; m public.members; cur int;
begin
  select * into ev from public.events where id = p_event_id;
  select * into m from public.members where id = p_member_id;
  select party_no into cur from public.event_signups where event_id = p_event_id and member_id = p_member_id;
  if not public.is_admin() then
    if ev.status <> 'open' then raise exception 'Party sudah dikunci oleh admin'; end if;
    if m.user_id is distinct from auth.uid() and not public.my_in_party(p_event_id, cur) then
      raise exception 'Anda hanya bisa mengeluarkan orang dari party Anda sendiri';
    end if;
  end if;
  delete from public.event_signups where event_id = p_event_id and member_id = p_member_id;
end $$;

create or replace function public.rename_party(p_event_id bigint, p_party_no int, p_name text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (public.is_admin() or public.my_in_party(p_event_id, p_party_no)) then
    raise exception 'Hanya anggota party ini yang bisa mengganti nama';
  end if;
  insert into public.event_parties (event_id, party_no, name)
  values (p_event_id, p_party_no, nullif(btrim(p_name), ''))
  on conflict (event_id, party_no) do update set name = excluded.name;
end $$;

-- Tambah 1 party (untuk member yang mau memimpin party baru)
create or replace function public.add_party(p_event_id bigint)
returns int language plpgsql security definer set search_path = public as $$
declare ev public.events; v int;
begin
  select * into ev from public.events where id = p_event_id;
  if not found then raise exception 'Event tidak ditemukan'; end if;
  if not public.is_admin() then
    if ev.status <> 'open' then raise exception 'Party sudah dikunci oleh admin'; end if;
    if not exists (select 1 from public.members where user_id = auth.uid() and active) then
      raise exception 'Klaim karakter Anda dulu';
    end if;
  end if;
  if ev.party_count >= 60 then raise exception 'Maksimal 60 party'; end if;
  update public.events set party_count = party_count + 1 where id = p_event_id returning party_count into v;
  return v;
end $$;

-- ---------- Party Fix ----------
create or replace function public.create_group(p_name text, p_member_ids bigint[])
returns bigint language plpgsql security definer set search_path = public as $$
declare v_ids bigint[]; v_id bigint; v_taken text;
begin
  if auth.uid() is null then raise exception 'Harus login'; end if;
  select array_agg(distinct x) into v_ids from unnest(p_member_ids) x;
  if coalesce(cardinality(v_ids), 0) < 2 then raise exception 'Party fix minimal 2 orang'; end if;
  if not public.is_admin() and not exists (
      select 1 from public.members where id = any(v_ids) and user_id = auth.uid()) then
    raise exception 'Masukkan karakter Anda sendiri ke party fix ini';
  end if;
  select string_agg(m.name, ', ') into v_taken
    from public.group_members gm join public.members m on m.id = gm.member_id
   where gm.member_id = any(v_ids);
  if v_taken is not null then raise exception 'Sudah ada di party fix lain: %', v_taken; end if;

  insert into public.groups (name, created_by)
  values (coalesce(nullif(btrim(p_name), ''), 'Party Fix'), auth.uid())
  returning id into v_id;
  insert into public.group_members (group_id, member_id, added_by)
  select v_id, x, auth.uid() from unnest(v_ids) x;
  return v_id;
end $$;

create or replace function public.group_add_member(p_group_id bigint, p_member_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare v_other text;
begin
  if not (public.is_admin() or public.in_my_group(p_group_id)) then
    raise exception 'Hanya anggota party fix ini yang bisa menambah anggota';
  end if;
  select g.name into v_other from public.group_members gm join public.groups g on g.id = gm.group_id
   where gm.member_id = p_member_id;
  if v_other is not null then raise exception 'Karakter ini sudah ada di party fix "%"', v_other; end if;
  insert into public.group_members (group_id, member_id, added_by) values (p_group_id, p_member_id, auth.uid());
end $$;

-- Keluarkan anggota (atau keluar sendiri). Jika sisa < 2 orang, party fix dibubarkan.
create or replace function public.group_remove_member(p_group_id bigint, p_member_id bigint)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_left int;
begin
  if not (public.is_admin() or public.in_my_group(p_group_id)) then
    raise exception 'Tidak diizinkan';
  end if;
  delete from public.group_members where group_id = p_group_id and member_id = p_member_id;
  select count(*) into v_left from public.group_members where group_id = p_group_id;
  if v_left < 2 then
    delete from public.groups where id = p_group_id;
    return true;
  end if;
  return false;
end $$;

create or replace function public.rename_group(p_group_id bigint, p_name text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (public.is_admin() or public.in_my_group(p_group_id)) then raise exception 'Tidak diizinkan'; end if;
  update public.groups set name = coalesce(nullif(btrim(p_name), ''), name) where id = p_group_id;
end $$;

create or replace function public.delete_group(p_group_id bigint)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (public.is_admin() or public.in_my_group(p_group_id)) then raise exception 'Tidak diizinkan'; end if;
  delete from public.groups where id = p_group_id;
end $$;

-- Masukkan seluruh party fix ke papan/event secara bersamaan.
-- Party pilihan (p_start_party) dicoba dulu, lalu party lain dari nomor kecil.
-- Grup > ukuran party dipecah ke party berikutnya. Jika Main penuh, sisanya ke Sub.
create or replace function public.place_group(p_event_id bigint, p_group_id bigint,
                                              p_start_party int default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  ev public.events; ids bigint[]; ord int[]; n int; i int := 1;
  need int; best int; best_free int; free int; p int; v_slot int;
  placed int := 0; to_sub int := 0;
begin
  select * into ev from public.events where id = p_event_id;
  if not found then raise exception 'Event tidak ditemukan'; end if;
  if not public.is_admin() then
    if ev.status <> 'open' then raise exception 'Party sudah dikunci oleh admin'; end if;
    if not public.in_my_group(p_group_id) then raise exception 'Ini bukan party fix Anda'; end if;
  end if;

  select array_agg(gm.member_id order by gm.added_at, gm.member_id) into ids
    from public.group_members gm join public.members m on m.id = gm.member_id
   where gm.group_id = p_group_id and m.active;
  if ids is null then raise exception 'Party fix kosong'; end if;
  n := cardinality(ids);

  delete from public.event_signups where event_id = p_event_id and member_id = any(ids);

  select array_agg(x order by (case when x = p_start_party then 0 else 1 end), x) into ord
    from generate_series(1, ev.party_count) x;

  while i <= n loop
    need := least(ev.party_size, n - i + 1);
    best := null; best_free := 0;
    foreach p in array ord loop
      select ev.party_size - count(*) into free from public.event_signups
       where event_id = p_event_id and party_no = p and slot_no <= ev.party_size;
      if free >= need then best := p; best_free := free; exit; end if;
      if free > best_free then best := p; best_free := free; end if;
    end loop;
    exit when best is null or best_free = 0;

    for k in 1 .. least(need, best_free) loop
      select min(s) into v_slot from generate_series(1, ev.party_size) s
       where not exists (select 1 from public.event_signups
                          where event_id = p_event_id and party_no = best and slot_no = s);
      insert into public.event_signups (event_id, member_id, party_no, slot_no, created_by)
      values (p_event_id, ids[i], best, v_slot, auth.uid());
      i := i + 1; placed := placed + 1;
    end loop;
  end loop;

  while i <= n loop
    insert into public.event_signups (event_id, member_id, created_by) values (p_event_id, ids[i], auth.uid());
    i := i + 1; to_sub := to_sub + 1;
  end loop;

  return jsonb_build_object('placed', placed, 'sub', to_sub);
end $$;

-- ---------- Konfirmasi war: salin susunan papan + semua yang di Main tercatat hadir ----------
create or replace function public.confirm_war(p_board_id bigint, p_played_at timestamptz default now())
returns bigint language plpgsql security definer set search_path = public as $$
declare b public.events; v_id bigint; v_main int;
begin
  if not public.is_admin() then raise exception 'Hanya admin'; end if;
  select * into b from public.events where id = p_board_id and is_permanent;
  if not found then raise exception 'Papan tidak ditemukan'; end if;
  v_main := coalesce(b.main_count, b.party_count);

  insert into public.events (mode, title, starts_at, party_count, party_size, main_count, status, notes, created_by, parent_id)
  values (b.mode, b.title || ' – ' || to_char(p_played_at at time zone 'Asia/Jakarta', 'DD Mon YYYY HH24:MI'),
          p_played_at, b.party_count, b.party_size, b.main_count, 'done', b.notes, auth.uid(), b.id)
  returning id into v_id;

  insert into public.event_parties (event_id, party_no, name)
  select v_id, party_no, name from public.event_parties where event_id = b.id;

  insert into public.event_signups (event_id, member_id, party_no, slot_no, note, created_by)
  select v_id, member_id, party_no, slot_no, note, created_by from public.event_signups where event_id = b.id;

  -- semua yang ada di party Main = hadir (bisa dikoreksi manual di halaman sesi)
  insert into public.attendance (event_id, member_id, status, source)
  select v_id, member_id, 'present', 'manual' from public.event_signups
   where event_id = b.id and party_no between 1 and v_main and slot_no <= b.party_size;

  return v_id;
end $$;

-- Import kehadiran tidak boleh menandai papan tetap sebagai "selesai"
create or replace function public.import_attendance(p_event_id bigint, p_names text[],
                                                    p_filename text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_present int; v_absent int; v_unmatched text[];
begin
  if not public.is_admin() then raise exception 'Hanya admin'; end if;
  if exists (select 1 from public.events where id = p_event_id and is_permanent) then
    raise exception 'Mulai sesi dulu, lalu import kehadiran di sesi tersebut';
  end if;

  drop table if exists _n;
  create temp table _n on commit drop as
  select distinct lower(btrim(x)) as name_key
    from unnest(p_names) x where coalesce(btrim(x),'') <> '';

  select coalesce(array_agg(n.name_key order by n.name_key), '{}') into v_unmatched
    from _n n where not exists (select 1 from public.members m where m.name_key = n.name_key);

  insert into public.attendance (event_id, member_id, status, source, updated_at)
  select p_event_id, m.id, 'present', 'import', now()
    from public.members m join _n n on n.name_key = m.name_key
  on conflict (event_id, member_id) do update
    set status = 'present', source = 'import', updated_at = now();
  get diagnostics v_present = row_count;

  insert into public.attendance (event_id, member_id, status, source, updated_at)
  select p_event_id, s.member_id, 'absent', 'import', now()
    from public.event_signups s join public.members m on m.id = s.member_id
   where s.event_id = p_event_id
     and not exists (select 1 from _n n where n.name_key = m.name_key)
  on conflict (event_id, member_id) do update
    set status = 'absent', source = 'import', updated_at = now()
    where public.attendance.status <> 'excused';
  get diagnostics v_absent = row_count;

  insert into public.imports(kind, filename, row_count, created_by)
  values ('attendance', p_filename, cardinality(p_names), auth.uid());

  update public.events set status = 'done' where id = p_event_id;

  return jsonb_build_object('present', v_present, 'absent', v_absent, 'unmatched', v_unmatched);
end $$;

-- ---------- Izin fungsi ----------
revoke execute on function
  public.my_in_party(bigint,int), public.in_my_group(bigint),
  public.join_slot(bigint,bigint,int,int), public.leave_event(bigint,bigint),
  public.rename_party(bigint,int,text), public.add_party(bigint),
  public.create_group(text,bigint[]), public.group_add_member(bigint,bigint),
  public.group_remove_member(bigint,bigint), public.rename_group(bigint,text),
  public.delete_group(bigint), public.place_group(bigint,bigint,int),
  public.confirm_war(bigint,timestamptz), public.import_attendance(bigint,text[],text)
  from public, anon;
grant execute on function
  public.my_in_party(bigint,int), public.in_my_group(bigint),
  public.join_slot(bigint,bigint,int,int), public.leave_event(bigint,bigint),
  public.rename_party(bigint,int,text), public.add_party(bigint),
  public.create_group(text,bigint[]), public.group_add_member(bigint,bigint),
  public.group_remove_member(bigint,bigint), public.rename_group(bigint,text),
  public.delete_group(bigint), public.place_group(bigint,bigint,int),
  public.confirm_war(bigint,timestamptz), public.import_attendance(bigint,text[],text)
  to authenticated;

-- ---------- Papan tetap Guild League & Polarity Zone ----------
-- Event Guild League pertama yang sudah ada dijadikan papan tetap (susunannya dipertahankan)
update public.events set is_permanent = true, title = 'Guild League', status = 'open'
 where id = (select min(id) from public.events where mode = 'guild_league' and parent_id is null)
   and not exists (select 1 from public.events where is_permanent and mode = 'guild_league');

insert into public.events (mode, title, starts_at, party_count, party_size, is_permanent)
select 'guild_league', 'Guild League', now(), 30, 5, true
 where not exists (select 1 from public.events where is_permanent and mode = 'guild_league');

insert into public.events (mode, title, starts_at, party_count, party_size, is_permanent)
select 'polarity_zone', 'Polarity Zone', now(), 30, 5, true
 where not exists (select 1 from public.events where is_permanent and mode = 'polarity_zone');

-- Papan tetap: 12 party Main (60 orang) + 18 party Sub (90 orang) = 150
update public.events set main_count = 12, party_count = greatest(party_count, 30)
 where is_permanent and main_count is null;

-- Realtime untuk party fix
do $$
begin
  begin alter publication supabase_realtime add table public.group_members;
  exception when duplicate_object then null; end;
end $$;
