-- Etapa 3.2 — matriz de elegibilidade: cada cenário com objeto próprio numa linha do tempo de
-- varreduras. Confere a prova (storage_lifecycle_evidence) e que o banco recusa classificar ou
-- arquivar sem ela, inclusive por escrita direta do dono.
-- SOMENTE PARA BANCO LOCAL DE TESTE: termina em rollback.
begin;

create function public._lifecycle_expect_error(p_sql text, p_code text, p_label text)
returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if p_code is not null and sqlstate <> p_code then
      raise exception 'FALHA %: esperado erro %, veio % (%)', p_label, p_code, sqlstate, sqlerrm;
    end if;
    raise notice 'ok: % → recusado (%)', p_label, sqlstate;
    return;
  end;
  raise exception 'FALHA %: deveria ter sido recusado', p_label;
end;
$$;
grant execute on function public._lifecycle_expect_error(text, text, text) to service_role;

create function public._m_scan(p_id text, p_at text, p_count integer, p_complete boolean default true)
returns jsonb language sql immutable as $$
  select jsonb_build_object('scan_id', p_id, 'completed_at', p_at, 'complete', p_complete,
    'inventory_status', case when p_complete then 'complete' else 'partial' end, 'image_objects', p_count, 'image_bytes', p_count);
$$;
-- "nome:estado:refs" separados por vírgula → lista de objetos.
create function public._m_objs(p_spec text)
returns jsonb language sql immutable as $$
  select coalesce(jsonb_agg(jsonb_build_object('bucket', 'game-images', 'path', split_part(item, ':', 1),
    'state', split_part(item, ':', 2), 'reference_count', coalesce(nullif(split_part(item, ':', 3), ''), '0')::int,
    'size', 1, 'mimetype', 'image/png') order by ord), '[]'::jsonb)
  from unnest(string_to_array(p_spec, ',')) with ordinality as t(item, ord);
$$;
create function public._m_sync(p_id text, p_at text, p_spec text)
returns jsonb language plpgsql as $$
begin
  perform public.storage_lifecycle_register_scan(public._m_scan(p_id, p_at, jsonb_array_length(public._m_objs(p_spec))), 'teste');
  return public.storage_lifecycle_sync_scan(p_id, public._m_objs(p_spec), 'teste');
end;
$$;
create function public._m_ev(p_path text) returns jsonb language sql stable as $$
  select public.storage_lifecycle_evidence('game-images', p_path);
$$;
-- Registra o veredito do cenário e confere o esperado.
create function public._m_check(p_label text, p_path text, p_eligible boolean, p_reason_like text default null)
returns void language plpgsql as $$
declare
  ev jsonb := public._m_ev(p_path);
begin
  if (ev ->> 'eligible')::boolean is distinct from p_eligible or (p_reason_like is not null and coalesce(ev ->> 'reason', '') || ' ' || coalesce(ev ->> 'stopped_at', '') not like p_reason_like) then
    raise exception 'FALHA %: esperado elegível=% (%), veio %', p_label, p_eligible, coalesce(p_reason_like, '-'), ev;
  end if;
  raise notice 'ok: [%] elegível=% · % · varreduras=% · dias=%', p_label, ev ->> 'eligible', coalesce(ev ->> 'reason', 'prova completa'),
    coalesce(ev ->> 'scans', '0'), coalesce(ev ->> 'span_days', '-');
end;
$$;
grant execute on function public._m_scan(text, text, integer, boolean), public._m_objs(text), public._m_sync(text, text, text),
  public._m_ev(text), public._m_check(text, text, boolean, text) to service_role;

set local role service_role;

-- ------------------------------------------------------------------ A. linha do tempo base
do $$
begin
  perform public._m_sync('scan-20260701T000000Z', '2026-07-01T00:00:00Z',
    'ok.png:observing,reaparece.png:observing,ausente.png:observing,protegido.png:observing,removida.png:observing');
  perform public._m_sync('scan-20260720T000000Z', '2026-07-20T00:00:00Z',
    'ok.png:observing,reaparece.png:referenced:1,ausente.png:observing,protegido.png:observing,removida.png:observing');
  perform public._m_sync('scan-20260805T000000Z', '2026-08-05T00:00:00Z',
    'ok.png:observing,reaparece.png:observing,ausente.png:observing,protegido.png:observing,removida.png:observing,curto.png:observing');
  perform public.storage_lifecycle_register_scan(public._m_scan('scan-20260810T000000Z', '2026-08-10T00:00:00Z', 6, false), 'teste');
  perform public._m_sync('scan-20260815T000000Z', '2026-08-15T00:00:00Z',
    'ok.png:observing,reaparece.png:observing,protegido.png:observing,removida.png:observing,curto.png:observing');
  perform public.storage_lifecycle_set_manual_protection('mp-p', 'game-images', 'protegido.png', true, 'teste', 'em revisão');
  perform public.storage_lifecycle_set_manual_protection('mp-r1', 'game-images', 'removida.png', true, 'teste', 'conferir');
  perform public.storage_lifecycle_set_manual_protection('mp-r2', 'game-images', 'removida.png', false, 'teste', 'conferido');

  perform public._m_check('duas varreduras completas sem referência, 30+ dias (com incompleta no meio)', 'ok.png', true);
  perform public._m_check('menos de 30 dias entre as varreduras', 'curto.png', false, 'intervalo%');
  perform public._m_check('referência que reaparece', 'reaparece.png', false, '%scan-20260720T000000Z%');
  perform public._m_check('proteção manual ativada', 'protegido.png', false, 'proteção manual ativa%');
  perform public._m_check('proteção manual removida dentro do período', 'removida.png', false, 'proteção manual removida%');
  perform public._m_check('objeto ausente do inventário', 'ausente.png', false, '%ausente da varredura scan-20260815T000000Z%');
  perform public._m_check('objeto fora do ciclo de vida', 'nunca-visto.png', false, 'objeto fora do ciclo de vida%');
