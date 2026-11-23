# Ciclo de vida das imagens — planejamento das varreduras oficiais

## Regra de elegibilidade

Um objeto do Storage só pode ser arquivado (e, depois, ter o original removido) quando houver **duas
varreduras oficiais completas e válidas, com pelo menos 30 dias entre elas**, nas quais ele apareceu
**sem nenhuma referência**. Isso vale além das demais exigências: estado `candidate` ou `superseded`,
nenhuma proteção e a guarda do banco aprovando.

## A varredura de 15/11/2026 não serve como primeira prova

A varredura `scan-20261115T163906Z` (inventário inicial sincronizado em produção) é anterior à fonte
de referências `convention`. Essa fonte cobre as imagens que a página pública exibe pela convenção de
nome (`lib/achievementImageCandidates.ts`, usada pelo `GameAchievementsPanel` e pela varredura).

- Ela continua registrada como **evidência histórica** (no banco e em `.image-report/lifecycle/`). Não é
  apagada nem alterada.
- Ela **não conta como primeira prova de elegibilidade**. A proteção está no BANCO, pela política
  versionada de varredura (migração `20261119_storage_lifecycle_scan_policy.sql`):
  - `storage_lifecycle_evidence` só conta varreduras **oficiais**: execução aberta no banco antes da
    coleta (`storage_lifecycle_begin_scan_run`) e **concluída com sucesso**
    (`storage_lifecycle_finish_scan_run`), **atestadas** pela versão vigente da política
    (`storage_lifecycle_scan_policies`; v2 = as 10 fontes, inclusive `convention`) com um **manifesto** das
    fontes, **completas**, não invalidadas e com o **mesmo SHA-256 de relatório** registrado. A guarda dos gatilhos, a sincronização
    e o início do arquivamento usam essa prova: contornar o executor não ajuda.
  - `storage_lifecycle_attest_scan` recusa varreduras **registradas antes** da instalação da versão
    vigente, sem execução oficial, com relatório concluído **antes** da abertura da execução, com execução
    aberta por outra versão ou já encerrada, incompletas, invalidadas, com relatório diferente ou com
    manifesto sem alguma fonte completa. A de 15/11 nunca pode ser atestada.
  - Uma versão nova da política invalida, como prova, tudo o que foi atestado pelas anteriores.
  - Defesa adicional: o plano de sincronização recusa relatórios sem a fonte `convention`
    (`REQUIRED_SOURCES`), e os executores de arquivamento exigem que a prova do banco venha marcada
    com a versão vigente (`policy_version`), recusando-a se a migração não estiver aplicada.

## Cronograma

1. **Publicar** a implementação (fonte `convention` e barreira de evidência).
2. **Primeira varredura oficial**, completa, depois da publicação e da migração 20261119, com autorização:
   `node --env-file=.env.local scripts/image-lifecycle-official-scan.mjs --apply --confirm-remote`
   (antes, a simulação `--dry-run`). Ela é a **primeira prova**. Veja "Fluxo da varredura oficial".
3. **Segunda varredura oficial**, completa e atestada pela mesma versão da política, **pelo menos 30 dias
   depois** da primeira. Ela é a **segunda prova**.
4. Só então algum objeto pode aparecer como elegível. Antes disso, **nenhum objeto é elegível**.

## Fluxo da varredura oficial

`lib/images/lifecycle/officialScan.ts` (script `scripts/image-lifecycle-official-scan.mjs`), em ordem fixa:

1. `storage_lifecycle_begin_scan_run`: abre a execução oficial **antes** da coleta, com a versão vigente
   da política. Uma execução por vez.
2. Coleta de todas as fontes exigidas pela política.
3. Relatório completo, manifesto das fontes (status, contagem e resumo SHA-256 das referências de cada
   uma) e SHA-256 do relatório, que também cobre o manifesto.
4. Gravação em `.image-report/lifecycle/<scanId>/` (arquivos novos, nunca sobrescritos), releitura e
   conferência; uma linha no `history.jsonl` com `official: true` e `policyVersion`.
5. `storage_lifecycle_register_scan`.
6. `storage_lifecycle_attest_scan` com o manifesto e o SHA-256.
7. `storage_lifecycle_sync_scan` (plano incremental, reconferido com o estado do banco).
8. `storage_lifecycle_finish_scan_run`: o banco só aceita "succeeded" com registro, atestação desta
   execução, sincronização concluída **depois** da atestação e uma linha de evidência por imagem.
9. Conferência final: estado persistido igual ao relatório, varredura reconhecida pela política e
   cadeia de auditoria íntegra. Se falhar, a varredura é **invalidada**.

- **Retomada:** cada etapa vai para `official-run.jsonl`. Repetir com `--scan-id <scanId>` continua de
  onde parou sem duplicar nada (as funções do banco são idempotentes). Depois da gravação, o relatório
  nunca é coletado de novo.
- **Falha fechada:** fonte ausente ou incompleta, relatório inválido ou alterado, política mudada ou
  recusa do banco encerram a execução como **falha**, e essa varredura nunca vale como prova. Falhas de
  rede só param (são retomáveis). Uma execução pendente pode ser abandonada com `--abandon <scanId>`.
- **Prova só de varredura concluída:** atestada e sincronizada, mas sem conclusão, ainda não vale.

