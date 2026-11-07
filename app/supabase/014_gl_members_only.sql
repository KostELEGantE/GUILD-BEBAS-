-- =====================================================================
-- 014: Data Guild League hanya untuk akun yang sudah mengklaim karakter
-- (moderator selalu boleh). Event lain tidak terpengaruh.
-- =====================================================================
create or replace function public.can_see_event(p_event_id bigint)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin()
      or exists (select 1 from public.members where user_id = auth.uid() and active)
      or not exists (select 1 from public.events where id = p_event_id and mode = 'guild_league');
$$;
revoke execute on function public.can_see_event(bigint) from public, anon;
grant execute on function public.can_see_event(bigint) to authenticated;

do $$
declare t text;
begin
  foreach t in array array['event_signups','event_parties','war_strategy','attendance'] loop
    if not exists (select 1 from pg_policies where schemaname='public' and tablename=t and policyname='gl_members_only') then
      execute format('create policy "gl_members_only" on public.%I as restrictive for select to authenticated
                        using (public.can_see_event(event_id))', t);
    end if;
  end loop;
end $$;
