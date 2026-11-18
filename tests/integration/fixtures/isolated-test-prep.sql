-- PROPOSTA (não executada): registro de teste ISOLADO para exercitar /api/admin/games/final-mastery.
-- Jogo oculto E excluído (fora do catálogo, da página pública, da fila e das listas do admin).
-- O gatilho games_history_trigger grava 'game_registered' ao inserir; esse evento entraria na contagem
-- pública "jogos registrados" do histórico anual. Ele é removido NA MESMA transação, então o histórico
-- público não muda. Tudo ou nada: qualquer verificação falha → nada fica gravado.
begin;

do $$
begin
  if exists (select 1 from public.games where slug = 'lifecycle-test') then
    raise exception 'Já existe um jogo lifecycle-test; nada foi alterado.';
  end if;
end;
$$;

create temporary table antes on commit drop as
select (select count(*) from public.journey_history_events) as eventos,
       (select count(*) from public.games) as jogos,
       (select count(*) from public.games where status = 'planned' and is_deleted is not true) as fila;

insert into public.games (slug, title, status, is_hidden, is_deleted, final_badge)
values ('lifecycle-test', '[teste interno] Ciclo de vida das imagens', 'progress', true, true,
  '{"title": "Teste do ciclo de vida", "icon": "💎", "image": "/images/games/mouse-p-i-for-hire/achievements/maestria-final.png", "description": "Registro isolado de teste; nunca exibido."}');

delete from public.journey_history_events
where source_table = 'games' and event_type = 'game_registered'
  and source_id = (select id::text from public.games where slug = 'lifecycle-test');

do $$
declare
  a record;
begin
  select * into a from antes;
  if (select count(*) from public.journey_history_events) <> a.eventos then
    raise exception 'Histórico mudou; nada foi gravado.';
  end if;
  if (select count(*) from public.games) <> a.jogos + 1 then
    raise exception 'Contagem de jogos inesperada; nada foi gravado.';
  end if;
  if (select count(*) from public.games where status = 'planned' and is_deleted is not true) <> a.fila then
    raise exception 'Fila mudou; nada foi gravado.';
  end if;
  if not exists (select 1 from public.games where slug = 'lifecycle-test' and is_hidden and is_deleted and backlog_order is null) then
    raise exception 'Jogo de teste não ficou oculto, excluído e fora da fila; nada foi gravado.';
  end if;
end;
$$;

commit;
