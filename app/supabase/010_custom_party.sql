-- =====================================================================
-- 010: Party bebas (mode ketik sendiri, mis. "Valkyrie")
-- * Semua member yang sudah klaim karakter bisa membuat event mode 'custom'
--   dengan nama mode bebas (custom_mode), jumlah party & slot per party sendiri.
-- * Pembuat event = "admin" untuk event itu: atur slot, kunci, ubah, hapus.
-- * one_per_account: satu akun hanya boleh memasukkan 1 karakter.
-- * Slot bisa ditutup/dibooking (mis. untuk pemain guild lain): event_parties.reserved
--   berisi {"<nomor slot>": "<nama>"}.
-- * Event custom tidak dihitung di statistik kehadiran guild.
-- =====================================================================
alter table public.events drop constraint if exists events_mode_check;
alter table public.events add constraint events_mode_check
  check (mode in ('guild_league','polarity_zone','siege','custom'));
alter table public.events add column if not exists custom_mode text;
alter table public.events add column if not exists one_per_account boolean not null default false;
alter table public.event_parties add column if not exists reserved jsonb not null default '{}'::jsonb;

-- pembuat event custom (yang tidak diblokir)
create or replace function public.is_event_owner(p_event_id bigint)
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and not public.is_banned() and exists (
    select 1 from public.events where id = p_event_id and mode = 'custom' and created_by = auth.uid());
$$;

-- hak penuh atas satu event: moderator, atau pembuat event custom
create or replace function public.event_admin(p_event_id bigint)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin() or public.is_event_owner(p_event_id);
$$;

create or replace function public.reserved_slots(p_event_id bigint, p_party_no int)
returns int[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(k::int), '{}') from public.event_parties ep, jsonb_object_keys(ep.reserved) k
   where ep.event_id = p_event_id and ep.party_no = p_party_no;
$$;

-- ---------- izin tabel events untuk member ----------
do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='events' and policyname='member_insert_custom') then
    create policy "member_insert_custom" on public.events for insert to authenticated
      with check (mode = 'custom' and created_by = auth.uid() and not is_permanent and parent_id is null
                  and exists (select 1 from public.members where user_id = auth.uid() and active));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='events' and policyname='owner_update_custom') then
    create policy "owner_update_custom" on public.events for update to authenticated
      using (mode = 'custom' and created_by = auth.uid())
      with check (mode = 'custom' and created_by = auth.uid() and not is_permanent and parent_id is null);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='events' and policyname='owner_delete_custom') then
    create policy "owner_delete_custom" on public.events for delete to authenticated
      using (mode = 'custom' and created_by = auth.uid());
  end if;
end $$;

-- ---------- fungsi lama: is_admin() -> event_admin(p_event_id) ----------
do $$
declare f text; d text;
begin
  foreach f in array array[
    'public.can_manage_party(bigint,int)',
    'public.claim_party_leader(bigint,int,bigint)',
    'public.release_party_leader(bigint,int)',
    'public.leave_event(bigint,bigint)',
    'public.add_party(bigint)'] loop
    d := pg_get_functiondef(f::regprocedure);
    d := replace(d, 'public.is_admin()', 'public.event_admin(p_event_id)');
    execute d;
  end loop;
  -- statistik kehadiran guild tidak menghitung event custom
  d := pg_get_functiondef('public.participation_stats(int)'::regprocedure);
  if d not like '%mode <> ''custom''%' then
    d := replace(d, 'where status = ''done'' and starts_at', 'where status = ''done'' and mode <> ''custom'' and starts_at');
    execute d;
  end if;
end $$;

-- ---------- masuk slot: booking & 1 karakter per akun ----------
create or replace function public.join_slot(p_event_id bigint, p_member_id bigint,
                                            p_party_no int, p_slot_no int)
returns void language plpgsql security definer set search_path = public as $$
declare ev public.events; m public.members; cur int; v_admin boolean := public.event_admin(p_event_id);
begin
  select * into ev from public.events where id = p_event_id;
  if not found then raise exception 'Event tidak ditemukan'; end if;
  select * into m from public.members where id = p_member_id;
  if not found then raise exception 'Karakter tidak ditemukan'; end if;

  if not v_admin then
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
  if p_party_no is not null and p_slot_no = any(public.reserved_slots(p_event_id, p_party_no)) then
    raise exception 'Slot ini sudah dibooking';
  end if;
  if p_party_no is not null and exists (
      select 1 from public.event_signups
       where event_id = p_event_id and party_no = p_party_no and slot_no = p_slot_no
         and member_id <> p_member_id) then
    raise exception 'Slot sudah terisi';
  end if;
  if ev.one_per_account and m.user_id is not null and exists (
      select 1 from public.event_signups s join public.members x on x.id = s.member_id
       where s.event_id = p_event_id and x.user_id = m.user_id and s.member_id <> p_member_id) then
    raise exception 'Event ini hanya boleh 1 karakter per akun';
  end if;

  insert into public.event_signups (event_id, member_id, party_no, slot_no, created_by)
  values (p_event_id, p_member_id, p_party_no, p_slot_no, auth.uid())
  on conflict (event_id, member_id)
  do update set party_no = excluded.party_no, slot_no = excluded.slot_no;
