create table if not exists public.site_banner_settings (
  banner_key text primary key,
  x numeric not null default 0,
  y numeric not null default 0,
  zoom numeric not null default 1,
  updated_at timestamptz not null default now()
);

insert into public.site_banner_settings (banner_key)
values
  ('jogos'),
  ('atividade'),
  ('conteudo')
on conflict (banner_key) do nothing;
