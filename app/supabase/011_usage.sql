-- =====================================================================
-- 011: Pemakaian kuota gratis Supabase (untuk panel Admin)
-- Ukuran database, file storage, jumlah akun & pengguna aktif bulan ini,
-- dan ukuran tiap tabel. Hanya Super Moderator yang bisa melihat.
-- (Egress & pesan realtime tidak bisa dibaca dari database; lihat dashboard Supabase.)
-- =====================================================================
create or replace function public.admin_usage()
returns jsonb language plpgsql stable security definer set search_path = public, auth, storage as $$
begin
  if not public.is_super() then raise exception 'Hanya Super Moderator'; end if;
  return jsonb_build_object(
    'db_bytes', pg_database_size(current_database()),
    'storage_bytes', (select coalesce(sum((metadata->>'size')::bigint), 0) from storage.objects),
    'users', (select count(*) from auth.users),
    'mau', (select count(*) from auth.users where last_sign_in_at >= date_trunc('month', now())),
    'active_7d', (select count(*) from auth.users where last_sign_in_at >= now() - interval '7 days'),
    'tables', (select coalesce(jsonb_agg(jsonb_build_object('name', relname, 'rows', n_live_tup,
                                                            'bytes', pg_total_relation_size(relid))
                                         order by pg_total_relation_size(relid) desc), '[]')
                 from pg_stat_user_tables where schemaname = 'public'),
    'checked_at', now()
  );
end $$;
revoke execute on function public.admin_usage() from public, anon;
grant execute on function public.admin_usage() to authenticated;