end $$;

-- ---------- party fix: lewati slot booking & 1 karakter per akun ----------
create or replace function public.place_group(p_event_id bigint, p_group_id bigint,
                                              p_start_party int default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  ev public.events; ids bigint[]; ord int[]; n int; i int := 1;
  need int; best int; best_free int; free int; p int; v_slot int;
  placed int := 0; to_sub int := 0; skipped int := 0; kept bigint[];
  v_admin boolean := public.event_admin(p_event_id); v_member boolean := public.in_my_group(p_group_id);
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

  -- 1 akun = 1 karakter: per akun hanya 1 karakter grup yang ikut (yang sudah ada di event diutamakan),
  -- dan akun yang sudah punya karakter lain di event ini dilewati
  if ev.one_per_account then
    select coalesce(array_agg(t.id order by t.ord), '{}') into kept from (
      select x.id, x.ord,
             row_number() over (partition by coalesce(m.user_id::text, 'm' || x.id)
                                order by (exists (select 1 from public.event_signups s
                                                   where s.event_id = p_event_id and s.member_id = x.id)) desc, x.ord) rn
        from unnest(ids) with ordinality x(id, ord) join public.members m on m.id = x.id
       where m.user_id is null or not exists (
               select 1 from public.event_signups s join public.members b on b.id = s.member_id
                where s.event_id = p_event_id and b.user_id = m.user_id and not (b.id = any(ids)))
    ) t where t.rn = 1;
    skipped := n - cardinality(kept);
    ids := kept; n := cardinality(ids);
    if n = 0 then raise exception 'Event ini hanya boleh 1 karakter per akun'; end if;
  end if;

  delete from public.event_signups where event_id = p_event_id and member_id = any(ids);

  select array_agg(x order by (case when x = p_start_party then 0 else 1 end), x) into ord
    from generate_series(1, ev.party_count) x
   where v_admin or public.i_lead(p_event_id, x)
      or (v_member and not public.party_has_leader(p_event_id, x));
  if ord is null then ord := '{}'; end if;

  while i <= n loop
    need := least(ev.party_size, n - i + 1);
    best := null; best_free := 0;
    foreach p in array ord loop
      select count(*) into free from generate_series(1, ev.party_size) s
       where not (s = any(public.reserved_slots(p_event_id, p)))
         and not exists (select 1 from public.event_signups
                          where event_id = p_event_id and party_no = p and slot_no = s);
      if free >= need then best := p; best_free := free; exit; end if;
      if free > best_free then best := p; best_free := free; end if;
    end loop;
    exit when best is null or best_free = 0;
    for k in 1 .. least(need, best_free) loop
      select min(s) into v_slot from generate_series(1, ev.party_size) s
       where not (s = any(public.reserved_slots(p_event_id, best)))
         and not exists (select 1 from public.event_signups
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

  return jsonb_build_object('placed', placed, 'sub', to_sub, 'skipped', skipped);
end $$;

-- ---------- tutup / buka slot (booking untuk pemain dari luar guild) ----------
create or replace function public.reserve_slot(p_event_id bigint, p_party_no int, p_slot_no int, p_label text)
returns void language plpgsql security definer set search_path = public as $$
declare ev public.events; v_label text := left(nullif(btrim(p_label), ''), 40);
begin
  select * into ev from public.events where id = p_event_id;
  if not found then raise exception 'Event tidak ditemukan'; end if;
  if ev.is_permanent and nullif(btrim(p_label), '') is not null then raise exception 'Slot booking tidak dipakai di papan Guild League / Polarity Zone'; end if;
  if not public.event_admin(p_event_id) then
    raise exception 'Hanya pembuat event atau moderator yang bisa menutup slot';
  end if;
  if p_party_no < 1 or p_party_no > ev.party_count or p_slot_no < 1 or p_slot_no > ev.party_size then
    raise exception 'Slot di luar jumlah party';
  end if;
  if v_label is null then
    update public.event_parties set reserved = reserved - p_slot_no::text
     where event_id = p_event_id and party_no = p_party_no;
    return;
  end if;
  if exists (select 1 from public.event_signups
              where event_id = p_event_id and party_no = p_party_no and slot_no = p_slot_no) then
    raise exception 'Slot sudah terisi';
  end if;
  insert into public.event_parties (event_id, party_no, reserved)
  values (p_event_id, p_party_no, jsonb_build_object(p_slot_no::text, v_label))
  on conflict (event_id, party_no)
  do update set reserved = public.event_parties.reserved || jsonb_build_object(p_slot_no::text, v_label);
end $$;

revoke execute on function public.is_event_owner(bigint), public.event_admin(bigint),
  public.reserved_slots(bigint,int), public.reserve_slot(bigint,int,int,text) from public, anon;
grant execute on function public.is_event_owner(bigint), public.event_admin(bigint),
  public.reserved_slots(bigint,int), public.reserve_slot(bigint,int,int,text) to authenticated;
