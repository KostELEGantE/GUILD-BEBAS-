-- =====================================================================
-- 018: Centang "sudah join party di game".
-- Bisa dicentang oleh pemain sendiri, leader party itu, atau moderator.
-- Centang hilang otomatis kalau pemain pindah ke party lain.
-- Moderator bisa mengosongkan semua centang (mis. sebelum war berikutnya).
-- =====================================================================
alter table public.event_signups add column if not exists joined_at timestamptz;
alter table public.event_signups add column if not exists joined_by uuid references public.profiles(id) on delete set null;

create or replace function public._reset_joined_on_move()
returns trigger language plpgsql as $$
begin
  if new.party_no is distinct from old.party_no then
    new.joined_at := null;
    new.joined_by := null;
  end if;
  return new;
end $$;
drop trigger if exists reset_joined_on_move on public.event_signups;
create trigger reset_joined_on_move before update of party_no on public.event_signups
  for each row execute function public._reset_joined_on_move();

create or replace function public.set_joined(p_event_id bigint, p_member_id bigint, p_joined boolean)
returns void language plpgsql security definer set search_path = public as $$
declare s public.event_signups;
begin
  select * into s from public.event_signups where event_id = p_event_id and member_id = p_member_id;
  if s.member_id is null or s.party_no is null then raise exception 'Pemain ini belum ada di party'; end if;
  if not (public.event_admin(p_event_id)
          or public.can_manage_party(p_event_id, s.party_no)
          or exists (select 1 from public.members where id = p_member_id and user_id = auth.uid())) then
    raise exception 'Hanya pemain itu sendiri, leader party, atau moderator';
  end if;
  update public.event_signups
     set joined_at = case when p_joined then now() end,
         joined_by = case when p_joined then auth.uid() end
   where event_id = p_event_id and member_id = p_member_id;
end $$;

create or replace function public.reset_joined(p_event_id bigint)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.event_admin(p_event_id) then raise exception 'Hanya moderator'; end if;
  update public.event_signups set joined_at = null, joined_by = null
   where event_id = p_event_id and joined_at is not null;
  get diagnostics n = row_count;
  return n;
end $$;

revoke execute on function public.set_joined(bigint, bigint, boolean), public.reset_joined(bigint) from public, anon;
grant execute on function public.set_joined(bigint, bigint, boolean), public.reset_joined(bigint) to authenticated;
notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------
-- Kosongkan seluruh papan (mis. setelah dungeon selesai) supaya semua bisa daftar ulang.
-- Nama party tetap. Leader party ikut dilepas kecuali p_keep_leaders.
-- ---------------------------------------------------------------------
create or replace function public.clear_board(p_event_id bigint, p_keep_leaders boolean default false)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.event_admin(p_event_id) then raise exception 'Hanya moderator / pembuat event'; end if;
  delete from public.event_signups where event_id = p_event_id;
  get diagnostics n = row_count;
  if not p_keep_leaders then
    update public.event_parties set leader_member_id = null where event_id = p_event_id and leader_member_id is not null;
  end if;
  return n;
end $$;
revoke execute on function public.clear_board(bigint, boolean) from public, anon;
grant execute on function public.clear_board(bigint, boolean) to authenticated;
notify pgrst, 'reload schema';
