-- =====================================================================
-- 004: Ganti nama karakter tanpa kehilangan data (klaim, party fix, slot, kehadiran)
-- =====================================================================

-- Ganti nama manual (admin, atau pemilik karakter)
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
  update public.members set name = v_name, updated_at = now() where id = p_member_id;
end $$;

-- Import member + daftar ganti nama yang sudah dikonfirmasi admin.
-- p_renames = [{"id": 12, "name": "NamaBaru"}, ...] diterapkan SEBELUM data dicocokkan,
-- sehingga baris "NamaBaru" di file akan memperbarui karakter lama (id 12).
create or replace function public.import_members(p_rows jsonb, p_filename text,
                                                 p_deactivate_missing boolean default false,
                                                 p_renames jsonb default '[]'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_import bigint;
  v_new int; v_upd int; v_off int := 0; v_ren int := 0;
  r jsonb;
begin
  if not public.is_admin() then raise exception 'Hanya admin'; end if;

  for r in select * from jsonb_array_elements(coalesce(p_renames, '[]'::jsonb)) loop
    if exists (select 1 from public.members
                where name_key = lower(btrim(r->>'name')) and id <> (r->>'id')::bigint) then
      raise exception 'Tidak bisa ganti nama ke "%": nama itu sudah ada di roster', r->>'name';
    end if;
    update public.members set name = btrim(r->>'name'), updated_at = now() where id = (r->>'id')::bigint;
    v_ren := v_ren + 1;
  end loop;

  drop table if exists _in;
  create temp table _in on commit drop as
  select distinct on (lower(btrim(x->>'name')))
         btrim(x->>'name')                        as name,
         lower(btrim(x->>'name'))                 as name_key,
         nullif(x->>'level','')::int              as level,
         nullif(btrim(x->>'class'),'')            as class,
         nullif(btrim(x->>'title'),'')            as title,
         nullif(btrim(x->>'gender'),'')           as gender,
         nullif(btrim(x->>'position'),'')         as position,
         nullif(x->>'gear_score','')::int         as gear_score,
         nullif(x->>'weekly','')::int             as weekly,
         nullif(x->>'weekly_contribution','')::int as weekly_contribution,
         nullif(x->>'total_contribution','')::int as total_contribution,
         nullif(btrim(x->>'online_status'),'')    as online_status
    from jsonb_array_elements(p_rows) x
   where coalesce(btrim(x->>'name'),'') <> '';

  insert into public.imports(kind, filename, row_count, created_by)
  values ('members', p_filename, (select count(*) from _in), auth.uid())
  returning id into v_import;

  select count(*) into v_new from _in i
   where not exists (select 1 from public.members m where m.name_key = i.name_key);
  select count(*) into v_upd from _in i
   where exists (select 1 from public.members m where m.name_key = i.name_key);

  insert into public.members as m
    (name, level, class, title, gender, position, gear_score, weekly,
     weekly_contribution, total_contribution, online_status, role, active, last_import_at, updated_at)
  select name, level, class, title, gender, position, gear_score, weekly,
         weekly_contribution, total_contribution, online_status,
         public.default_role(class), true, now(), now()
    from _in
  on conflict (name_key) do update set
    name = excluded.name,
    level = excluded.level,
    class = excluded.class,
    title = excluded.title,
    gender = excluded.gender,
    position = excluded.position,
    gear_score = excluded.gear_score,
    weekly = excluded.weekly,
    weekly_contribution = excluded.weekly_contribution,
    total_contribution = excluded.total_contribution,
    online_status = excluded.online_status,
    role = case when m.class is distinct from excluded.class
                then public.default_role(excluded.class) else m.role end,
    active = true,
    last_import_at = now(),
    updated_at = now();

  insert into public.member_snapshots
    (import_id, member_id, level, gear_score, weekly, weekly_contribution, total_contribution)
  select v_import, m.id, i.level, i.gear_score, i.weekly, i.weekly_contribution, i.total_contribution
    from _in i join public.members m on m.name_key = i.name_key;

  if p_deactivate_missing then
    update public.members m set active = false, updated_at = now()
     where m.active and not exists (select 1 from _in i where i.name_key = m.name_key);
    get diagnostics v_off = row_count;
  end if;

  return jsonb_build_object('import_id', v_import, 'new', v_new, 'updated', v_upd,
                            'deactivated', v_off, 'renamed', v_ren);
end $$;

drop function if exists public.import_members(jsonb, text, boolean);

revoke execute on function public.rename_member(bigint, text),
  public.import_members(jsonb, text, boolean, jsonb) from public, anon;
grant execute on function public.rename_member(bigint, text),
  public.import_members(jsonb, text, boolean, jsonb) to authenticated;
