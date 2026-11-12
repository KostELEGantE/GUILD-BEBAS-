-- =====================================================================
-- 017: Tukar posisi dua pemain (seret / klik pemain ke pemain lain).
-- Boleh untuk moderator, atau yang bisa mengatur kedua party (leader / anggota party tanpa leader).
-- Pemain di daftar tunggu (party kosong) juga bisa ditukar dengan pemain di party.
-- =====================================================================
create or replace function public.swap_slots(p_event_id bigint, p_a bigint, p_b bigint)
returns void language plpgsql security definer set search_path = public as $$
declare ev public.events; a public.event_signups; b public.event_signups;
begin
  select * into ev from public.events where id = p_event_id;
  if not found then raise exception 'Event tidak ditemukan'; end if;
  select * into a from public.event_signups where event_id = p_event_id and member_id = p_a;
  select * into b from public.event_signups where event_id = p_event_id and member_id = p_b;
  if a.member_id is null or b.member_id is null then raise exception 'Kedua pemain harus sudah terdaftar di event ini'; end if;
  if a.party_no is null and b.party_no is null then return; end if;

  if not public.event_admin(p_event_id) then
    if ev.status <> 'open' then raise exception 'Party sudah dikunci oleh admin'; end if;
    if (a.party_no is not null and not public.can_manage_party(p_event_id, a.party_no))
       or (b.party_no is not null and not public.can_manage_party(p_event_id, b.party_no)) then
      raise exception 'Anda hanya bisa menukar pemain di party yang Anda kelola';
    end if;
  end if;

  update public.event_signups set party_no = null, slot_no = null where event_id = p_event_id and member_id in (p_a, p_b);
  update public.event_signups set party_no = b.party_no, slot_no = b.slot_no where event_id = p_event_id and member_id = p_a;
  update public.event_signups set party_no = a.party_no, slot_no = a.slot_no where event_id = p_event_id and member_id = p_b;
end $$;
revoke execute on function public.swap_slots(bigint, bigint, bigint) from public, anon;
grant execute on function public.swap_slots(bigint, bigint, bigint) to authenticated;
notify pgrst, 'reload schema';
