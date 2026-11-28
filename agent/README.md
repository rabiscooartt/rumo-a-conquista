# Agente Windows — Rumo à Conquista

Motor operacional local do sistema. O site continua sendo a fonte de verdade. O agente
detecta, persiste, processa e sincroniza, e conversa com o OBS. Fase atual: **1 — núcleo**.

Requisito: Node.js 24 ou mais recente. O agente usa o `node:sqlite` nativo e o WebSocket nativo,
então não precisa de nenhuma dependência nova.

## Comandos

Todos os comandos rodam na raiz do repositório:

```powershell
npm run agent -- start          # inicia em modo contínuo (Ctrl+C encerra de forma controlada)
npm run agent -- status         # estado operacional (ou o último estado salvo, se o agente estiver parado)
npm run agent -- stop           # encerramento controlado pela API local
npm run agent -- events         # lista eventos (--status failed, --type X, --limit N, --json)
npm run agent -- event <id>     # detalhes de um evento e histórico de tentativas
npm run agent -- emit agent.diagnostic '{"message":"teste"}' --dedupe chave-1 --test
npm run agent -- retry <id>     # reenfileira um evento que está em failed
npm run test:agent              # testes do agente
```

Para verificar a cadeia completa, use eventos `agent.diagnostic` com estes payloads:
`{"failAttempts":2}` testa o retry, `{"delayMs":5000}` testa a recuperação se o agente cair
no meio do processamento, e `{"permanentFailure":true}` testa o estado failed e o retry manual.

## Dados e configuração

A pasta de dados é `%LOCALAPPDATA%\RumoAConquista\agent`. Ela pode ser trocada com
`RUMO_AGENT_DATA_DIR` ou com a opção `--data-dir`.

| Arquivo | Conteúdo |
|---|---|
| `config.json` | Configuração. É criado na primeira execução. |
| `agent.db` | SQLite (WAL, `synchronous=FULL`) com a fila de eventos, as tentativas e o estado operacional. |
| `logs/agent-AAAA-MM-DD.log` | Logs em JSON Lines. Ficam 14 dias por padrão. |
| `agent.lock` | Garante uma única instância. Guarda o PID e a porta da API local. |
| `control-token` | Token local, exigido nas operações da API que alteram estado. |

Variáveis de ambiente (têm prioridade sobre o `config.json`): `RUMO_AGENT_SITE_URL`,
`RUMO_AGENT_OBS_URL`, `RUMO_AGENT_OBS_PASSWORD`, `RUMO_AGENT_OBS_ENABLED`,
`RUMO_AGENT_CONTROL_PORT`, `RUMO_AGENT_LOG_LEVEL`.

**Segurança:** o agente se recusa a iniciar se encontrar uma credencial privilegiada do Supabase
(JWT service-role ou `sb_secret_*`) na configuração ou no ambiente.

## API local (somente 127.0.0.1:47821)

- `GET /health`, `GET /status`, `GET /events`, `GET /events/:id`: leitura.
- `POST /events`, `POST /events/:id/retry`, `POST /shutdown`: exigem o cabeçalho `x-agent-token`.
- Requisições com Host diferente de `127.0.0.1` ou `localhost` são recusadas (proteção contra DNS rebinding).

## Estrutura

```
agent/src/
  main.ts                CLI (start/stop/status/events/emit/retry)
  config.ts              configuração e bloqueio de credenciais privilegiadas
  logger.ts              logs com escopo, ocultação de segredos e arquivo diário
  core/agent.ts          ciclo de vida: início, recuperação, sinal de vida, encerramento
  core/module.ts         contrato dos módulos (AgentModule / ModuleContext)
  core/instanceLock.ts   instância única
  store/                 SQLite, migrações e estado chave/valor
  events/eventStore.ts   fila persistente: deduplicação, estados, retry, recuperação
  events/processor.ts    execução dos handlers: timeout, retry, adiamento, falha permanente
  connections/           conexão gerenciada (reconexão), site e OBS (obs-websocket v5)
  control/               API HTTP local
  modules/               módulos carregados (Fase 1: diagnostics)
```

## Fase 2: identificação de jogos e sessões (módulo `games`)

**Fontes de detecção**, verificadas a cada 5 s (`gamePollSeconds`):

1. **Steam:** o valor `RunningAppID` no registro diz qual jogo está aberto, e o nome vem dos
   manifestos locais (`appmanifest_<id>.acf`), em todas as bibliotecas da Steam. A chave é `steam:<appid>`.
2. **Jogos externos:** executáveis mapeados manualmente. A chave é `exe:<nome.exe>`.
3. **Emuladores conhecidos** (RetroArch, PCSX2, DuckStation, Dolphin, RPCS3, PPSSPP etc.): o
   jogo é lido do título da janela. A chave é `emulator:<id>`.

