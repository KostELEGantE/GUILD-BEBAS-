-- =====================================================================
-- 020: Peran "Moderator Monitoring": moderator yang hanya mengelola.
-- Tidak punya karakter, tidak bisa mendaftar/klaim karakter, jadi tidak bisa masuk party/roster.
-- =====================================================================
alter table public.profiles add column if not exists is_monitor boolean not null default false;

create or replace function public.guard_profile_roles()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    if new.is_monitor then new.is_admin := true; end if;
    return new;
  end if;

  if new.is_super is distinct from old.is_super and not public.is_super() then
    raise exception 'Hanya Super Moderator yang bisa mengubah status Super Moderator';
  end if;
  if old.is_super and new.is_admin is distinct from old.is_admin and not public.is_super() then
    raise exception 'Sub Moderator tidak bisa mengubah Super Moderator';
  end if;
  if new.is_admin is distinct from old.is_admin and not public.is_admin() then
    raise exception 'Hanya moderator yang bisa mengubah peran';
  end if;
  if new.is_monitor is distinct from old.is_monitor and not public.is_admin() then
    raise exception 'Hanya moderator yang bisa mengubah peran';
  end if;
  if old.is_super and new.is_monitor is distinct from old.is_monitor and not public.is_super() then
    raise exception 'Sub Moderator tidak bisa mengubah Super Moderator';
  end if;
  if old.id = auth.uid() and old.is_super and not new.is_super
     and not exists (select 1 from public.profiles where is_super and id <> old.id) then
    raise exception 'Harus ada minimal satu Super Moderator';
  end if;
  -- Super Moderator dan Moderator Monitoring selalu juga moderator
  if new.is_super or new.is_monitor then new.is_admin := true; end if;
  -- Bukan moderator lagi = bukan monitoring lagi
  if not new.is_admin then new.is_monitor := false; end if;
  return new;
end $$;

-- Saat jadi Monitoring: lepas semua karakter & jabatan leader party miliknya
create or replace function public._monitor_release()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.is_monitor and not coalesce(old.is_monitor, false) then
    update public.event_parties ep set leader_member_id = null
      from public.members m where m.id = ep.leader_member_id and m.user_id = new.id;
    update public.members set user_id = null where user_id = new.id;
  end if;
  return new;
end $$;
drop trigger if exists monitor_release on public.profiles;
create trigger monitor_release after update of is_monitor on public.profiles
  for each row execute function public._monitor_release();
revoke execute on function public._monitor_release() from public, anon, authenticated;

create or replace function public.is_monitor()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select is_monitor from public.profiles where id = auth.uid()), false);
$$;
revoke execute on function public.is_monitor() from public, anon;
grant execute on function public.is_monitor() to authenticated;

-- Akun monitoring tidak boleh punya karakter: blok di tabel members (menutup semua jalur: daftar, klaim, ubah)
create or replace function public._block_monitor_owner()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.user_id is not null and new.user_id is distinct from old.user_id
     and exists (select 1 from public.profiles where id = new.user_id and is_monitor) then
    raise exception 'Akun Moderator Monitoring tidak bisa punya karakter';
  end if;
  return new;
end $$;
drop trigger if exists block_monitor_owner on public.members;
create trigger block_monitor_owner before insert or update of user_id on public.members
  for each row execute function public._block_monitor_owner();
revoke execute on function public._block_monitor_owner() from public, anon, authenticated;
notify pgrst, 'reload schema';
