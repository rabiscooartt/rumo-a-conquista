-- Pré-verificação SOMENTE LEITURA: o Storage do projeto guarda metadados próprios (user_metadata)?
-- O envio rastreado grava {"sha256": "<64 hex>"} como metadado próprio (cabeçalho x-metadata) e
-- depois confere o valor por info(). Esta consulta mostra se a versão do Storage tem a coluna e
-- se algum objeto já tem metadados próprios. Não lê conteúdo de imagem. Termina em rollback.
begin transaction read only;

-- 1. Colunas de storage.objects (esperado: user_metadata jsonb, ao lado de metadata, que é do sistema).
select c.column_name as coluna, c.data_type as tipo
from information_schema.columns as c
where c.table_schema = 'storage' and c.table_name = 'objects'
order by c.ordinal_position;

-- 2. Últimas migrações do Storage aplicadas no projeto (identifica a versão do serviço).
select m.id, m.name, m.executed_at
from storage.migrations as m
order by m.id desc
limit 8;

-- 3. Quantos objetos de imagem já têm metadados próprios (só contagem e chaves, sem valores).
select o.bucket_id as bucket, pg_catalog.count(*) as objetos,
       pg_catalog.count(*) filter (where o.user_metadata is not null and o.user_metadata <> '{}'::jsonb) as com_metadados_proprios,
       (select pg_catalog.string_agg(distinct k, ', ') from storage.objects as o2, pg_catalog.jsonb_object_keys(coalesce(o2.user_metadata, '{}'::jsonb)) as k
          where o2.bucket_id = o.bucket_id) as chaves
from storage.objects as o
where o.bucket_id in ('achievement-art', 'site-banners', 'site-profile', 'game-images')
group by o.bucket_id
order by 1;

rollback;
