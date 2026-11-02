-- Ordem inicial da fila da Próxima Maestria, confirmada pelo criador em 02/11/2026.
-- Executar uma vez, logo depois da migração 20261102_add_games_backlog_order.sql.
-- Se o estado dos jogos não for o esperado, nada é gravado.
do $$
declare
  expected constant text[] := array[
    'song-of-nunu',
    'hollow-knight',
    'metro-last-light',
    'the-surge',
    'tom-clancy-s-the-division',
    'hades'
  ];
  found_count integer;
  extra_slugs text;
begin
  select count(*) into found_count
  from public.games
  where slug = any(expected) and status = 'planned' and is_deleted is not true;

  if found_count <> array_length(expected, 1) then
    raise exception 'Fila não inicializada: só % dos 6 jogos estão em planned.', found_count;
  end if;

  select string_agg(slug, ', ') into extra_slugs
  from public.games
  where status = 'planned' and is_deleted is not true and not (slug = any(expected));

  if extra_slugs is not null then
    raise exception 'Fila não inicializada: há outros jogos em planned: %.', extra_slugs;
  end if;

  update public.games as game
  set backlog_order = queue.position_in_list
  from unnest(expected) with ordinality as queue(slug, position_in_list)
  where game.slug = queue.slug;
end;
$$;

select slug, status, backlog_order
from public.games
where backlog_order is not null
order by backlog_order;
