-- Réplica local (executada como o papel postgres NÃO superusuário) das tabelas, gatilhos e
-- funções lidos no projeto real em 15/11/2026. Só o necessário para a migração do ciclo de vida.
create table public.achievements (
  id uuid primary key default gen_random_uuid(), game_slug text not null, legacy_id text not null, title text not null,
  description text not null default '', trophy text not null default '', rank text not null default 'Bronze',
  image text not null default '', sort_order integer not null default 0, is_custom boolean not null default false,
  is_hidden boolean not null default false, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  source text, external_id text, official_image text
);
create table public.achievement_progress (
  id uuid primary key default gen_random_uuid(), achievement_id uuid not null references public.achievements(id) on delete cascade,
  owner_key text not null default 'default', status text not null default 'locked', earned_at date, rank_override text,
  image_override text, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.games (
  id uuid primary key default gen_random_uuid(), slug text not null unique, title text not null, subtitle text not null default '',
  status text not null default 'progress', progress integer not null default 0, hours text not null default '0h',
  current_objective text not null default '', image text not null default '', card_image text not null default '',
  final_badge jsonb, emblem jsonb, trophies jsonb, is_hidden boolean not null default false, is_deleted boolean not null default false,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), review jsonb,
  started_at timestamptz, completed_at timestamptz, review_created_at timestamptz, review_updated_at timestamptz,
  manual_total_played_minutes integer, genres text[], platform text
);
create table public.journey_history_events (
  id uuid primary key default gen_random_uuid(), owner_key text not null, event_type text not null, event_date date not null,
  event_at timestamptz, game_slug text, achievement_id uuid, source_table text not null, source_id text not null,
  played_minutes integer not null default 0, metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now()
);
create unique index journey_history_events_source_unique on public.journey_history_events (owner_key, source_table, source_id, event_type);
-- journey_entries com as colunas reais (pré-verificação de 15/11/2026, consulta 6).
create table public.journey_entries (
  id uuid primary key default gen_random_uuid(), "gameTitle" text not null, "gameSlug" text, "dayLabel" text, status text,
  "weekDay" text, date date, title text, notes text, highlight text, "threadsUrl" text, tags jsonb,
  "createdAt" timestamptz default now(), "updatedAt" timestamptz default now(), "playedMinutes" integer default 0
);

alter table public.achievements enable row level security;
alter table public.achievement_progress enable row level security;
alter table public.games enable row level security;
alter table public.journey_history_events enable row level security;
alter table public.journey_entries enable row level security;
create policy "public read achievements" on public.achievements for select to anon, authenticated using (true);
create policy "public read achievement progress" on public.achievement_progress for select to anon, authenticated using (true);
create policy games_public_read on public.games for select to anon, authenticated using (true);

create function public.set_updated_at() returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end; $$;

create function public.is_meaningful_review(p_review jsonb) returns boolean language sql immutable as $$
  select p_review is not null and p_review <> 'null'::jsonb and (
    coalesce(trim(p_review->>'nota'), '') <> '' or coalesce(trim(p_review->>'resumo'), '') <> '' or coalesce(trim(p_review->>'texto'), '') <> ''
    or coalesce(trim(p_review->>'review'), '') <> '' or coalesce(trim(p_review->>'analysis'), '') <> '' or coalesce(trim(p_review->>'text'), '') <> ''
    or coalesce(trim(p_review->>'summary'), '') <> '' or coalesce(trim(p_review->>'label'), '') <> ''
    or jsonb_typeof(p_review->'positivos') = 'array' or jsonb_typeof(p_review->'pontosPositivos') = 'array'
    or jsonb_typeof(p_review->'negativos') = 'array' or jsonb_typeof(p_review->'pontosNegativos') = 'array');
$$;