end;
$$;

-- ------------------------------------------------------------------ B. varredura sem evidência gravada
do $$
begin
  perform public.storage_lifecycle_register_scan(public._m_scan('scan-20260820T000000Z', '2026-08-20T00:00:00Z', 2), 'teste');
  perform public._m_check('varredura válida registrada sem linhas em scan_objects', 'ok.png', false, '%ausente da varredura scan-20260820T000000Z%');
  perform public.storage_lifecycle_sync_scan('scan-20260820T000000Z', public._m_objs('ok.png:candidate,curto.png:observing'), 'teste');
  perform public._m_check('a mesma varredura depois de sincronizada', 'ok.png', true);
end;
$$;

-- ------------------------------------------------------------------ C. candidato sem prova
do $$
declare
  r jsonb;
begin
  -- 3.3: o lote segue; só curto.png (sem prova) é corrigido, com diagnóstico.
  r := public._m_sync('scan-20260822T000000Z', '2026-08-22T00:00:00Z', 'ok.png:candidate,curto.png:candidate');
  if (r ->> 'overrides')::int <> 1 or (select state from public.storage_object_lifecycle where object_path = 'curto.png') <> 'observing'
     or (select state from public.storage_object_lifecycle where object_path = 'ok.png') <> 'candidate' then
    raise exception 'FALHA: só curto.png deveria ser corrigido: %', r;
  end if;
  raise notice 'ok: classificador marca candidato sem prova (curto.png) → corrigido para observing; ok.png (com prova) continua candidato';
end;
$$;
reset role;
-- Proprietário dedicado assumido por um administrador: passa a guarda de papel, mas os gatilhos
-- continuam exigindo prova e transições válidas.
set local role storage_lifecycle_owner;
select public._lifecycle_expect_error($q$update public.storage_object_lifecycle set state = 'candidate' where object_path = 'curto.png'$q$,
  '23514', 'dono grava candidate direto, sem prova');
select public._lifecycle_expect_error($q$update public.storage_object_lifecycle set state = 'candidate' where object_path = 'reaparece.png'$q$,
  '23514', 'dono grava candidate direto em objeto com referência na janela');
select public._lifecycle_expect_error($q$update public.storage_object_lifecycle set archive_state = 'archiving' where object_path = 'curto.png'$q$,
  '23514', 'dono inicia arquivamento direto sem prova');
select public._lifecycle_expect_error($q$update public.storage_object_lifecycle set state = 'superseded', archive_state = 'archiving' where object_path = 'removida.png'$q$,
  '23514', 'dono arquiva como superseded sem prova');
reset role;
set local role service_role;
select public._lifecycle_expect_error($q$select public.storage_lifecycle_begin_operation('a-curto', 'archive_copy', 'game-images', 'curto.png', 'teste', 'x')$q$,
  '23514', 'backend arquiva objeto sem prova');
select public._lifecycle_expect_error($q$select public.storage_lifecycle_register_scan(public._m_scan('scan-20270101T000000Z', '2027-01-01T00:00:00Z', 1), 'teste')$q$,
  '22023', 'varredura com data futura (fabricaria o prazo)');

-- ------------------------------------------------------------------ D. última varredura incompleta
do $$
begin
  perform public.storage_lifecycle_register_scan(public._m_scan('scan-20260825T000000Z', '2026-08-25T00:00:00Z', 2, false), 'teste');
  perform public._m_check('última varredura incompleta', 'ok.png', false, 'a varredura mais recente está incompleta%');
end;
$$;
select public._lifecycle_expect_error($q$select public.storage_lifecycle_begin_operation('a-ok-1', 'archive_copy', 'game-images', 'ok.png', 'teste', 'x')$q$,
  '23514', 'arquivar com a última varredura incompleta');

