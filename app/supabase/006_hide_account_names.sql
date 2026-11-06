-- 006: nama akun (Discord/Google) hanya terlihat oleh moderator & pemiliknya sendiri
drop policy if exists "read_profiles" on public.profiles;
create policy "read_profiles" on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_admin());

create or replace function public.participation_stats(p_days int default 30)
returns table (
  member_id bigint, name text, class text, role text, gear_score int,
  weekly_contribution int, active boolean, owner text,
  events_total int, signed_up int, present int, absent int, excused int,
  no_show int, attendance_rate numeric
) language sql stable security definer set search_path = public as $$
  with ev as (
    select id from public.events
     where status = 'done' and starts_at >= now() - make_interval(days => p_days)
  ), tot as (select count(*)::int n from ev)
  select m.id, m.name, m.class, m.role, m.gear_score, m.weekly_contribution, m.active,
         case when public.is_admin() then p.display_name end,
         tot.n,
         (select count(*) from public.event_signups s
           where s.member_id = m.id and s.event_id in (select id from ev))::int,
         (select count(*) from public.attendance a
           where a.member_id = m.id and a.event_id in (select id from ev) and a.status = 'present')::int,
         (select count(*) from public.attendance a
           where a.member_id = m.id and a.event_id in (select id from ev) and a.status = 'absent')::int,
         (select count(*) from public.attendance a
           where a.member_id = m.id and a.event_id in (select id from ev) and a.status = 'excused')::int,
         (select count(*) from public.attendance a
            join public.event_signups s on s.event_id = a.event_id and s.member_id = a.member_id
           where a.member_id = m.id and a.event_id in (select id from ev) and a.status = 'absent')::int,
         case when tot.n = 0 then null
              else round(100.0 * (select count(*) from public.attendance a
                                   where a.member_id = m.id and a.event_id in (select id from ev)
                                     and a.status = 'present') / tot.n, 1) end
    from public.members m
    cross join tot
    left join public.profiles p on p.id = m.user_id
   where auth.uid() is not null
   order by m.active desc, m.name;
$$;
