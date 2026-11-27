-- Ganti nama lewat import member: nama lama disimpan di prev_names (sama seperti ganti nama dari Akun saya)
do $$
declare d text;
begin
  d := pg_get_functiondef('public.import_members(jsonb,text,boolean,jsonb)'::regprocedure);
  if position('prev_names = case' in d) = 0 then
    d := replace(d,
      'update public.members set name = btrim(r->>''name''), updated_at = now() where id = (r->>''id'')::bigint;',
      'update public.members set prev_names = case when name is distinct from btrim(r->>''name'') then coalesce(prev_names, ''{}'') || name else prev_names end, name = btrim(r->>''name''), updated_at = now() where id = (r->>''id'')::bigint;');
    if position('prev_names = case' in d) = 0 then raise exception 'pola update rename tidak ditemukan'; end if;
    execute d;
  end if;
end $$;
