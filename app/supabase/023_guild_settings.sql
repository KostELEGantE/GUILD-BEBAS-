-- Pengaturan guild: siapa yang boleh membuka papan Guild League
--   import = hanya akun dengan karakter yang ada di import member terakhir
--   char   = akun yang punya karakter aktif (perilaku lama)
--   all    = semua akun yang login
create table if not exists public.guild_settings (
  id int primary key default 1 check (id = 1),
  gl_access text not null default 'char' check (gl_access in ('import', 'char', 'all')),
  updated_at timestamptz not null default now()
);
insert into public.guild_settings (id) values (1) on conflict do nothing;
alter table public.guild_settings enable row level security;
drop policy if exists guild_settings_read on public.guild_settings;
create policy guild_settings_read on public.guild_settings for select to authenticated using (true);

create or replace function public.set_gl_access(p text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Hanya moderator'; end if;
  if p not in ('import', 'char', 'all') then raise exception 'Pilihan tidak dikenal'; end if;
  update public.guild_settings set gl_access = p, updated_at = now() where id = 1;
end $$;
revoke execute on function public.set_gl_access(text) from public, anon;
grant execute on function public.set_gl_access(text) to authenticated;
notify pgrst, 'reload schema';
