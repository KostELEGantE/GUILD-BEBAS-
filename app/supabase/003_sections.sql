-- =====================================================================
-- 003: Bagian party per event (mis. PZ: STAR + Normal Dungeon 1-4)
-- sections = [{"name":"STAR","prefix":"STAR","parties":10,"attend":true}, ...]
-- Party diberi nomor berurutan melewati semua bagian.
-- attend = true -> anggota bagian ini tercatat hadir saat Konfirmasi war.
-- =====================================================================
alter table public.events add column if not exists sections jsonb;

-- Nomor party yang dihitung hadir untuk sebuah event
create or replace function public.attend_party(p_event public.events, p_party_no int)
returns boolean language sql immutable set search_path = public as $$
  select case
    when p_event.sections is null then p_party_no between 1 and coalesce(p_event.main_count, p_event.party_count)
    else exists (
      select 1 from (
        select coalesce((e->>'attend')::boolean, true) att,
               sum((e->>'parties')::int) over (order by ord) - (e->>'parties')::int + 1 lo,
               sum((e->>'parties')::int) over (order by ord) hi
          from jsonb_array_elements(p_event.sections) with ordinality t(e, ord)
      ) r where r.att and p_party_no between r.lo and r.hi)
  end;
$$;

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

  insert into public.event_parties (event_id, party_no, name)
  select v_id, party_no, name from public.event_parties where event_id = b.id;

  insert into public.event_signups (event_id, member_id, party_no, slot_no, note, created_by)
  select v_id, member_id, party_no, slot_no, note, created_by from public.event_signups where event_id = b.id;

  insert into public.attendance (event_id, member_id, status, source)
  select v_id, member_id, 'present', 'manual' from public.event_signups
   where event_id = b.id and party_no is not null and slot_no <= b.party_size
     and public.attend_party(b, party_no);

  return v_id;
end $$;

-- Tambah party: masuk ke bagian terakhir
create or replace function public.add_party(p_event_id bigint)
returns int language plpgsql security definer set search_path = public as $$
declare ev public.events; v int; last int;
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
  if ev.sections is not null and jsonb_array_length(ev.sections) > 0 then
    last := jsonb_array_length(ev.sections) - 1;
    update public.events
       set party_count = party_count + 1,
           sections = jsonb_set(sections, array[last::text, 'parties'],
                                to_jsonb(((sections -> last ->> 'parties')::int) + 1))
     where id = p_event_id returning party_count into v;
  else
    update public.events set party_count = party_count + 1 where id = p_event_id returning party_count into v;
  end if;
  return v;
end $$;

revoke execute on function public.attend_party(public.events, int) from public, anon;
grant execute on function public.attend_party(public.events, int) to authenticated;

-- Guild League: Main 12 (hadir) + Sub 18
update public.events
   set sections = jsonb_build_array(
         jsonb_build_object('name','Main','prefix','Party','parties', least(coalesce(main_count,12), party_count),'attend',true),
         jsonb_build_object('name','Sub','prefix','Sub','parties', party_count - least(coalesce(main_count,12), party_count),'attend',false))
 where is_permanent and mode = 'guild_league' and sections is null;

-- Polarity Zone: STAR 10 party + Normal Dungeon 1-4 masing-masing 10 party (semua tercatat hadir)
update public.events
   set party_count = 50, main_count = 10,
       sections = '[{"name":"STAR","prefix":"STAR","parties":10,"attend":true},
                    {"name":"Normal Dungeon 1","prefix":"ND1-","parties":10,"attend":true},
                    {"name":"Normal Dungeon 2","prefix":"ND2-","parties":10,"attend":true},
                    {"name":"Normal Dungeon 3","prefix":"ND3-","parties":10,"attend":true},
                    {"name":"Normal Dungeon 4","prefix":"ND4-","parties":10,"attend":true}]'::jsonb
 where is_permanent and mode = 'polarity_zone' and sections is null;
