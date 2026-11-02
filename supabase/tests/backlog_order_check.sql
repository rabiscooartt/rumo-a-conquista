-- Confere as regras da fila depois da migração e da ordem inicial.
-- Termina em rollback: nada do que acontece aqui fica gravado.
begin;

do $$
declare
  queue text[];
begin
  perform public.set_game_backlog_position('hollow-knight', 1);
  select array_agg(slug order by backlog_order) into queue
  from public.games where backlog_order is not null;
  assert queue[1:3] = array['hollow-knight', 'song-of-nunu', 'metro-last-light'],
    'mover para posição ocupada deveria reorganizar os demais';

  perform public.set_game_backlog_position('hades', 99);
  select array_agg(slug order by backlog_order) into queue
  from public.games where backlog_order is not null;
  assert queue[array_length(queue, 1)] = 'hades', 'posição acima do fim deveria virar a última';

  update public.games set status = 'completed' where slug = 'metro-last-light';
  assert (select backlog_order from public.games where slug = 'metro-last-light') is null,
    'jogo finalizado deveria sair da fila';

  update public.games set is_deleted = true where slug = 'the-surge';
  assert (select backlog_order from public.games where slug = 'the-surge') is null,
    'jogo excluído deveria sair da fila';

  update public.games set status = 'planned' where slug = 'metro-last-light';
  assert (
    select bool_and(backlog_order = expected_position) and count(*) = max(backlog_order)
    from (
      select backlog_order, row_number() over (order by backlog_order) as expected_position
      from public.games where backlog_order is not null
    ) as numbered
  ), 'posições deveriam continuar contínuas';
  assert (select backlog_order from public.games where slug = 'metro-last-light')
    = (select max(backlog_order) from public.games),
    'jogo que volta à fila deveria entrar no fim';

  begin
    perform public.set_game_backlog_position('mouse-p-i-for-hire', 1);
    raise exception 'jogo finalizado não deveria receber posição';
  exception
    when invalid_parameter_value then null;
  end;

  raise notice 'Fila da Próxima Maestria: todas as verificações passaram.';
end;
$$;

rollback;
