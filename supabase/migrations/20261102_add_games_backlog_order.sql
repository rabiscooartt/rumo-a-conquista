-- Fila da Próxima Maestria: a posição pertence ao jogo.
-- NULL: fora da fila. Número positivo: posição entre os jogos com status 'planned'.
-- Esta migração não altera nenhuma linha existente; a ordem inicial é gravada à parte.
alter table public.games
  add column if not exists backlog_order integer;

alter table public.games
  drop constraint if exists games_backlog_order_positive;
alter table public.games
  add constraint games_backlog_order_positive
  check (backlog_order is null or backlog_order > 0);

-- Adiável para permitir renumerar a fila em um único comando.
alter table public.games
  drop constraint if exists games_backlog_order_unique;
alter table public.games
  add constraint games_backlog_order_unique
  unique (backlog_order) deferrable initially deferred;

-- Mantém posições únicas e contínuas. Não toca em updated_at, que ordena os Jogos Recentes.
create or replace function public.sync_games_backlog_order()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform pg_advisory_xact_lock(hashtext('public.games.backlog_order'));

  update public.games
  set backlog_order = null
  where backlog_order is not null
    and (status is distinct from 'planned' or is_deleted is true);

  with ordered as (
    select
      slug,
      row_number() over (order by backlog_order asc nulls last, created_at asc, slug asc)::integer as position
    from public.games
    where status = 'planned' and is_deleted is not true
  )
  update public.games as game
  set backlog_order = ordered.position
  from ordered
  where game.slug = ordered.slug
    and game.backlog_order is distinct from ordered.position;
end;
$$;

-- Move um jogo e reorganiza os demais na mesma transação: ou tudo é salvo, ou nada muda.
create or replace function public.set_game_backlog_position(p_slug text, p_position integer)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  queue_size integer;
  target integer;
begin
  if p_position is null or p_position < 1 then
    raise exception 'A posição na fila deve ser um número inteiro positivo.' using errcode = '22023';
  end if;

  perform public.sync_games_backlog_order();

  if not exists (
    select 1
    from public.games
    where slug = p_slug and status = 'planned' and is_deleted is not true
  ) then
    raise exception 'Somente jogos em Próxima Maestria têm posição na fila.' using errcode = '22023';
  end if;

  select count(*) into queue_size
  from public.games
  where status = 'planned' and is_deleted is not true;

  target := least(p_position, queue_size);

  with others as (
    select
      slug,
      row_number() over (order by backlog_order asc, slug asc)::integer as position
    from public.games
    where status = 'planned' and is_deleted is not true and slug <> p_slug
  ),
  next_positions as (
    select slug, case when position >= target then position + 1 else position end as position
    from others
    union all
    select p_slug, target
  )
  update public.games as game
  set backlog_order = next_positions.position
  from next_positions
  where game.slug = next_positions.slug
    and game.backlog_order is distinct from next_positions.position;

  return target;
end;
$$;

-- Qualquer caminho que mude o status ou exclua o jogo mantém a fila correta.
create or replace function public.games_backlog_order_trigger()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.sync_games_backlog_order();
  return null;
end;
$$;

drop trigger if exists games_backlog_order_sync on public.games;
create trigger games_backlog_order_sync
  after insert or update of status, is_deleted on public.games
  for each statement
  execute function public.games_backlog_order_trigger();

revoke all on function public.sync_games_backlog_order() from public, anon, authenticated;
revoke all on function public.set_game_backlog_position(text, integer) from public, anon, authenticated;
revoke all on function public.games_backlog_order_trigger() from public, anon, authenticated;
grant execute on function public.set_game_backlog_position(text, integer) to service_role;