## Limite de confiança da atestação (risco residual)

O banco não vê a coleta (ela lê o Storage e as tabelas de fora dele), então não pode provar sozinho que
cada fonte foi lida. Sem ampliar nenhuma permissão, ele agora exige:

- **Uma sequência que só o fluxo oficial produz:** execução aberta antes do relatório (pelo relógio do
  banco), relatório concluído depois da abertura, registro, atestação ligada àquela execução,
  sincronização depois da atestação e conclusão conferida. Simulação ou registro direto não viram
  oficiais depois.
- **Vínculo:** a atestação guarda o manifesto, o SHA-256 dele, o SHA-256 do relatório, a versão e a
  execução. O relatório local inclui o manifesto e o identificador da execução.
- **Sem repetição nem mistura:** uma atestação por varredura e por execução, e outros dados são recusados.
  A execução de uma versão nunca é atestada por outra, e uma versão nova invalida as provas das anteriores.
- **Chamadas diretas:** todas as funções são `SECURITY DEFINER` do dono sem login. `anon` e
  `authenticated` não executam nenhuma delas, e `service_role` não grava nas tabelas nem na auditoria.

**Risco residual aceito:** quem tem a chave `service_role` pode chamar as funções na ordem certa com um
manifesto inventado. Essa chave já é a raiz de confiança do projeto (pode apagar objetos do Storage e
ler tudo) e fica só no servidor e nos scripts locais. Mitigações:
- a sequência deixa rastro auditado e encadeado;
- o intervalo de 30 dias usa o relógio do banco;
- o arquivamento é reversível (o original só é removido depois, numa etapa separada).

## O que não conta como varredura oficial

- Simulações e inventários somente de leitura (`--dry-run` e `scripts/image-lifecycle-scan.mjs`): não
  abrem execução no banco e não podem ser promovidos depois.
- Execuções encerradas como falha ou ainda não concluídas.
- Varreduras incompletas, com qualquer fonte `partial` ou `failed`, ou invalidadas.
- Varreduras não atestadas pela versão vigente da política (inclusive todas as anteriores a ela).

## Cerca das fontes (migração 20261120)

A prova das varreduras sozinha não via um salvamento feito durante a coleta, nem uma imagem que voltasse
a ser usada depois da varredura. A migração `20261120_storage_lifecycle_source_fence` fecha isso no banco:

- **Diário** (`storage_lifecycle_source_changes`): gatilhos em `games`, `achievements`,
  `achievement_progress`, `journey_entries` e `journey_history_events` gravam as chaves do Storage
  que entram e saem de cada linha, e o prefixo da convenção quando muda o título ou o jogo de uma
  conquista (ou o selo final do jogo). Pegam qualquer gravador: rotas, painel do Supabase, scripts.
  Em `storage.objects`, só os caminhos-fonte (`site-profile/active/*` e os 2 buckets de rascunho)
  entram, com escopo total (o conteúdo não é visível no banco).
- **Cerca**: quem grava numa fonte segura uma trava compartilhada até o COMMIT. Abertura, sincronização
  e conclusão da varredura oficial e a autorização de arquivar/remover pegam a trava exclusiva por
  tentativas de 20 ms, por até 3 s, sem entrar na fila. Se houver gravação em andamento, devolvem
  `55P03` e nada muda: o orquestrador para de forma retomável e o executor marca
  `aguardando_gravacao`. Qualquer evento do diário depois do marcador da abertura faz a
  sincronização ou a conclusão recusarem com `scan_sources_changed`; a execução vira `failed` e uma
  varredura nova precisa ser feita.
- **Prova**: além das regras acima, nenhum evento depois do marcador da última varredura pode ter tocado
  o objeto, um prefixo que o contém ou todos os objetos. Editar um ponteiro ou rascunho, portanto,
  suspende os arquivamentos até a próxima varredura.
- **Autorização**: arquivar e remover conferem o uso real em todas as linhas das fontes do banco, com a
  trava exclusiva. Remover o original exige uma varredura oficial aberta **depois** do arquivamento.
- **Estado durável**: o gatilho das fontes recusa referência nova a objeto fora de `none`, para
  qualquer gravador. Durante uma remoção (`deleting`), gravações de ponteiro e rascunho também são
  recusadas (janela de segundos).

As funções públicas mantêm nome e assinatura; as anteriores ficam como `*_base`, sem acesso do
`service_role`. Execuções oficiais abertas antes desta migração não têm marcador e são recusadas na
sincronização (`scan_run_without_fence`): encerre-as como falha antes de começar outra.

Aplicação (só com autorização): pré-verificação `supabase/tests/storage_lifecycle_source_fence_precheck.sql`
(somente leitura), depois a migração. Rollback: `supabase/rollbacks/20261120_storage_lifecycle_source_fence_rollback.sql`,
recusado depois que uma execução oficial usou a cerca. Deve rodar antes de qualquer rollback da 20261119.

## Antes do primeiro arquivamento real

- O bucket `image-archive` precisa existir e ser privado. A criação é uma etapa separada, que exige
  autorização.
- As migrações 20261119 e 20261120 precisam estar aplicadas (escrita no banco, com pré-verificação e autorização).
- A ferramenta das varreduras seguintes existe (`scripts/image-lifecycle-official-scan.mjs`). Nunca foi
  executada em produção.