**Resolução:** primeiro vale o mapeamento manual. Depois o agente compara o nome com o catálogo
público do site (`/api/games/catalog`, que fica em cópia local e funciona offline). Quando acha
um jogo, o casamento automático fica gravado. Se não achar, a sessão é registrada mesmo assim,
sem slug.

**Sessões:**
- Uma sessão abre depois de 10 s de detecção contínua.
- Ela fecha 45 s depois de o jogo sumir. O horário de fim é o último momento em que o jogo foi visto.
- Trocar de jogo fecha a sessão anterior e abre outra.
- Depois de uma queda ou reinício do agente, a sessão é retomada se o jogo ainda estiver aberto
  e se o agente ficou parado menos de 10 min.
- Cada abertura e cada fechamento grava a sessão e o evento juntos, na mesma transação:
  `game.session.started` e `game.session.ended`. O payload do `ended` é o definitivo.
- Esses eventos ficam na fila até a sincronização com o site (Fase 3).

```powershell
npm run agent -- games                          # jogo detectado, sessão ativa, catálogo
npm run agent -- games sessions
npm run agent -- games map exe:MeuJogo.exe hades
npm run agent -- games map steam:1245620 howgarts-legacy
npm run agent -- games ignore steam:1369320     # app Steam que não é jogo (ex.: Virtual Cottage)
npm run agent -- games unmap exe:MeuJogo.exe
npm run agent -- games catalog --refresh
```

API local: `GET /modules/games/status|sessions|mappings|catalog`, e com token
`POST /modules/games/mappings` e `POST /modules/games/catalog/refresh`.

## Fase 3: conquistas e sincronização automática (módulo `achievements`)

**Fluxo:** jogo em sessão → provedor lê a fonte → o agente compara com o último estado gravado
→ grava o evento `achievement.unlocked` (deduplicado) → o processador envia ao site →
o site confirma → o evento é concluído.

### Provedores

Todos implementam `AchievementProvider` (`modules/achievements/providers/types.ts`).

| Provedor | Fonte | Situação |
|---|---|---|
| `steam-local` | Cache local do cliente Steam (`Steam/appcache/stats/*.bin`): o ID estável da conquista (apiname), o estado e o horário do desbloqueio informado pela própria Steam. Sem rede, sem credenciais. | Implementado |
| `operator` | Desbloqueio informado pelo operador com o id canônico do site, para jogos sem fonte automática (CLI agora, dock na Fase 4). | Implementado |
| RetroAchievements, emuladores, arquivos de jogos externos | — | Futuros: basta implementar a interface |

### Regras de detecção

- A primeira leitura de uma fonte é a **linha de base**: o histórico antigo não é enviado. A
  exceção é o que a fonte data de depois do início da sessão atual.
- Depois disso, todo novo desbloqueio vira evento, inclusive os feitos com o agente parado. As
  fontes já conhecidas são reconciliadas na inicialização e a cada 30 min.
- A deduplicação usa a chave `achievement:<provedor>:<fonte>:<id>`. Por isso nenhuma releitura,
  reinício, re-bloqueio ou repetição gera duplicata.
- O horário vem da fonte (`timestampKind: "source"`). Quando a fonte não informa, o evento leva
  o momento da detecção (`"detected"`), marcado como tal.

### Endpoint do site: `POST /api/agent/achievements`

- **Autenticação:** cabeçalho `Authorization: Bearer <AGENT_SYNC_TOKEN>`. O token é um segredo
  aleatório de 32 ou mais caracteres, configurado no servidor e no agente (`siteAgentToken` ou
  `RUMO_AGENT_SITE_TOKEN`). A service-role fica só no servidor.
- **Vínculo:** o provedor `steam` exige `achievements.source = 'steam'` e
  `achievements.external_id = <apiname>`. O provedor `site` usa `legacy_id` ou `id`. O endpoint
  **nunca cria** conquistas nem vínculos.
- **Respostas:**
  - `200 unlocked` ou `already_completed`: idempotente. Nunca regrava nem troca a data.
  - `400 invalid`.
  - `401 unauthorized`.
  - `409 game_mismatch` ou `ambiguous`.
  - `422 unknown_game` ou `unmatched`.
  - `503 not_configured` ou `temporarily_unavailable`.
- **Data gravada em `earned_at`:** é o dia no fuso de São Paulo. Usa a data da fonte ou a da
  detecção ao vivo. Uma detecção tardia sem data da fonte não inventa data.

### No agente

