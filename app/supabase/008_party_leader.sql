-- =====================================================================
-- 008: Party leader
-- Setiap party bisa diklaim seorang leader (karakter yang sudah diklaim).
-- Satu akun boleh memimpin maksimal 8 party per papan/event.
-- Party ber-leader hanya bisa diisi/diubah oleh leader-nya dan moderator.
-- =====================================================================
alter table public.event_parties add column if not exists leader_member_id bigint references public.members(id) on delete set null;

-- akun pemilik leader party (null jika tidak ada leader)
create or replace function public.party_leader_user(p_event_id bigint, p_party_no int)
returns uuid language sql stable security definer set search_path = public as $$
  select m.user_id from public.event_parties ep join public.members m on m.id = ep.leader_member_id
   where ep.event_id = p_event_id and ep.party_no = p_party_no;
$$;

create or replace function public.party_has_leader(p_event_id bigint, p_party_no int)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.event_parties
                  where event_id = p_event_id and party_no = p_party_no and leader_member_id is not null);
$$;

create or replace function public.i_lead(p_event_id bigint, p_party_no int)
returns boolean language sql stable security definer set search_path = public as $$
  select p_party_no is not null and public.party_leader_user(p_event_id, p_party_no) = auth.uid();
$$;

-- boleh mengatur isi party: moderator, leader-nya, atau (party tanpa leader) anggota di dalamnya
create or replace function public.can_manage_party(p_event_id bigint, p_party_no int)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin() or public.i_lead(p_event_id, p_party_no)
      or (not public.party_has_leader(p_event_id, p_party_no) and public.my_in_party(p_event_id, p_party_no));
$$;

