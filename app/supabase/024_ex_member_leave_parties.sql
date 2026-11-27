-- Member yang jadi "Bukan member" (active: true -> false) otomatis dikeluarkan dari party
-- di semua event yang belum selesai (termasuk papan tetap Guild League). Party fix (grup) tidak diubah.
create or replace function public._ex_member_leave_parties()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.active and not new.active then
    delete from public.event_signups s
     where s.member_id = new.id
       and exists (select 1 from public.events e where e.id = s.event_id and e.status <> 'done');
    update public.event_parties p set leader_member_id = null
     where p.leader_member_id = new.id
       and exists (select 1 from public.events e where e.id = p.event_id and e.status <> 'done');
  end if;
  return new;
end $$;
drop trigger if exists ex_member_leave_parties on public.members;
create trigger ex_member_leave_parties after update of active on public.members
  for each row execute function public._ex_member_leave_parties();

-- bersihkan yang sudah terlanjur ada
delete from public.event_signups s
 using public.members m, public.events e
 where m.id = s.member_id and e.id = s.event_id and not m.active and e.status <> 'done';
update public.event_parties p set leader_member_id = null
  from public.members m, public.events e
 where m.id = p.leader_member_id and e.id = p.event_id and not m.active and e.status <> 'done';