- `200`: o evento é concluído.
- `4xx` de dados: o evento vai para `failed`, com o diagnóstico do site. Corrija o vínculo e rode `retry <id>`.
- Rede ou `5xx`: nova tentativa com backoff.
- Sem token, `401` ou endpoint ainda não publicado: o evento é adiado sem gastar tentativa.
- Eventos de teste (`--test`) nunca vão ao site.

```powershell
npm run agent -- achievements                       # fontes, leituras e desbloqueios
npm run agent -- achievements scan                  # relê agora
npm run agent -- achievements unlock <slug> <id-no-site> [--test]
```

## Fase 4.1: dock do OBS (módulo `dock`)

É um painel **só informativo**, servido pelo próprio agente, que mostra o jogo atual, a sessão e
o estado do agente, do OBS, do site e da sincronização. Ele não envia nenhum comando ao OBS e
não altera o agente.

### Como adicionar ao OBS

1. Inicie o agente com `npm run agent -- start`.
2. No OBS, abra **Docks > Docks de navegador personalizados…** (em inglês, *Docks > Custom Browser Docks…*).
3. Preencha **Nome do dock** com `Rumo à Conquista` e **URL** com `http://127.0.0.1:47821/modules/dock/`.
4. Clique em **Aplicar** e posicione o dock onde preferir.

Não há token na URL. O dock só lê `GET /modules/dock/state`, na mesma origem da API local, que
aceita apenas conexões do próprio computador.

### O que o dock mostra

- **Recolhido:** o jogo atual, o estado da sessão (com tempo decorrido) e um indicador geral.
- **"Detalhes":** agente (versão e tempo ativo), OBS (versão quando conectado), site e
  sincronização (fila, falhas, token).
- **Cores:**
  - verde: normal;
  - âmbar: atenção ou estado degradado (reconectando, jogo fora do catálogo, sincronização não configurada ou com falhas);
  - vermelho: falha (agente indisponível, ou conexão perdida após 3 tentativas);
  - cinza: inativo ou desativado.
- **Atualização:** a cada 3 s. Quando falha, o intervalo cresce até 15 s; com o dock oculto, fica
  em 10 s. Se o agente cair, o dock mostra "Agente indisponível" e volta sozinho quando o agente
  retornar.

### Limitação

Se o OBS abrir o dock com o agente desligado, a página nem chega a carregar, porque é servida
pelo agente. Nesse caso, inicie o agente e recarregue o dock (clique direito no dock >
Recarregar, ou feche e abra o OBS). Com a página já carregada, a recuperação é automática.

## Fase 4.2: motor e fila de alertas (módulo `alerts`)

O **alerta** é uma entidade própria (o que apresentar), guardada na tabela `alerts` (migração v4).
Ela fica separada do **evento** que a originou (o que aconteceu); a ligação é feita por
`source_event_id`.

### Ingestão

- O motor lê os eventos `achievement.unlocked` já persistidos, em ordem (`seq`), a partir de um
  cursor salvo no SQLite. Cada evento elegível vira um alerta.
- O alerta e o avanço do cursor são gravados na **mesma transação**, então nada se perde ou
  duplica se o agente cair no meio.
- **Elegível** é o desbloqueio percebido ao vivo (`detectedLive`). Reconciliações de períodos
  offline não geram alerta.
- Um desbloqueio detectado há mais de 10 min vira um alerta já `expired`, para não aparecer fora de hora.
- Na primeira execução, o cursor começa no evento atual: o histórico anterior não vira alerta.
- **Deduplicação:** o evento já é único por conquista. O alerta é único por evento
  (`dedupe_key = alert:achievement:<eventId>`).

### Ciclo de vida

```
pending → processing → completed
             ├─ erro → retry_wait (backoff de 3 s a 60 s) → processing … até 3 tentativas → failed
             ├─ apresentador indisponível → retry_wait (sem gastar tentativa)
             └─ apresentação travada além de 60 s → aborta e conta como erro
pending/retry_wait sem apresentar em 30 min → expired
failed/expired → pending (reprocessamento manual: alerts retry <id>)
```

- **Um por vez:** a ordem é por prioridade (hoje todas 0; a Maestria entra com prioridade
  maior) e, dentro dela, por ordem de chegada.
- **Conclusão:** um alerta só é concluído pela tentativa que o reservou, depois de o apresentador terminar.
- **Queda do agente:** o alerta que estava em apresentação volta para a fila no próximo início.
  A tentativa conta, então não há ciclo infinito.

### Apresentação

Esta fase não apresenta nada. A Fase 4.3 registra um `AlertPresenter` no serviço `alerts`
(`setPresenter`). Até lá, os alertas ficam pendentes até o prazo.