create or replace function public.claim_party_leader(p_event_id bigint, p_party_no int, p_member_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare ev public.events; m public.members; v_cur uuid; v_count int; v_owner uuid;
begin
  select * into ev from public.events where id = p_event_id;
  if not found then raise exception 'Event tidak ditemukan'; end if;
  if p_party_no < 1 or p_party_no > ev.party_count then raise exception 'Party tidak ada'; end if;
  select * into m from public.members where id = p_member_id;
  if not found or not m.active then raise exception 'Karakter tidak ditemukan'; end if;

  if not public.is_admin() then
    if ev.status <> 'open' then raise exception 'Party sudah dikunci oleh admin'; end if;
    if m.user_id is distinct from auth.uid() then raise exception 'Pilih karakter Anda sendiri sebagai leader'; end if;
    v_cur := public.party_leader_user(p_event_id, p_party_no);
    if v_cur is not null and v_cur <> auth.uid() then raise exception 'Party ini sudah punya leader'; end if;
  end if;

  v_owner := m.user_id;
  if v_owner is not null then
    select count(*) into v_count from public.event_parties ep join public.members lm on lm.id = ep.leader_member_id
     where ep.event_id = p_event_id and lm.user_id = v_owner and ep.party_no <> p_party_no;
    if v_count >= 8 then raise exception 'Maksimal memimpin 8 party per papan'; end if;
  end if;

  insert into public.event_parties (event_id, party_no, leader_member_id)
  values (p_event_id, p_party_no, p_member_id)
  on conflict (event_id, party_no) do update set leader_member_id = excluded.leader_member_id;
end $$;

create or replace function public.release_party_leader(p_event_id bigint, p_party_no int)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (public.is_admin() or public.i_lead(p_event_id, p_party_no)) then
    raise exception 'Hanya leader party ini atau moderator';
  end if;
  update public.event_parties set leader_member_id = null where event_id = p_event_id and party_no = p_party_no;
end $$;

-- ---------- aturan slot dengan leader ----------
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
    if p_party_no is not null and public.party_has_leader(p_event_id, p_party_no)
       and not public.i_lead(p_event_id, p_party_no) then
      raise exception 'Party ini punya leader. Minta leader-nya memasukkan Anda.';
    end if;
    select party_no into cur from public.event_signups where event_id = p_event_id and member_id = p_member_id;
    if m.user_id is distinct from auth.uid() and not (
         public.can_manage_party(p_event_id, p_party_no)
         and (cur is null or cur = p_party_no or cur > ev.party_count or public.i_lead(p_event_id, cur))) then
      raise exception 'Anda hanya bisa mengatur karakter sendiri atau party yang Anda kelola';
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
    if m.user_id is distinct from auth.uid() and not public.can_manage_party(p_event_id, cur) then
      raise exception 'Anda hanya bisa mengeluarkan orang dari party yang Anda kelola';
    end if;
  end if;
  delete from public.event_signups where event_id = p_event_id and member_id = p_member_id;
end $$;

create or replace function public.rename_party(p_event_id bigint, p_party_no int, p_name text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.can_manage_party(p_event_id, p_party_no) then
    raise exception 'Hanya leader/anggota party ini yang bisa mengganti nama';
  end if;
  insert into public.event_parties (event_id, party_no, name)
  values (p_event_id, p_party_no, nullif(btrim(p_name), ''))
  on conflict (event_id, party_no) do update set name = excluded.name;
end $$;

-- Party fix: anggota grup -> ke party tanpa leader atau yang dia pimpin;
-- leader -> boleh memasukkan party fix mana pun ke party yang dia pimpin.
create or replace function public.place_group(p_event_id bigint, p_group_id bigint,
                                              p_start_party int default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  ev public.events; ids bigint[]; ord int[]; n int; i int := 1;
  need int; best int; best_free int; free int; p int; v_slot int;
  placed int := 0; to_sub int := 0;
  v_admin boolean := public.is_admin(); v_member boolean := public.in_my_group(p_group_id);
begin
  select * into ev from public.events where id = p_event_id;
  if not found then raise exception 'Event tidak ditemukan'; end if;
  if not v_admin then
    if ev.status <> 'open' then raise exception 'Party sudah dikunci oleh admin'; end if;
    if not (v_member or public.i_lead(p_event_id, p_start_party)) then
      raise exception 'Ini bukan party fix Anda';
    end if;
  end if;

  select array_agg(gm.member_id order by gm.added_at, gm.member_id) into ids
    from public.group_members gm join public.members m on m.id = gm.member_id
   where gm.group_id = p_group_id and m.active;
  if ids is null then raise exception 'Party fix kosong'; end if;
  n := cardinality(ids);

  delete from public.event_signups where event_id = p_event_id and member_id = any(ids);

  -- party yang boleh dipakai, party pilihan dulu
  select array_agg(x order by (case when x = p_start_party then 0 else 1 end), x) into ord
    from generate_series(1, ev.party_count) x
   where v_admin or public.i_lead(p_event_id, x)
      or (v_member and not public.party_has_leader(p_event_id, x));
  if ord is null then ord := '{}'; end if;

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

-- riwayat war ikut menyimpan leader
create or replace function public.confirm_war(p_board_id bigint, p_played_at timestamptz default now())
returns bigint language plpgsql security definer set search_path = public as $$
declare b public.events; v_id bigint;
begin
  if not public.is_admin() then raise exception 'Hanya admin'; end if;
  select * into b from public.events where id = p_board_id and is_permanent;
  if not found then raise exception 'Papan tidak ditemukan'; end if;
  insert into public.events (mode, title, starts_at, party_count, party_size, main_count, sections, status, notes, created_by, parent_id)
  values (b.mode, b.title || ' – ' || to_char(p_played_at at time zone 'Asia/Jakarta', 'DD Mon YYYY HH24:MI'),
          p_played_at, b.party_count, b.party_size, b.main_count, b.sections, 'done', b.notes, auth.uid(), b.id)
  returning id into v_id;
  insert into public.event_parties (event_id, party_no, name, leader_member_id)
  select v_id, party_no, name, leader_member_id from public.event_parties where event_id = b.id;
  insert into public.event_signups (event_id, member_id, party_no, slot_no, note, created_by)
  select v_id, member_id, party_no, slot_no, note, created_by from public.event_signups where event_id = b.id;
  insert into public.attendance (event_id, member_id, status, source)
  select v_id, member_id, 'present', 'manual' from public.event_signups
   where event_id = b.id and party_no is not null and slot_no <= b.party_size
     and public.attend_party(b, party_no);
  return v_id;
end $$;

revoke execute on function public.party_leader_user(bigint,int), public.party_has_leader(bigint,int),
  public.i_lead(bigint,int), public.can_manage_party(bigint,int),
  public.claim_party_leader(bigint,int,bigint), public.release_party_leader(bigint,int) from public, anon;
grant execute on function public.party_leader_user(bigint,int), public.party_has_leader(bigint,int),
  public.i_lead(bigint,int), public.can_manage_party(bigint,int),
  public.claim_party_leader(bigint,int,bigint), public.release_party_leader(bigint,int) to authenticated;
