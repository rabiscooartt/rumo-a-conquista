# Testes de integração — ciclo de vida das imagens

Exercitam as rotas e os executores **reais** contra um **PostgreSQL 17 isolado**, com as migrações
do ciclo de vida, os gatilhos reais do projeto (`fixtures/replica.sql`), o papel `postgres` **sem**
superusuário e os papéis do Supabase (`anon`, `authenticated`, `service_role`, `authenticator`).
O PostgREST e o Storage são simulados no próprio processo, em `127.0.0.1`.

**Nunca acessam o Supabase do projeto.** Cada suíte roda com ambiente limpo, sem nenhuma credencial
real. A URL do Supabase aponta para `127.0.0.1`, e um vigia de `fetch` bloqueia qualquer outro host.

## Suítes

| Suíte | O que cobre |
|---|---|
| `reference-sync-sql` | Migração 20261118: pré-verificação, aplicação, privilégios, validação dos itens, semântica do `finish`, rollback. |
| `scan-policy-sql` | Migração 20261119 (política versionada de varredura): varreduras antigas nunca viram prova; execução oficial (abertura antes do relatório, uma por vez, conclusão conferida, falha); atestação com manifesto (versão, fontes, relatório, incompleta, invalidada, sem prova de coleta); intervalo; duas válidas da mesma política; versões que nunca formam par; contornar o executor; privilégios; nova versão; rollback. |
| `bulk-saves` | Salvamentos em massa pelos handlers reais, comparados com a versão anterior das rotas: falha antes e depois da gravação, parcial, resposta e confirmação perdidas, concorrência, reconciliação, ciclos. |
| `isolated-plan` | Teste real em jogo isolado: preparação, ida e volta pela rota `final-mastery`, recuperações. |
| `archive-executor` | Arquivamento e restauração: elegibilidade, SHA-256, tamanho e MIME, conteúdo relido, conflitos, interrupção, retomada (E1–E18). |
| `archive-review` | Concorrência, repetição, ciclos repetidos, limite de 5 tentativas, corrida com `23514` e prova de conclusão, convenção de nome e política de varredura (R1–R11). |
| `archive-script` | `scripts/image-lifecycle-archive.mjs` como processo: `--dry-run` sem nenhuma escrita no servidor, `--apply`, recusas. |
| `achievement-art-http` | Rota `achievement-art`: envio rastreado e lote de referências. |
| `pointer-http` | Rotas `banner-settings` e `profile-avatar`, além da reconciliação. |
| `official-scan` | Fluxo completo da varredura oficial (`officialScan.ts`) no banco real: simulação sem escrita; respostas perdidas e conexões caídas em cada etapa, com retomada sem duplicar; fonte ausente; execução abandonada; duas oficiais com 39 dias. |

As varreduras com 30+ dias de intervalo usam uma "viagem no tempo" só de teste
(`support/officialRun.mjs`). Como superusuário do cluster descartável, ela recua a abertura da execução e
recalcula a cadeia de hashes. Nada disso existe nas migrações.

## Portas

Os servidores simulados usam `127.0.0.1` nas portas 24412 e 24421–24430, fora das portas
temporárias do Linux (32768–60999) e do Windows (49152–65535). O executor confere cada porta antes
e depois de cada suíte e, se ela estiver ocupada, falha com o diagnóstico, sem esperar. Cada suíte
encerra o próprio servidor em `finally` (`support/server.mjs`).

## Dependências

- Node.js 24 ou superior (TypeScript direto pelo Node).
- `npm ci`, que instala `pg` (devDependency) e `sharp`.
- Um PostgreSQL 17 **exclusivo para testes**, com um superusuário chamado `supabase_admin` (ou
  `PG_ADMIN_USER`) e um banco `postgres`. As suítes criam e apagam bancos e papéis
  (`postgres`, `anon`, `authenticated`, `service_role`, `authenticator`, `storage_lifecycle_owner`).
  Não aponte para nenhum banco com dados.
- Histórico do git completo (`bulk-saves` e `isolated-plan` leem a versão de referência das rotas no
  commit `9661ac3`; mude com `LIFECYCLE_BASELINE_COMMIT`).

## Como executar

Servidor já em execução, como o contêiner do CI:

```bash
docker run --rm -d -p 55433:5432 -e POSTGRES_USER=supabase_admin -e POSTGRES_DB=postgres -e POSTGRES_HOST_AUTH_METHOD=trust postgres:17
PGHOST=127.0.0.1 PGPORT=55433 npm run test:integration
```

Binários locais, com um cluster novo em pasta temporária para cada suíte:

```bash
LIFECYCLE_PG_BIN=/caminho/para/postgresql-17/bin npm run test:integration
```

Para rodar só algumas suítes: `npm run test:integration -- archive-review archive-executor`.
