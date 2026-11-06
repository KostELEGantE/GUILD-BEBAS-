-- =====================================================================
-- Ragnarok Guild Party Manager - skema database Supabase
-- Jalankan sekali di SQL Editor Supabase (sudah diterapkan otomatis
-- ke project "ragnarok-guild").
-- =====================================================================

-- ---------- Profil user (terhubung ke akun login Discord) ----------
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url  text,
  is_admin    boolean not null default false,
  created_at  timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name',
             new.raw_user_meta_data->>'name',
             new.raw_user_meta_data->>'user_name',
             split_part(new.email, '@', 1)),
    new.raw_user_meta_data->>'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false);
$$;

-- ---------- Member guild (dari export game) ----------
create table if not exists public.members (
  id                 bigint generated always as identity primary key,
  name               text not null,
  name_key           text generated always as (lower(btrim(name))) stored,
  level              int,
  class              text,
  title              text,
  gender             text,
  position           text,
  gear_score         int,
  weekly             int,
  weekly_contribution int,
  total_contribution int,
  online_status      text,
  role               text check (role in ('Tank','Healer','Support','DPS')),
  active             boolean not null default true,
  user_id            uuid references public.profiles(id) on delete set null,
  claimed_at         timestamptz,
  last_import_at     timestamptz,
  updated_at         timestamptz not null default now()
);
create unique index if not exists members_name_key_idx on public.members(name_key);
create index if not exists members_user_idx on public.members(user_id);

-- Role default berdasarkan class (bisa diubah per karakter)
create or replace function public.default_role(p_class text)
returns text language sql immutable as $$
  select case
    when p_class in ('Lord Knight','Paladin') then 'Tank'
    when p_class in ('High Priest') then 'Healer'
    when p_class in ('Clown','Gypsy','Scholar') then 'Support'
    else 'DPS'
  end;
$$;

-- ---------- Riwayat import ----------
create table if not exists public.imports (
  id          bigint generated always as identity primary key,
  kind        text not null default 'members' check (kind in ('members','attendance')),
  filename    text,
  row_count   int,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);

create table if not exists public.member_snapshots (
  import_id           bigint not null references public.imports(id) on delete cascade,
  member_id           bigint not null references public.members(id) on delete cascade,
  level               int,
  gear_score          int,
  weekly              int,
  weekly_contribution int,
  total_contribution  int,
  primary key (import_id, member_id)
);