-- ------------------------------------------------------------------ E. última varredura invalidada
do $$
declare
  r jsonb;
begin
  perform public._m_sync('scan-20260830T000000Z', '2026-08-30T00:00:00Z', 'ok.png:candidate,curto.png:observing');
  perform public._m_check('nova varredura completa depois da incompleta', 'ok.png', true);
  r := public.storage_lifecycle_invalidate_scan('scan-20260830T000000Z', 'teste', 'teste');
  if (r ->> 'candidates_downgraded')::int <> 1 or (select state from public.storage_object_lifecycle where object_path = 'ok.png') <> 'observing' then
    raise exception 'FALHA: candidato deveria voltar a observing: %', r;
  end if;
  perform public._m_check('última varredura invalidada (candidato rebaixado)', 'ok.png', false, 'a varredura mais recente está incompleta ou invalidada%');
end;
$$;
select public._lifecycle_expect_error($q$select public.storage_lifecycle_begin_operation('a-ok-2', 'archive_copy', 'game-images', 'ok.png', 'teste', 'x')$q$,
  '23514', 'arquivar com a última varredura invalidada');

-- ------------------------------------------------------------------ F/G. varreduras invalidadas no meio da janela
do $$
begin
  perform public._m_sync('scan-20260905T000000Z', '2026-09-05T00:00:00Z', 'ok.png:candidate,curto.png:observing');
  perform public._m_check('prova volta com nova varredura válida', 'ok.png', true);
  perform public.storage_lifecycle_invalidate_scan('scan-20260701T000000Z', 'teste', 'teste');
  perform public._m_check('invalidar 01/07 (ainda 47 dias desde 20/07)', 'ok.png', true);
  perform public.storage_lifecycle_invalidate_scan('scan-20260720T000000Z', 'teste', 'teste');
  perform public._m_check('invalidar 20/07 (ainda 31 dias desde 05/08)', 'ok.png', true);
  perform public.storage_lifecycle_invalidate_scan('scan-20260805T000000Z', 'teste', 'teste');
  perform public._m_check('invalidar 05/08 (restam 21 dias)', 'ok.png', false, 'intervalo%');
  if (select state from public.storage_object_lifecycle where object_path = 'ok.png') = 'candidate' then
    raise exception 'FALHA: ok.png não pode continuar candidato sem prova';
  end if;
  raise notice 'ok: [varreduras invalidadas] cada invalidação reduz a janela; sem prova o candidato sai do estado candidate';
end;
$$;

-- ------------------------------------------------------------------ H. baseline original invalidada (identificadores reais)
do $$
declare
  before_ev jsonb;
begin
  perform public._m_sync('scan-20261114T224255Z', '2026-11-14T22:42:55Z', 'faca.png:observing');
  perform public._m_sync('scan-20261114T225139Z', '2026-11-14T22:51:39Z', 'faca.png:observing');
  perform public._m_sync('scan-20261115T000000Z', '2026-11-15T00:00:00Z', 'faca.png:observing');
  before_ev := public._m_ev('faca.png');
  if before_ev ->> 'first_scan' <> 'scan-20261114T224255Z' then
    raise exception 'FALHA: antes da invalidação a sequência começa na baseline original: %', before_ev;
  end if;
  perform public.storage_lifecycle_invalidate_scan('scan-20261114T224255Z', 'não contemplou o bucket game-images', 'teste');
  if public._m_ev('faca.png') ->> 'first_scan' <> 'scan-20261114T225139Z' then
    raise exception 'FALHA: depois da invalidação a sequência começa na nova baseline: %', public._m_ev('faca.png');
  end if;
  if (select observing_since_scan_id from public.storage_object_lifecycle where object_path = 'faca.png') is not null then
    raise exception 'FALHA: observação iniciada na baseline invalidada deveria ser reiniciada';
  end if;
  perform public._m_check('baseline original invalidada (prova recomeça na nova baseline)', 'faca.png', false, 'intervalo%');
  if not exists (select 1 from public.storage_lifecycle_scans where scan_id = 'scan-20261114T224255Z' and complete) then
    raise exception 'FALHA: o registro original da baseline deveria continuar intacto';
  end if;
end;
$$;

reset role;
do $$
begin
  assert (select count(*) from public.storage_operation_log_verify()) = 0, 'FALHA: cadeia íntegra ao fim da matriz';
  assert not exists (select 1 from public.storage_object_lifecycle where state = 'candidate' and not (public.storage_lifecycle_evidence(bucket, object_path) ->> 'eligible')::boolean),
    'FALHA: nenhum candidate pode existir sem prova';
  raise notice 'ok: ao fim da matriz não existe candidate sem prova e a cadeia está íntegra';
end;
$$;

rollback;