```powershell
npm run agent -- alerts                 # fila (--status pending|failed|…, --json)
npm run agent -- alerts retry <id>      # reenfileira failed/expired
```

API local: `GET /modules/alerts/status` e `GET /modules/alerts/list`, e `POST /modules/alerts/retry`
com token. No dock, a linha "Alertas" mostra a fila, a apresentação em andamento, as falhas e se
há apresentador conectado.

## Fase 4.3: apresentador visual no OBS (módulo `overlay`)

É uma Browser Source servida pelo agente, na mesma origem da API local e sem token na URL.

### Instalação no OBS

- **Nome sugerido:** `Rumo à Conquista — Alertas`
- **Tipo:** Navegador (Browser Source), uma fonte **nova**, independente das que já existem
- **URL:** `http://127.0.0.1:47821/modules/overlay/`
- **Largura e altura:** `1920` × `1080`, ocupando o canvas inteiro (o fundo é transparente)
- **Posição:** acima do gameplay na lista de fontes. O cartão aparece centralizado no topo, a 56 px da borda.
- Para posicionar sem disparar nada, abra `…/modules/overlay/?demo=1`: a página repete um alerta
  de exemplo sem falar com a fila.

### Como a fila conversa com o apresentador

1. A Browser Source conecta em `GET /modules/overlay/events` (Server-Sent Events). Enquanto houver
   pelo menos um overlay conectado, o módulo fica registrado como apresentador da fila da Fase 4.2.
   Sem overlay conectado, a fila espera sem gastar tentativas.
2. A fila reserva o próximo alerta e o overlay recebe `present`, com um **nonce** único da tentativa.
3. O overlay confirma `started` por `POST /modules/overlay/ack`. Nesse momento o motor grava o
   início real (`started_at`). Se a confirmação não chegar em 5 s, a tentativa falha.
4. A animação segue: entrada de 0,7 s, permanência configurável (`alertDisplaySeconds`, padrão 7 s,
   entre 3 e 20) e saída de 0,6 s.
5. O overlay confirma `ended`, e só então o alerta é concluído na fila e o próximo pode ser apresentado.

### Proteções

- Confirmação com nonce antigo ou inventado é recusada (409).
- `POST /ack` sem token só é aceito vindo da própria origem (403 para outros sites).
- Se o overlay cair no meio da apresentação, a tentativa falha e a fila reapresenta o alerta, com
  backoff e limite de 3 tentativas.
- Se o agente reiniciar no meio, o alerta volta pela recuperação da Fase 4.2.

### Teste isolado

```powershell
npm run agent -- overlay test
```

O teste percorre o mesmo caminho (SSE, animação, confirmações), mas com uma apresentação de exemplo
marcada como **TESTE**. Ele não cria alerta na fila, nem evento, nem conquista, nem sessão. Sem
overlay conectado, ele avisa (409). `npm run agent -- overlay status` mostra os overlays conectados.

No dock, a linha "Alertas" mostra "Overlay conectado" ou "Overlay desconectado" e "Apresentando"
com o nome da conquista.

## Fase 4.4: controles operacionais

Os controles ficam no dock, em **Controles** (recolhido por padrão), e também no CLI. As ações do
dock não usam token: só são aceitas vindas da própria origem do agente (outros sites recebem 403),
e cada ação que altera dados pede um segundo clique ("Confirmar?").

### Corrigir o jogo da sessão

- **Dock:** Controles > Corrigir jogo da sessão, escolher o jogo e clicar em **Aplicar**.
  "Lembrar para este executável" também grava um mapeamento manual para as próximas sessões.
- **CLI:** `npm run agent -- games correct <slug> [--remember]`.
- Só a sessão **ativa** é corrigida. Ela não é duplicada, e sessões encerradas não mudam.
- A escolha é gravada na sessão (`manual_slug`, migração v5) e prevalece sobre a detecção
  enquanto o mesmo executável ou fonte estiver em execução, inclusive depois de reiniciar o agente.
- Cada correção fica registrada em `detail.corrections`.
- Conquistas detectadas para essa fonte passam a ir para o jogo corrigido.
- Um jogo fora do catálogo do site não pode ser escolhido: cadastre-o no site primeiro.

### Desbloquear uma conquista CUSTOM

- **Dock:** Controles > Conquista CUSTOM.
  - **Escolher uma CUSTOM publicada:** a lista vem do catálogo público do site
    (`/api/games/catalog?achievements=1`) e mostra as já concluídas desabilitadas. O desbloqueio
    usa o id canônico, e o alerta mostra o nome, a descrição e a imagem reais.
  - **Digitar o nome:** se existir uma CUSTOM com esse título no jogo, ela é usada; senão o
    provedor `custom` envia o título, e o site só registra se encontrar exatamente uma CUSTOM
    com esse título. O site nunca cria conquistas: se não houver, o evento falha com a
    orientação "crie-a no site e reenvie" (`npm run agent -- retry <id>`).
