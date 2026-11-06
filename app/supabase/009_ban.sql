-- =====================================================================
-- 009: Blokir (ban) akun
-- Moderator (Super/Sub) bisa memblokir dan membuka blokir akun.
-- Akun yang diblokir:
--   * tidak bisa login lagi (auth.users.banned_until) dan sesi aktifnya diputus,
--   * tidak bisa membaca/mengubah data apa pun (policy RESTRICTIVE + pre-request),
--   * kehilangan kepemimpinan party; klaim karakter boleh ikut dilepas.
-- Super Moderator tidak bisa diblokir, dan tidak ada yang bisa memblokir diri sendiri.
-- =====================================================================
alter table public.profiles add column if not exists banned_at  timestamptz;
alter table public.profiles add column if not exists banned_by  uuid references public.profiles(id) on delete set null;
alter table public.profiles add column if not exists ban_reason text;

create or replace function public.is_banned()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select banned_at is not null from public.profiles where id = auth.uid()), false);
$$;

-- akun yang diblokir otomatis kehilangan hak moderator (kembali jika dibuka)
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin and banned_at is null from public.profiles where id = auth.uid()), false);
$$;
create or replace function public.is_super()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select is_super and banned_at is null from public.profiles where id = auth.uid()), false);
$$;

-- kolom blokir hanya boleh diubah moderator, bukan untuk diri sendiri / Super Moderator
create or replace function public.guard_profile_roles()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;

  if (new.banned_at is distinct from old.banned_at
      or new.ban_reason is distinct from old.ban_reason
      or new.banned_by is distinct from old.banned_by) then
    if not public.is_admin() then raise exception 'Hanya moderator yang bisa memblokir akun'; end if;
    if old.id = auth.uid() then raise exception 'Tidak bisa memblokir akun sendiri'; end if;
    if old.is_super and new.banned_at is not null then raise exception 'Super Moderator tidak bisa diblokir'; end if;
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
  if old.id = auth.uid() and old.is_super and not new.is_super
     and not exists (select 1 from public.profiles where is_super and id <> old.id) then
    raise exception 'Harus ada minimal satu Super Moderator';
  end if;
  if new.is_super then new.is_admin := true; end if;
  return new;
end $$;

-- semua tabel: akun yang diblokir tidak bisa membaca/menulis (juga memutus realtime)
do $$
declare t text;
begin
  foreach t in array array['events','groups','group_members','event_signups','event_parties',
                           'members','imports','member_snapshots','attendance'] loop
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = 'not_banned') then
      execute format('create policy "not_banned" on public.%I as restrictive for all to authenticated
                        using (not public.is_banned()) with check (not public.is_banned())', t);
    end if;
  end loop;
  -- profil sendiri tetap bisa dibaca supaya aplikasi bisa menampilkan layar "diblokir"
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'profiles' and policyname = 'not_banned') then
    create policy "not_banned" on public.profiles as restrictive for all to authenticated
      using (id = auth.uid() or not public.is_banned()) with check (not public.is_banned());
  end if;
end $$;

-- semua request API (termasuk fungsi RPC) ditolak untuk akun diblokir,
-- kecuali membaca profil sendiri
create or replace function public.check_banned_request()
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.is_banned() then return; end if;
  if current_setting('request.method', true) = 'GET'
     and current_setting('request.path', true) in ('/profiles', '/rest/v1/profiles') then
    return;
  end if;
  raise exception 'Akun Anda diblokir oleh moderator' using errcode = '42501';
end $$;
grant execute on function public.check_banned_request() to anon, authenticated;
alter role authenticator set pgrst.db_pre_request = 'public.check_banned_request';
notify pgrst, 'reload config';

create or replace function public.ban_user(p_user_id uuid, p_reason text default null, p_release_claims boolean default false)
returns void language plpgsql security definer set search_path = public, auth as $$
declare target public.profiles;
begin
  if not public.is_admin() then raise exception 'Hanya moderator'; end if;
  select * into target from public.profiles where id = p_user_id;
  if not found then raise exception 'Akun tidak ditemukan'; end if;
  if p_user_id = auth.uid() then raise exception 'Tidak bisa memblokir akun sendiri'; end if;
  if target.is_super then raise exception 'Super Moderator tidak bisa diblokir'; end if;

  update public.profiles
     set banned_at = now(), banned_by = auth.uid(), ban_reason = nullif(trim(p_reason), '')
   where id = p_user_id;

  -- lepas kepemimpinan party oleh karakter miliknya
  update public.event_parties ep set leader_member_id = null
    from public.members m
   where m.id = ep.leader_member_id and m.user_id = p_user_id;

  if p_release_claims then
    update public.members set user_id = null where user_id = p_user_id;
  end if;

  -- tolak login & putus sesi yang sedang aktif
  update auth.users set banned_until = now() + interval '100 years' where id = p_user_id;
  delete from auth.sessions where user_id = p_user_id;
end $$;

create or replace function public.unban_user(p_user_id uuid)
returns void language plpgsql security definer set search_path = public, auth as $$
begin
  if not public.is_admin() then raise exception 'Hanya moderator'; end if;
  update public.profiles set banned_at = null, banned_by = null, ban_reason = null where id = p_user_id;
  if not found then raise exception 'Akun tidak ditemukan'; end if;
  update auth.users set banned_until = null where id = p_user_id;
end $$;

revoke execute on function public.ban_user(uuid, text, boolean) from public, anon;
revoke execute on function public.unban_user(uuid) from public, anon;
grant execute on function public.ban_user(uuid, text, boolean) to authenticated;
grant execute on function public.unban_user(uuid) to authenticated;
revoke execute on function public.is_banned() from public, anon;
grant execute on function public.is_banned() to authenticated;
