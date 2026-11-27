-- Import member: catat siapa yang ganti job (nama sama atau sesudah ganti nama) di riwayat import (changes.jobs)
do $$
declare d text;
begin
  d := pg_get_functiondef('public.import_members(jsonb,text,boolean,jsonb)'::regprocedure);
  if position('v_jobs' in d) = 0 then
    d := replace(d, 'v_new_names jsonb; v_left_names jsonb;', 'v_new_names jsonb; v_left_names jsonb; v_jobs jsonb;');
    d := replace(d, '  insert into public.imports(kind, filename, row_count, created_by, changes)',
      '  select coalesce(jsonb_agg(jsonb_build_object(''name'', i.name, ''from'', m.class, ''to'', i.class) order by i.name), ''[]''::jsonb) into v_jobs
    from _in i join public.members m on m.name_key = i.name_key
   where m.class is not null and i.class is not null and m.class is distinct from i.class;

  insert into public.imports(kind, filename, row_count, created_by, changes)');
    d := replace(d, '''renamed'', v_renamed)', '''renamed'', v_renamed, ''jobs'', v_jobs)');
    if position('''jobs'', v_jobs' in d) = 0 or position('into v_jobs' in d) = 0 then raise exception 'pola tidak ditemukan'; end if;
    execute d;
  end if;
end $$;