- **CLI:** `npm run agent -- achievements custom <slug> (--id ID | --name "Nome" [--description "..."]) [--test]`.
- O fluxo é o de sempre: evento `achievement.unlocked` (deduplicado), sincronização com o site,
  alerta na fila e apresentação no overlay. O alerta mostra "Conquista CUSTOM desbloqueada".
- **Teste:** com "Teste" marcado, o alerta aparece com o selo TESTE e nada é enviado ao site.
  Um teste nunca ocupa a vaga de deduplicação do desbloqueio real.

### Limitações

- O suporte do site ao provedor `custom` (busca pelo título) só vale depois do deploy das
  mudanças em `lib/agentSync/` e com `AGENT_SYNC_TOKEN` configurado no site.
- Sem sessão ativa não há o que corrigir: a rota responde 409.
- Com a seção Controles aberta, o dock passa a ter rolagem.

## Fase 4.5: Maestria (módulo `mastery`)

A Maestria é a conclusão integral das conquistas elegíveis de um jogo. O agente detecta, guarda
e apresenta a Maestria, mas não grava nada no site, porque lá a Maestria Final é calculada a
partir do progresso.

### Como é detectada

1. O site confirma um desbloqueio **novo** (`unlocked`) de uma conquista real. Uma resposta
   `already_completed` também conta, mas só numa nova tentativa: a anterior pode ter gravado no
   site e caído antes do passo 2.
2. O agente grava um evento `mastery.check` com a chave `mastery-check:<id do desbloqueio>`.
3. O handler relê o catálogo público do site
   (`/api/games/catalog?achievements=1`), sempre forçando uma leitura nova.
4. O handler aplica **o mesmo critério do painel de conquistas do site** (`masteryUnlocked`):
   - entram as conquistas publicadas, ou seja, não ocultas e com título;
   - o mesmo título conta uma vez só (sem diferenciar maiúsculas e minúsculas, acentos ou espaços);
   - contam tanto as oficiais quanto as CUSTOM;
   - uma conquista conta como concluída se estiver `completed` ou tiver sido escolhida numa
     Jornada de Estreia concluída.
5. Se o jogo está em 100% agora e **não** estava antes desse desbloqueio, o agente grava um
   evento `mastery.achieved` com a chave `mastery:<slug>`. Cada jogo tem uma Maestria só.

O agente não decide sem dados, para evitar falsos positivos:

| Situação | O que acontece |
| --- | --- |
| Catálogo fora do ar | A verificação é adiada, sem gastar tentativa |
| Catálogo ainda sem o desbloqueio (cópia atrasada) | Nova tentativa, com backoff |
| Jogo fora do catálogo | Sem Maestria |
| Jogo sem conquistas elegíveis | Sem Maestria |
| Conquista oculta | Sem Maestria |
| Jogo que já estava em 100% (por exemplo, pela Jornada) | Sem Maestria |

### Sequência protegida (fila de alertas existente)

A Maestria usa a mesma fila de alertas, com estas regras:

- O alerta da Maestria tem tipo `mastery`, prioridade `PROTECTED_PRIORITY` (100), não expira e
  tem 5 tentativas.
- Ordem da sequência:
  1. a apresentação em curso termina normalmente;
  2. a conquista que completou o jogo aparece, se ainda estiver na fila;
  3. a Maestria aparece;
  4. a fila comum volta.
- O motor lê os eventos novos antes de cada apresentação. Assim, uma Maestria detectada durante
  um alerta disputa a próxima vaga e não espera a fila esvaziar.
- Enquanto a Maestria espera, mesmo em `retry_wait`, nenhum alerta comum é apresentado.
- Overlay fechado: a Maestria espera sem gastar tentativa e sem perder o prazo.
- A fila nunca fica presa: quando as tentativas da Maestria se esgotam, ela vai para `failed`
  e a fila destrava. Para apresentá-la de novo: `npm run agent -- alerts retry <id>`.
- O alerta só é concluído quando o overlay confirma o fim da apresentação.
- Se o agente cai no meio da apresentação, a Maestria volta para a fila na frente dos alertas
  comuns e é apresentada uma única vez.
- Uma Maestria de reconciliação, ou seja, que não foi percebida ao vivo, fica registrada como
  `expired`. Ela pode ser reapresentada com `alerts retry`.

### Apresentação no overlay

O overlay é a mesma Browser Source de antes, com uma apresentação própria para a Maestria:

- **Anúncio:** a palavra "MAESTRIA" em dourado, com um brilho.
- **Cartão:** mostra o nome do jogo, "100% das conquistas concluídas" e a contagem de
  conquistas (oficiais e CUSTOM).
  - Quando o site tem uma Maestria Final cadastrada, o cartão mostra o título dela, e também a
    arte, se ela estiver em https.
- **Duração:** anúncio de 2,6 s, permanência de pelo menos 9 s e saída de 1 s.
- **Teste:** a apresentação de teste traz o selo TESTE.
- **Para posicionar a fonte:** `http://127.0.0.1:47821/modules/overlay/?demo=mastery`.

### Dock

- **Linha "Alertas":** mostra "Apresentando Maestria", ou "Maestria na fila" quando a Maestria
  espera pela sequência ou pelo overlay.
- **Controles > Maestria > Testar apresentação:** dispara um teste e pede confirmação.

### Teste isolado

Há três formas de testar sem criar uma Maestria real:

- **`npm run agent -- mastery test [<slug>]`, ou o botão no dock:** grava um
  `mastery.achieved` de teste, com chave `test:…`, que passa pela fila protegida e pelo overlay
  com o selo TESTE.
  - Não envia nada ao site e não mexe em progresso.
  - Não ocupa a vaga da Maestria real do jogo e não entra nas contagens reais.
- **`npm run agent -- overlay test --mastery`:** testa só a parte visual, sem fila e sem dados.
- **`npm run agent -- mastery status`:** mostra as verificações e Maestrias recentes, com o
  resultado de cada uma.

### Limitações

- **Estado anterior à instalação:** a detecção só acontece a partir de desbloqueios
  sincronizados pelo agente. Jogos que chegaram a 100% antes da Fase 4.5, ou só por edição
  manual no site, não geram Maestria.
- **Rótulo de Maestria Final:** o agente considera Maestria qualquer jogo com 100% das
  conquistas elegíveis. No site, o rótulo "Maestria Final" só aparece em jogos que têm uma
  Maestria Final configurada.
- **Atraso do catálogo:** o catálogo público tem cache de 60 s no site, que é invalidado a cada
  gravação do agente. Se mesmo assim a cópia vier atrasada, a verificação tenta de novo, até 8
  vezes, e depois fica `failed`. Para refazer: `npm run agent -- retry <id>`.

## Fase 4.6: clips automáticos locais (módulo `clips`)

Os clips usam o **buffer de replay do OBS**, que guarda na memória os últimos N segundos do
que o OBS está produzindo. Assim existe o trecho de antes do evento sem gravar a live inteira.

### Fluxo

1. Um desbloqueio real percebido ao vivo, ou uma Maestria, vira um clip agendado para
   `evento + clipPostSeconds`. Esse agendamento fica na tabela `clips`, migração v6.
   - O agente lê os eventos por um cursor próprio.
   - Cada evento gera um clip só (deduplicação pela chave `clip:<id do evento>`).
   - Eventos de teste nunca viram clip real.
2. Na hora marcada, o agente:
   1. pede `SaveReplayBuffer` ao OBS;
   2. espera o arquivo novo aparecer (`GetLastReplayBufferReplay`) e parar de crescer;
   3. move o arquivo para a pasta de clips e grava ao lado uma ficha `.json` com o evento.
3. Uma Maestria que chega enquanto o clip da conquista que a disparou ainda está agendado não
   gera um segundo vídeo. Ela entra nesse mesmo clip, e o nome do arquivo ganha
   `conquista-maestria`.

O clip não depende dos alertas: ele tem a própria fila e o próprio ritmo. Um alerta parado,
falhando ou em apresentação não atrasa o clip, e um clip que falha não afeta alertas, Maestria
nem a sincronização.

### Pasta e nomes

- **Pasta padrão:** `<pasta de gravação do OBS>/Clips Rumo à Conquista`. Para mudar, use
  `clipsDir` ou `RUMO_AGENT_CLIPS_DIR`.
- **Nome do arquivo:** `<AAAA-MM>/<jogo>/<AAAA-MM-DD_HH-MM-SS>_<conquista|maestria|conquista-maestria>_<nome>_<id8>.<ext>`.
- **Clips de teste:** ficam em `testes/`.
- **Arquivos temporários:** o replay original do OBS é movido, não copiado, e não fica nada
  para trás. Se o destino falhar, o replay continua onde o OBS o salvou, e o erro informa o
  caminho.

### Configuração (`config.json`)

