-- 007: realtime untuk nama party, data member (klaim/role/ganti nama), dan party fix
do $$
begin
  begin alter publication supabase_realtime add table public.event_parties; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.members;       exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.groups;        exception when duplicate_object then null; end;
end $$;
alter table public.event_signups replica identity full;
alter table public.event_parties replica identity full;
alter table public.group_members replica identity full;
