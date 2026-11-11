-- =====================================================================
-- 016 (nickname wajib; class/level/CP boleh kosong): Karakter didaftarkan sendiri oleh tiap akun (halaman Roster dihapus).
-- - declare_member: daftar karakter lewat form. Kalau IGN sama dengan nama di daftar guild
--   (hasil import) dan belum dimiliki akun lain, karakter itu otomatis jadi milik akun ini.
-- - update_my_member: ubah data / ganti nama sendiri; nama lama disimpan di prev_names.
-- Klaim lama tetap berlaku.
-- =====================================================================
alter table public.members add column if not exists prev_names text[] not null default '{}';
alter table public.members add column if not exists declared_at timestamptz;

create or replace function public._check_member_input(p_name text, p_class text, p_level int, p_gear_score int, p_role text)
returns void language plpgsql immutable as $$
begin
  if coalesce(btrim(p_name), '') = '' then raise exception 'IGN tidak boleh kosong'; end if;
  if length(btrim(p_name)) > 32 then raise exception 'IGN terlalu panjang (maks. 32 huruf)'; end if;
  if p_level is not null and (p_level < 1 or p_level > 200) then raise exception 'Level tidak valid'; end if;
  if p_gear_score is not null and (p_gear_score < 0 or p_gear_score > 999999) then raise exception 'Gear Score tidak valid'; end if;
  if p_role is not null and p_role not in ('Tank','Healer','Support','DPS') then raise exception 'Role tidak valid'; end if;
end $$;

create or replace function public.declare_member(p_name text, p_class text, p_level int default null,
                                                 p_gear_score int default null, p_role text default null)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_name text := btrim(p_name); m public.members; v_id bigint;
begin
  if auth.uid() is null then raise exception 'Harus login'; end if;
  if public.is_banned() then raise exception 'Akun diblokir'; end if;
  perform public._check_member_input(p_name, p_class, p_level, p_gear_score, p_role);
  if (select count(*) from public.members where user_id = auth.uid()) >= 5 then
    raise exception 'Maksimal 5 karakter per akun';
  end if;

  select * into m from public.members where name_key = lower(v_name);
  if found then
    if m.user_id is not null and m.user_id <> auth.uid() then
      raise exception 'IGN "%" sudah didaftarkan akun lain. Hubungi moderator kalau ini karakter Anda.', m.name;
    end if;
    update public.members set
      user_id = auth.uid(), claimed_at = coalesce(claimed_at, now()), declared_at = now(),
      name = v_name, class = coalesce(nullif(btrim(p_class), ''), class),
      level = coalesce(p_level, level), gear_score = coalesce(p_gear_score, gear_score),
      role = coalesce(p_role, case when nullif(btrim(p_class), '') is not null and class is distinct from btrim(p_class)
                                   then public.default_role(btrim(p_class)) else role end),
      active = true, updated_at = now()
     where id = m.id;
    return m.id;
  end if;

  insert into public.members (name, class, level, gear_score, role, active, user_id, claimed_at, declared_at, updated_at)
  values (v_name, nullif(btrim(p_class), ''), p_level, p_gear_score, coalesce(p_role, public.default_role(nullif(btrim(p_class), ''))),
          true, auth.uid(), now(), now(), now())
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.update_my_member(p_member_id bigint, p_name text, p_class text, p_level int default null,
                                                   p_gear_score int default null, p_role text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_name text := btrim(p_name); m public.members; v_other text;
begin
  select * into m from public.members where id = p_member_id;
  if not found then raise exception 'Karakter tidak ditemukan'; end if;
  if not (m.user_id = auth.uid() or public.is_admin()) then raise exception 'Hanya pemilik karakter atau moderator'; end if;
  perform public._check_member_input(p_name, p_class, p_level, p_gear_score, p_role);
  select name into v_other from public.members where name_key = lower(v_name) and id <> p_member_id;
  if v_other is not null then
    raise exception 'IGN "%" sudah ada di daftar guild. Hapus karakter ini lalu daftarkan "%" sebagai karakter baru.', v_other, v_other;
  end if;
  update public.members set
    prev_names = case when name <> v_name then array_append(prev_names, name) else prev_names end,
    name = v_name, class = coalesce(nullif(btrim(p_class), ''), class),
    level = coalesce(p_level, level), gear_score = coalesce(p_gear_score, gear_score),
    role = coalesce(p_role, role), updated_at = now()
   where id = p_member_id;
end $$;

revoke execute on function public._check_member_input(text, text, int, int, text) from public, anon;
revoke execute on function public.declare_member(text, text, int, int, text),
  public.update_my_member(bigint, text, text, int, int, text) from public, anon;
grant execute on function public.declare_member(text, text, int, int, text),
  public.update_my_member(bigint, text, text, int, int, text) to authenticated;

-- claim_member (Roster v1.0) dibiarkan aktif supaya versi 1.0 masih bisa dipakai kalau perlu kembali.

notify pgrst, 'reload schema';

-- ganti nama oleh moderator juga mencatat nama lama
create or replace function public.rename_member(p_member_id bigint, p_name text)
returns void language plpgsql security definer set search_path = public as $$
declare v_name text := btrim(p_name); v_other text;
begin
  if coalesce(v_name, '') = '' then raise exception 'Nama tidak boleh kosong'; end if;
  if not (public.is_admin() or exists (select 1 from public.members where id = p_member_id and user_id = auth.uid())) then
    raise exception 'Hanya admin atau pemilik karakter yang bisa mengganti nama';
  end if;
  select name into v_other from public.members where name_key = lower(v_name) and id <> p_member_id;
  if v_other is not null then raise exception 'Nama "%" sudah dipakai karakter lain', v_other; end if;
  update public.members
     set prev_names = case when name <> v_name then array_append(prev_names, name) else prev_names end,
         name = v_name, updated_at = now()
   where id = p_member_id;
end $$;
notify pgrst, 'reload schema';