| Campo | Padrão | Efeito |
| --- | --- | --- |
| `clipsEnabled` | `true` | Liga ou desliga o módulo. Também aceita `RUMO_AGENT_CLIPS_ENABLED`. |
| `clipsDir` | (vazio) | Pasta dos clips. |
| `clipPreSeconds` | `240` | Trecho desejado antes do evento. |
| `clipPostSeconds` | `30` | Espera depois do evento antes de salvar. |
| `clipMinFreeMb` | `2048` | Espaço livre que precisa sobrar no destino. |

**Importante sobre a duração:** o OBS sempre salva o buffer inteiro, e o agente não corta o
vídeo, porque não há ffmpeg nem dependência nova. Por isso a janela real é a duração máxima do
buffer configurada no OBS, em Configurações > Saída > Buffer de replay:

- O vídeo cobre aproximadamente `buffer − clipPostSeconds` segundos antes do evento e
  `clipPostSeconds` segundos depois.
- Para ter 4 min antes e 30 s depois, o buffer precisa ter **270 s**, com memória máxima
  suficiente para a taxa de bits usada.
- Se o buffer for menor que `pre + post`, o dock mostra "Buffer curto".

### Falhas e recuperação

| Situação | Resultado |
| --- | --- |
| Buffer desabilitado ou desligado no momento do evento | `failed`, com a orientação. O agente não liga o buffer sozinho. |
| OBS desconectado, ou erro do OBS ao salvar | Nova tentativa a cada 10 s, enquanto o momento ainda está no buffer. Depois disso, `expired`: o agente nunca salva o vídeo de outro momento. |
| Destino inválido ou sem espaço | `failed`, e o replay fica preservado no caminho informado. |
| Agente cai depois de o OBS salvar | No reinício, o agente só termina a mudança de pasta, sem salvar de novo. |
| Agente cai antes de o OBS salvar | Nova tentativa, se o momento ainda estiver no buffer. Senão, `expired`. |

### Dock e CLI

- **Linha "Clips":** mostra um destes estados:
  - Buffer ativo (duração · pasta)
  - Buffer desligado
  - Buffer desabilitado
  - Buffer curto
  - N agendados
  - Salvando clip…
  - N com falha (com o erro)
- **Controles > Clips > Testar clip:** pede confirmação, salva um replay real em `testes/`, sem
  evento nem conquista, e não entra nas contagens reais.
- **`npm run agent -- clips [status|list|test]`:** mostra o estado do buffer e a pasta, lista os
  clips recentes ou faz o mesmo teste isolado.

### Limitações

- O vídeo sempre tem a duração do buffer do OBS, sem corte fino de início e fim.
- Clips só existem com o buffer de replay habilitado e ligado. Ligar o buffer é decisão do
  operador, porque ele consome memória e codificação contínua.
- Dois eventos muito próximos geram dois arquivos com trechos sobrepostos. Uma Maestria logo
  depois da conquista que a disparou é a exceção, porque vai no mesmo clip.

## Aplicativo de desktop (Parte A do plano de captura híbrida)

O plano completo está em [PLANO-CAPTURA-HIBRIDA.md](PLANO-CAPTURA-HIBRIDA.md). A Parte A transforma o
agente num programa instalável, sem mudar o que ele faz. O código fica em `desktop/`.

- **Casca Electron 45:** a casca roda **este agente como processo separado**, sem nenhuma mudança
  nele. O próprio executável do aplicativo faz o papel de Node (Node 24.22, com `node:sqlite` e
  TypeScript nativo), via `ELECTRON_RUN_AS_NODE`. Não há um `node.exe` extra.
  - **Supervisor:** se já existe um agente rodando, por exemplo iniciado pelo CLI, o aplicativo só se
    conecta e não assume o controle. Se o agente que o aplicativo iniciou cair, ele é reiniciado com
    espera crescente. Ao sair, o encerramento é limpo (`POST /shutdown`).
- **Bandeja:** o ícone muda de cor conforme o estado geral. O menu tem Abrir, Marcar momento,
  Configurações, Iniciar com o Windows, Abrir pasta de dados e Sair. Fechar a janela só a esconde.
- **Janela principal:** mostra o painel servido pelo agente (o dock em tamanho maior). Ela só navega no
  próprio agente.
- **Configurações:** uma janela à parte grava só os campos expostos (clips, tempos, duração do alerta,
  porta e atalho). A senha do OBS e o token do site nunca aparecem nela e são preservados. Se algo
  mudou, o agente é reiniciado.
