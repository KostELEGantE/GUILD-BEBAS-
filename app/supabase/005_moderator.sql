-- =====================================================================
-- 005: Super Moderator & Sub Moderator
-- is_admin = moderator (Super maupun Sub), is_super = Super Moderator
-- Super: bisa mengatur semua peran.
-- Sub  : bisa mengelola guild dan mengangkat/mencabut sesama Sub Moderator,
--        tapi tidak bisa mengubah Super Moderator atau mengangkat Super.
-- =====================================================================
alter table public.profiles add column if not exists is_super boolean not null default false;

create or replace function public.is_super()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select is_super from public.profiles where id = auth.uid()), false);
$$;

create or replace function public.guard_profile_roles()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;

  if new.is_super is distinct from old.is_super and not public.is_super() then
    raise exception 'Hanya Super Moderator yang bisa mengubah status Super Moderator';
  end if;
  if old.is_super and new.is_admin is distinct from old.is_admin and not public.is_super() then
    raise exception 'Sub Moderator tidak bisa mengubah Super Moderator';
  end if;
  if new.is_admin is distinct from old.is_admin and not public.is_admin() then
    raise exception 'Hanya moderator yang bisa mengubah peran';
  end if;
  if old.id = auth.uid() and old.is_super and not new.is_super
     and not exists (select 1 from public.profiles where is_super and id <> old.id) then
    raise exception 'Harus ada minimal satu Super Moderator';
  end if;
  -- Super Moderator selalu juga moderator
  if new.is_super then new.is_admin := true; end if;
  return new;
end $$;

drop trigger if exists guard_profile_roles on public.profiles;
create trigger guard_profile_roles before update on public.profiles
  for each row execute function public.guard_profile_roles();

create or replace function public.claim_first_admin()
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return false; end if;
  if exists (select 1 from public.profiles where is_admin) then return false; end if;
  update public.profiles set is_admin = true, is_super = true where id = auth.uid();
  return found;
end $$;

revoke execute on function public.is_super() from public, anon;
grant execute on function public.is_super() to authenticated;
revoke execute on function public.guard_profile_roles() from public, anon, authenticated;
