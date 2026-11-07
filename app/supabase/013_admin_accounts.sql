-- =====================================================================
-- 013: Email & cara login setiap akun (hanya Super Moderator)
-- Untuk mengenali akun asing / email acak yang bukan anggota guild.
-- =====================================================================
create or replace function public.admin_accounts()
returns table (id uuid, email text, providers text, created_at timestamptz, last_sign_in_at timestamptz, email_confirmed boolean)
language plpgsql stable security definer set search_path = public, auth as $$
begin
  if not public.is_super() then raise exception 'Hanya Super Moderator'; end if;
  return query
    select u.id, u.email::text,
           coalesce((select string_agg(x, ',') from jsonb_array_elements_text(coalesce(u.raw_app_meta_data->'providers', jsonb_build_array(u.raw_app_meta_data->>'provider'))) x), ''),
           u.created_at, u.last_sign_in_at, u.email_confirmed_at is not null
      from auth.users u;
end $$;
revoke execute on function public.admin_accounts() from public, anon;
grant execute on function public.admin_accounts() to authenticated;
notify pgrst, 'reload schema';