create function public.upsert_journey_history_event(p_owner_key text, p_event_type text, p_event_date date, p_event_at timestamptz,
  p_game_slug text, p_achievement_id uuid, p_source_table text, p_source_id text, p_played_minutes integer, p_metadata jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.journey_history_events (owner_key, event_type, event_date, event_at, game_slug, achievement_id, source_table, source_id, played_minutes, metadata)
  values (coalesce(nullif(trim(p_owner_key), ''), 'default'), p_event_type, p_event_date, p_event_at, nullif(trim(coalesce(p_game_slug, '')), ''),
          p_achievement_id, p_source_table, p_source_id, greatest(coalesce(p_played_minutes, 0), 0), coalesce(p_metadata, '{}'::jsonb))
  on conflict (owner_key, source_table, source_id, event_type) do update set event_date = excluded.event_date, event_at = excluded.event_at,
    game_slug = excluded.game_slug, achievement_id = excluded.achievement_id, played_minutes = excluded.played_minutes, metadata = excluded.metadata;
end; $$;

create function public.trg_achievement_progress_prepare() returns trigger language plpgsql security definer set search_path = public as $$
begin if new.status = 'completed' and new.earned_at is null then new.earned_at := now(); end if; return new; end; $$;

create function public.trg_achievement_progress_history() returns trigger language plpgsql security definer set search_path = public as $$
declare v_game_slug text; v_should_log boolean := false;
begin
  select a.game_slug into v_game_slug from public.achievements a where a.id = new.achievement_id;
  if new.status = 'completed' and new.earned_at is not null then
    if tg_op = 'INSERT' then v_should_log := true;
    elsif old.status is distinct from new.status or old.earned_at is distinct from new.earned_at then v_should_log := true; end if;
  end if;
  if v_should_log then
    perform public.upsert_journey_history_event(coalesce(nullif(trim(new.owner_key), ''), 'default'), 'achievement_unlocked', new.earned_at::date, new.earned_at,
      v_game_slug, new.achievement_id, 'achievement_progress', new.achievement_id::text, 0, jsonb_build_object('status', new.status, 'ownerKey', new.owner_key));
  end if;
  return new;
end; $$;

create function public.trg_games_history_prepare() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'completed' then
    if tg_op = 'INSERT' then if new.completed_at is null then new.completed_at := now(); end if;
    elsif old.status is distinct from new.status and new.completed_at is null then new.completed_at := now(); end if;
  end if;
  if public.is_meaningful_review(new.review) then
    if tg_op = 'INSERT' then
      if new.review_created_at is null then new.review_created_at := now(); end if;
      new.review_updated_at := coalesce(new.review_updated_at, now());
    elsif old.review is distinct from new.review then
      if not public.is_meaningful_review(old.review) and new.review_created_at is null then new.review_created_at := now(); end if;
      new.review_updated_at := now();
    end if;
  end if;
  return new;
end; $$;

create function public.trg_games_history() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public.upsert_journey_history_event('default', 'game_registered', coalesce(new.created_at, now())::date, coalesce(new.created_at, now()), new.slug, null, 'games', new.id::text, 0, jsonb_build_object('title', new.title));
  end if;
  if new.review_created_at is not null and public.is_meaningful_review(new.review) then
    if tg_op = 'INSERT' or old.review_created_at is distinct from new.review_created_at then
      perform public.upsert_journey_history_event('default', 'review_created', new.review_created_at::date, new.review_created_at, new.slug, null, 'games', new.id::text, 0, jsonb_build_object('title', new.title));
    end if;
  end if;
  if tg_op = 'UPDATE' and public.is_meaningful_review(new.review) and public.is_meaningful_review(old.review) and old.review is distinct from new.review and new.review_updated_at is not null then
    perform public.upsert_journey_history_event('default', 'review_updated', new.review_updated_at::date, new.review_updated_at, new.slug, null, 'games', new.id::text || ':' || new.review_updated_at::text, 0, jsonb_build_object('title', new.title));
  end if;
  return new;
end; $$;

create function public.log_manual_game_total_time() returns trigger language plpgsql as $$
begin
  if new.manual_total_played_minutes is distinct from old.manual_total_played_minutes and new.manual_total_played_minutes is not null and new.manual_total_played_minutes > 0 then
    insert into public.journey_history_events (owner_key, event_type, event_date, event_at, game_slug, source_table, source_id, played_minutes, metadata)
    values ('default', 'game_total_played_time_set', current_date, now(), new.slug, 'games', new.id::text, new.manual_total_played_minutes, jsonb_build_object('manual', true, 'status', new.status));
  end if;
  return new;
end; $$;

-- Definição real lida em 15/11/2026 (pg_get_functiondef), reproduzida sem alteração.
create function public.trg_journey_entries_history() returns trigger language plpgsql security definer set search_path to 'public' as $function$
declare
  v_game_date date;
  v_event_at timestamptz;
begin
  v_game_date := new.date::date;
  v_event_at := coalesce(
    nullif(new."updatedAt"::text, '')::timestamptz,
    v_game_date::timestamptz
  );

  -- Primeira sessão conhecida do jogo = data de início.
  update public.games
  set started_at = coalesce(started_at, v_game_date::timestamptz)
  where slug = new."gameSlug"
    and started_at is null;

  perform public.upsert_journey_history_event(
    'default',
    'play_session',
    v_game_date,
    v_event_at,
    new."gameSlug",
    null,
    'journey_entries',
    new.id::text,
    coalesce(new."playedMinutes", 0),
    jsonb_build_object(
      'gameTitle', new."gameTitle",
      'dayLabel', new."dayLabel",
      'status', new.status
    )
  );

  return new;
end;
$function$;

create trigger achievements_set_updated_at before update on public.achievements for each row execute function public.set_updated_at();
create trigger achievement_progress_set_updated_at before update on public.achievement_progress for each row execute function public.set_updated_at();
create trigger achievement_progress_prepare_trigger before insert or update on public.achievement_progress for each row execute function public.trg_achievement_progress_prepare();
create trigger achievement_progress_history_trigger after insert or update on public.achievement_progress for each row execute function public.trg_achievement_progress_history();
create trigger games_history_prepare_trigger before insert or update on public.games for each row execute function public.trg_games_history_prepare();
create trigger games_history_trigger after insert or update on public.games for each row execute function public.trg_games_history();
create trigger journey_entries_history_trigger after insert or update on public.journey_entries for each row execute function public.trg_journey_entries_history();
create trigger trg_games_manual_total_time after update of manual_total_played_minutes on public.games for each row execute function public.log_manual_game_total_time();

-- Dados de teste (como o site teria).
insert into public.games (slug, title, status, image, card_image, review) values
  ('jogo-a', 'Jogo A', 'completed', 'https://x.supabase.co/storage/v1/object/public/site-banners/banners/a.png', '',
   '{"texto": "bom", "imagem": "https://x.supabase.co/storage/v1/object/public/achievement-art/games/a/review.png"}');
insert into public.achievements (game_slug, legacy_id, title, image) values ('jogo-a', '1', 'Conquista 1', 'https://x.supabase.co/storage/v1/object/public/achievement-art/games/a/1.png');
insert into public.achievement_progress (achievement_id, status, earned_at, image_override)
  select id, 'completed', null, 'https://x.supabase.co/storage/v1/object/public/achievement-art/games/a/1-alt.png' from public.achievements;

-- Políticas reais de journey_entries (lidas em 15/11/2026).
create policy "Permitir inserir jornada" on public.journey_entries as permissive for insert to public with check (true);
create policy "Permitir leitura jornada" on public.journey_entries as permissive for select to public using (true);
create policy "Permitir remover jornada" on public.journey_entries as permissive for delete to public using (true);
