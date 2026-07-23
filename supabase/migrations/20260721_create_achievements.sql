-- Primeira etapa da migração de conquistas.
-- Não depende de Supabase Auth: o progresso atual pertence ao owner_key fixo
-- `default`. Escritas são feitas pelo endpoint /admin, protegido pelo Basic Auth
-- do Next.js e usando a service role exclusivamente no servidor.

create table if not exists public.achievements (
  id uuid primary key default gen_random_uuid(),
  game_slug text not null,
  legacy_id text not null,
  title text not null,
  description text not null default '',
  trophy text not null default '',
  rank text not null default 'Bronze',
  image text not null default '',
  sort_order integer not null default 0,
  is_custom boolean not null default false,
  is_hidden boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint achievements_game_slug_legacy_id_key unique (game_slug, legacy_id),
  constraint achievements_rank_check check (rank in ('Bronze', 'Prata', 'Ouro', 'Diamante'))
);

create index if not exists achievements_game_slug_sort_order_idx
  on public.achievements (game_slug, sort_order);

create table if not exists public.achievement_progress (
  id uuid primary key default gen_random_uuid(),
  achievement_id uuid not null references public.achievements(id) on delete cascade,
  owner_key text not null default 'default',
  status text not null default 'locked',
  earned_at date,
  rank_override text,
  image_override text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint achievement_progress_owner_achievement_key unique (owner_key, achievement_id),
  constraint achievement_progress_status_check check (status in ('locked', 'progress', 'completed')),
  constraint achievement_progress_rank_override_check check (
    rank_override is null or rank_override in ('Bronze', 'Prata', 'Ouro', 'Diamante')
  )
);

create index if not exists achievement_progress_owner_key_idx
  on public.achievement_progress (owner_key);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists achievements_set_updated_at on public.achievements;
create trigger achievements_set_updated_at
before update on public.achievements
for each row execute function public.set_updated_at();

drop trigger if exists achievement_progress_set_updated_at on public.achievement_progress;
create trigger achievement_progress_set_updated_at
before update on public.achievement_progress
for each row execute function public.set_updated_at();

alter table public.achievements enable row level security;
alter table public.achievement_progress enable row level security;

-- O site atual exibe uma única jornada publicamente. O cliente anônimo só lê;
-- inserts/updates/deletes ficam bloqueados por RLS e passam pelo endpoint admin.
drop policy if exists "public read achievements" on public.achievements;
create policy "public read achievements"
on public.achievements for select
to anon, authenticated
using (true);

drop policy if exists "public read achievement progress" on public.achievement_progress;
create policy "public read achievement progress"
on public.achievement_progress for select
to anon, authenticated
using (owner_key = 'default');