- **Atalho global "Marcar momento":** o padrão é a tecla **Pause**, sozinha. Ele registra o instante e
  o jogo da sessão e pede o clip (módulo `moments`, migração v7). Toques repetidos em menos de 3 s são
  ignorados. A escolha da conquista é a Parte B. CLI: `npm run agent -- moments [list|mark]`.
  - **Qualquer tecla:** a tecla escolhida pode estar sozinha ou com Ctrl, Alt e Shift. Isso inclui
    Pause, PrintScreen, ScrollLock, Insert, Home, End, PageUp e PageDown, as setas, F1 a F24, letras,
    números e o teclado numérico. O Electron não aceita a Pause, por isso o registro é feito pelo
    próprio Windows (`RegisterHotKey`), num processo auxiliar do PowerShell (`desktop/src/hotkey.js`),
    sem dependência nova.
  - **Funcionamento:** o atalho funciona com o jogo em tela cheia. O auxiliar só recebe o aviso daquela
    combinação (não lê o que se digita) e encerra sozinho se o app fechar.
  - **Reserva da tecla:** a tecla fica reservada para o app, então um jogo que use a mesma tecla deixa
    de recebê-la.
  - **Para trocar:** **Bandeja > Trocar atalho de captura…**. Clique no campo e aperte a tecla. Os
    botões "Padrão (Pause)" e "Desativar" ficam ao lado.
  - **Tecla em uso:** se a tecla já estiver em uso por outro programa, o app avisa com uma notificação.
- **Instalador:** `cd desktop && npm run build` gera `desktop/dist/RumoAConquista-Setup-<versão>.exe`
  com o Inno Setup.
  - Instala só para o usuário, sem precisar de administrador.
  - Cria um atalho no menu Iniciar e, opcionalmente, um na área de trabalho e o início com o Windows.
  - Na desinstalação, fecha o aplicativo e o agente antes de remover os arquivos e retira a entrada de
    inicialização. Os dados em `%LOCALAPPDATA%\RumoAConquista\agent` são preservados.
- **Desenvolvimento:** `cd desktop && npm install && npm start`. Para testar sem tocar nos dados
  reais, defina `RUMO_AGENT_DATA_DIR` com uma pasta temporária.

## Revisão de momentos e checklist (Parte B)

**Onde abrir:** tela servida pelo agente em `/modules/moments/`. Ela abre por **Bandeja > Revisar
momentos**, pelo link "Revisar momentos (N)" no dock, ou direto no navegador.

- **Momentos:** cada momento marcado com o atalho aparece com horário, jogo, nota e o **clip para
  assistir** (o vídeo é servido pelo agente, com avanço e retrocesso, em `/modules/clips/video`). Para
  cada um:
  - **Escolher a conquista:** a lista mostra as conquistas **ainda pendentes** daquele jogo no site e
    tem uma **busca** que ignora acentos e procura no nome e na descrição. Se o momento não tem jogo
    identificado, você escolhe o jogo primeiro.
  - **Data:** "Data do momento" envia ao site o dia do atalho. "Sem data" conclui a conquista sem
    data.
  - **Confirmar ou descartar:** os dois pedem dois cliques. No descarte, dá para marcar **apagar o
    clip**.
- **Checklist:** para conquistas feitas sem momento marcado, como as acumulativas. Você escolhe o
  jogo, marca as conquistas (com busca) e escolhe "Data de hoje" ou "Sem data".
- **Garantias:**
  - Nada vai ao site sem a sua confirmação.
  - O desbloqueio usa o mesmo fluxo e a mesma deduplicação do desbloqueio manual. Confirmar duas
    vezes, ou pela revisão e pelo checklist, não duplica.
  - A revisão **não dispara alerta** na live: o desbloqueio vai como não percebido ao vivo.
  - As sugestões descontam o que o agente já registrou, mesmo antes de o site confirmar.
  - A ficha `.json` do clip recebe a conquista escolhida.
- **API:**
  - `GET /modules/moments/review` e `GET /modules/moments/achievements?slug=`;
  - `POST /modules/moments/resolve`, `/discard` e `/checklist`: sem token, só da própria origem, como
    os controles do dock;
  - migração v8 com os resultados da revisão.

## Como as próximas fases se encaixam

Cada novo módulo implementa `AgentModule` e entra na lista em `modules/index.ts`. Um módulo
produz eventos com `ctx.events.record({ type, payload, dedupeKey })`, usando a chave natural
do fato (por exemplo `achievement:steam:<appid>:<apiname>`), e os consome com
`ctx.events.handle(type, handler)`. Toda chamada externa (site, OBS) acontece dentro do
handler, ou seja, depois de o evento estar persistido. O handler lança:

- `DeferEventError` quando uma dependência está fora do ar: o evento é reagendado sem gastar tentativa.
- `PermanentEventError` quando o problema é nos dados: o evento vai para failed.
- qualquer outro erro: nova tentativa com backoff.

Eventos de teste (`isTest`) passam pelo mesmo mecanismo. Os módulos de progresso, Maestria e
clips devem ignorá-los na contabilização real.