-- ---------- Event (Guild League / Polarity Zone / Siege) ----------
create table if not exists public.events (
  id          bigint generated always as identity primary key,
  mode        text not null check (mode in ('guild_league','polarity_zone','siege')),
  title       text not null,
  starts_at   timestamptz not null,
  party_count int not null default 4 check (party_count between 1 and 30),
  party_size  int not null default 5 check (party_size between 1 and 20),
  status      text not null default 'open' check (status in ('open','locked','done')),
  notes       text,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists events_starts_idx on public.events(starts_at desc);

-- Nama party per event (opsional, mis. "Party Tank", "Party Def")
create table if not exists public.event_parties (
  event_id  bigint not null references public.events(id) on delete cascade,
  party_no  int not null,
  name      text,
  primary key (event_id, party_no)
);

-- Slot party. party_no NULL = cadangan (bench)
create table if not exists public.event_signups (
  id         bigint generated always as identity primary key,
  event_id   bigint not null references public.events(id) on delete cascade,
  member_id  bigint not null references public.members(id) on delete cascade,
  party_no   int,
  slot_no    int,
  note       text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (event_id, member_id),
  check ((party_no is null) = (slot_no is null))
);
create unique index if not exists event_signups_slot_idx
  on public.event_signups(event_id, party_no, slot_no) where party_no is not null;

-- ---------- Kehadiran ----------
create table if not exists public.attendance (
  event_id   bigint not null references public.events(id) on delete cascade,
  member_id  bigint not null references public.members(id) on delete cascade,
  status     text not null check (status in ('present','absent','excused')),
  source     text not null default 'import' check (source in ('import','manual')),
  updated_at timestamptz not null default now(),
  primary key (event_id, member_id)
);

-- =====================================================================
-- RLS
-- =====================================================================
alter table public.profiles         enable row level security;
alter table public.members          enable row level security;
alter table public.imports          enable row level security;
alter table public.member_snapshots enable row level security;
alter table public.events           enable row level security;
alter table public.event_parties    enable row level security;
alter table public.event_signups    enable row level security;
alter table public.attendance       enable row level security;

-- Semua user yang login boleh membaca
do $$
declare t text;
begin
  foreach t in array array['profiles','members','imports','member_snapshots','events',
                           'event_parties','event_signups','attendance']
  loop
    execute format('drop policy if exists "read_%1$s" on public.%1$I', t);
    execute format('create policy "read_%1$s" on public.%1$I for select to authenticated using (true)', t);
    execute format('drop policy if exists "admin_write_%1$s" on public.%1$I', t);
    execute format('create policy "admin_write_%1$s" on public.%1$I for all to authenticated using (public.is_admin()) with check (public.is_admin())', t);
  end loop;
end $$;

-- Member biasa mengubah data lewat fungsi di bawah (security definer),
-- jadi tidak perlu policy tulis tambahan.

-- =====================================================================
-- Fungsi (RPC)
-- =====================================================================

-- Klaim karakter milik sendiri
create or replace function public.claim_member(p_member_id bigint)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Harus login'; end if;
  update public.members
     set user_id = auth.uid(), claimed_at = now(), updated_at = now()
   where id = p_member_id and user_id is null and active;
  if not found then raise exception 'Karakter sudah diklaim orang lain atau tidak aktif'; end if;
end $$;

create or replace function public.unclaim_member(p_member_id bigint)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.members
     set user_id = null, claimed_at = null, updated_at = now()
   where id = p_member_id and (user_id = auth.uid() or public.is_admin());
  if not found then raise exception 'Tidak diizinkan'; end if;
end $$;

-- Ganti role karakter sendiri (admin bisa semua)
create or replace function public.set_member_role(p_member_id bigint, p_role text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_role not in ('Tank','Healer','Support','DPS') then raise exception 'Role tidak valid'; end if;
  update public.members set role = p_role, updated_at = now()
   where id = p_member_id and (user_id = auth.uid() or public.is_admin());
  if not found then raise exception 'Tidak diizinkan'; end if;
end $$;

-- Masuk ke slot party (atau cadangan bila p_party_no null)
create or replace function public.join_slot(p_event_id bigint, p_member_id bigint,
                                            p_party_no int, p_slot_no int)
returns void language plpgsql security definer set search_path = public as $$
declare ev public.events; m public.members; admin boolean := public.is_admin();
begin
  select * into ev from public.events where id = p_event_id;
  if not found then raise exception 'Event tidak ditemukan'; end if;
  select * into m from public.members where id = p_member_id;
  if not found then raise exception 'Karakter tidak ditemukan'; end if;
  if not admin then
    if m.user_id is distinct from auth.uid() then raise exception 'Ini bukan karakter Anda'; end if;
    if ev.status <> 'open' then raise exception 'Party sudah dikunci oleh admin'; end if;
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
declare ev public.events; m public.members;
begin
  select * into ev from public.events where id = p_event_id;
  select * into m from public.members where id = p_member_id;
  if not public.is_admin() then
    if m.user_id is distinct from auth.uid() then raise exception 'Ini bukan karakter Anda'; end if;
    if ev.status <> 'open' then raise exception 'Party sudah dikunci oleh admin'; end if;
  end if;
  delete from public.event_signups where event_id = p_event_id and member_id = p_member_id;
end $$;

-- Import member dari export game. p_rows = array JSON:
-- [{name, level, class, title, gender, position, gear_score, weekly,
--   weekly_contribution, total_contribution, online_status}, ...]
create or replace function public.import_members(p_rows jsonb, p_filename text,
                                                 p_deactivate_missing boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_import bigint;
  v_new int; v_upd int; v_off int := 0;
begin
  if not public.is_admin() then raise exception 'Hanya admin'; end if;

  drop table if exists _in;
  create temp table _in on commit drop as
  select distinct on (lower(btrim(r->>'name')))
         btrim(r->>'name')                        as name,
         lower(btrim(r->>'name'))                 as name_key,
         nullif(r->>'level','')::int              as level,
         nullif(btrim(r->>'class'),'')            as class,
         nullif(btrim(r->>'title'),'')            as title,
         nullif(btrim(r->>'gender'),'')           as gender,
         nullif(btrim(r->>'position'),'')         as position,
         nullif(r->>'gear_score','')::int         as gear_score,
         nullif(r->>'weekly','')::int             as weekly,
         nullif(r->>'weekly_contribution','')::int as weekly_contribution,
         nullif(r->>'total_contribution','')::int as total_contribution,
         nullif(btrim(r->>'online_status'),'')    as online_status
    from jsonb_array_elements(p_rows) r
   where coalesce(btrim(r->>'name'),'') <> '';

  insert into public.imports(kind, filename, row_count, created_by)
  values ('members', p_filename, (select count(*) from _in), auth.uid())
  returning id into v_import;

  select count(*) into v_new from _in i
   where not exists (select 1 from public.members m where m.name_key = i.name_key);
  select count(*) into v_upd from _in i
   where exists (select 1 from public.members m where m.name_key = i.name_key);

  insert into public.members as m
    (name, level, class, title, gender, position, gear_score, weekly,
     weekly_contribution, total_contribution, online_status, role, active, last_import_at, updated_at)
  select name, level, class, title, gender, position, gear_score, weekly,
         weekly_contribution, total_contribution, online_status,
         public.default_role(class), true, now(), now()
    from _in
  on conflict (name_key) do update set
    name = excluded.name,
    level = excluded.level,
    class = excluded.class,
    title = excluded.title,
    gender = excluded.gender,
    position = excluded.position,
    gear_score = excluded.gear_score,
    weekly = excluded.weekly,
    weekly_contribution = excluded.weekly_contribution,
    total_contribution = excluded.total_contribution,
    online_status = excluded.online_status,
    -- role ikut class baru hanya jika class berubah
    role = case when m.class is distinct from excluded.class
                then public.default_role(excluded.class) else m.role end,
    active = true,
    last_import_at = now(),
    updated_at = now();

  insert into public.member_snapshots
    (import_id, member_id, level, gear_score, weekly, weekly_contribution, total_contribution)
  select v_import, m.id, i.level, i.gear_score, i.weekly, i.weekly_contribution, i.total_contribution
    from _in i join public.members m on m.name_key = i.name_key;

  if p_deactivate_missing then
    update public.members m set active = false, updated_at = now()
     where m.active and not exists (select 1 from _in i where i.name_key = m.name_key);
    get diagnostics v_off = row_count;
  end if;

  return jsonb_build_object('import_id', v_import, 'new', v_new, 'updated', v_upd, 'deactivated', v_off);
end $$;

-- Import kehadiran sebuah event dari daftar nama (hasil game).
-- Yang ada di daftar = hadir. Yang daftar party tapi tidak ada di daftar = tidak hadir.
-- Status 'excused' (izin) yang diisi manual tidak ditimpa.
create or replace function public.import_attendance(p_event_id bigint, p_names text[],
                                                    p_filename text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_present int; v_absent int; v_unmatched text[];
begin
  if not public.is_admin() then raise exception 'Hanya admin'; end if;

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

create or replace function public.set_attendance(p_event_id bigint, p_member_id bigint, p_status text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Hanya admin'; end if;
  if p_status is null then
    delete from public.attendance where event_id = p_event_id and member_id = p_member_id;
  else
    insert into public.attendance (event_id, member_id, status, source, updated_at)
    values (p_event_id, p_member_id, p_status, 'manual', now())
    on conflict (event_id, member_id) do update
      set status = excluded.status, source = 'manual', updated_at = now();
  end if;
end $$;

-- Statistik partisipasi per member dalam N hari terakhir
-- (hanya event berstatus 'done' = sudah ada data kehadiran)
create or replace function public.participation_stats(p_days int default 30)
returns table (
  member_id bigint, name text, class text, role text, gear_score int,
  weekly_contribution int, active boolean, owner text,
  events_total int, signed_up int, present int, absent int, excused int,
  no_show int, attendance_rate numeric
) language sql stable security definer set search_path = public as $$
  with ev as (
    select id from public.events
     where status = 'done' and starts_at >= now() - make_interval(days => p_days)
  ), tot as (select count(*)::int n from ev)
  select m.id, m.name, m.class, m.role, m.gear_score, m.weekly_contribution, m.active,
         p.display_name,
         tot.n,
         (select count(*) from public.event_signups s
           where s.member_id = m.id and s.event_id in (select id from ev))::int,
         (select count(*) from public.attendance a
           where a.member_id = m.id and a.event_id in (select id from ev) and a.status = 'present')::int,
         (select count(*) from public.attendance a
           where a.member_id = m.id and a.event_id in (select id from ev) and a.status = 'absent')::int,
         (select count(*) from public.attendance a
           where a.member_id = m.id and a.event_id in (select id from ev) and a.status = 'excused')::int,
         (select count(*) from public.attendance a
            join public.event_signups s on s.event_id = a.event_id and s.member_id = a.member_id
           where a.member_id = m.id and a.event_id in (select id from ev) and a.status = 'absent')::int,
         case when tot.n = 0 then null
              else round(100.0 * (select count(*) from public.attendance a
                                   where a.member_id = m.id and a.event_id in (select id from ev)
                                     and a.status = 'present') / tot.n, 1) end
    from public.members m
    cross join tot
    left join public.profiles p on p.id = m.user_id
   where auth.uid() is not null
   order by m.active desc, m.name;
$$;

-- Admin pertama: user pertama yang menekan tombol "Jadikan saya admin"
-- (hanya berfungsi selama belum ada admin sama sekali)
create or replace function public.claim_first_admin()
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return false; end if;
  if exists (select 1 from public.profiles where is_admin) then return false; end if;
  update public.profiles set is_admin = true where id = auth.uid();
  return found;
end $$;

create or replace function public.admin_exists()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where is_admin);
$$;

revoke execute on function public.claim_first_admin(), public.admin_exists() from public, anon;
grant execute on function public.claim_first_admin(), public.admin_exists() to authenticated;

-- Fungsi hanya untuk user yang login
revoke execute on function public.claim_member(bigint), public.unclaim_member(bigint),
  public.set_member_role(bigint,text), public.join_slot(bigint,bigint,int,int),
  public.leave_event(bigint,bigint), public.import_members(jsonb,text,boolean),
  public.import_attendance(bigint,text[],text), public.set_attendance(bigint,bigint,text),
  public.participation_stats(int)
  from public, anon;
grant execute on function public.claim_member(bigint), public.unclaim_member(bigint),
  public.set_member_role(bigint,text), public.join_slot(bigint,bigint,int,int),
  public.leave_event(bigint,bigint), public.import_members(jsonb,text,boolean),
  public.import_attendance(bigint,text[],text), public.set_attendance(bigint,bigint,text),
  public.participation_stats(int)
  to authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- Realtime untuk party builder (perubahan slot langsung terlihat semua member)
do $$
begin
  begin alter publication supabase_realtime add table public.event_signups;
  exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.events;
  exception when duplicate_object then null; end;
end $$;
