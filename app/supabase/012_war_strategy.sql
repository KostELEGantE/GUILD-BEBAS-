-- =====================================================================
-- 012: Strategi perang Guild League (penempatan di peta Main & Sub)
-- items: [{id, kind: 'party'|'member'|'note', ref, x, y, text}] — x,y dalam persen peta.
-- Semua member bisa melihat; moderator & leader party di papan itu bisa mengubah.
-- =====================================================================
create table if not exists public.war_strategy (
  event_id   bigint not null references public.events(id) on delete cascade,
  map        text   not null check (map in ('main', 'sub')),
  items      jsonb  not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null,
  primary key (event_id, map)
);
alter table public.war_strategy enable row level security;
alter table public.war_strategy replica identity full;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='war_strategy' and policyname='read_strategy') then
    create policy "read_strategy" on public.war_strategy for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='war_strategy' and policyname='not_banned') then
    create policy "not_banned" on public.war_strategy as restrictive for all to authenticated
      using (not public.is_banned()) with check (not public.is_banned());
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='war_strategy') then
    alter publication supabase_realtime add table public.war_strategy;
  end if;
end $$;

create or replace function public.save_strategy(p_event_id bigint, p_map text, p_items jsonb)
returns timestamptz language plpgsql security definer set search_path = public as $$
declare v_now timestamptz := now();
begin
  if not (public.event_admin(p_event_id) or exists (
      select 1 from public.event_parties ep join public.members m on m.id = ep.leader_member_id
       where ep.event_id = p_event_id and m.user_id = auth.uid())) then
    raise exception 'Hanya moderator atau leader party yang bisa mengatur strategi';
  end if;
  if p_map not in ('main', 'sub') then raise exception 'Peta tidak valid'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 300 then raise exception 'Data strategi tidak valid'; end if;
  insert into public.war_strategy (event_id, map, items, updated_at, updated_by)
  values (p_event_id, p_map, p_items, v_now, auth.uid())
  on conflict (event_id, map) do update set items = excluded.items, updated_at = v_now, updated_by = auth.uid();
  return v_now;
end $$;
revoke execute on function public.save_strategy(bigint, text, jsonb) from public, anon;
grant execute on function public.save_strategy(bigint, text, jsonb) to authenticated;
notify pgrst, 'reload schema';
