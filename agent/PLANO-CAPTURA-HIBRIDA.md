# Plano — Aplicativo Rumo à Conquista e captura híbrida de conquistas

Status: **planejamento para aprovação**. Nada aqui está implementado.

## 1. Por que este plano existe

A investigação sobre captura local de conquistas mostrou o seguinte:

- **A Steam não descobre conquistas sozinha.** O próprio jogo avisa, pela API, quando uma conquista é
  desbloqueada. Fora do jogo, só dá para saber de uma conquista por três caminhos:
  1. o rastro desse aviso (cache da Steam ou arquivo do emulador);
  2. o save, quando é legível e documentado;
  3. o jogador.
- **A captura automática funciona em parte dos jogos:**
  - **Versão oficial da Steam:** o cache local já é lido pelo agente (Fase 3).
  - **Emuladores CODEX e RUNE:** gravam o desbloqueio com horário quando o jogo avisa. No
    NieR:Automata, o arquivo foi gravado no mesmo segundo da conquista.
  - **Exceções:** alguns jogos não deixam rastro. No Monster Hunter World, o arquivo do emulador
    nunca recebeu nada, e o save é criptografado.
- **A captura 100% automática em todos os jogos não existe por meios legítimos.**

Decisão tomada: **captura híbrida**.

| Situação | Caminho |
| --- | --- |
| Versão oficial ou emulador que grava | **Automático**: data, hora, alerta e clip |
| Momento percebido (boss, fase) | **Atalho "Marcar momento"** na live, escolha da conquista depois |
| Acumulativa, acidental ou que passou batido | **Revisão**: você conta o que fez, o sistema sugere e você confirma, sem data ou com data aproximada |
| Conquista online em versão não oficial | Escondida da sessão e fora da Maestria |

## 2. Princípios

1. **Você confirma.** O sistema sugere, mas não libera conquista por dedução. Só o automático
   (oficial ou emulador) libera sozinho.
2. **Nada sai do PC sem decisão explícita.** Clips continuam locais. A IA, se for usada, recebe só texto.
3. **Só leitura dos jogos.** Nada de alterar saves, emuladores ou arquivos dos jogos, nem de usar
   injeção, hooking ou contorno de proteção.
4. **Por partes.** Cada parte é entregue, testada numa live real e aprovada antes da próxima.
5. **Reaproveitar.** O motor atual continua: agente, site, overlay, Maestria e clips.

## 3. Partes

### Parte A — O aplicativo (instalador, janela e atalho)

**Objetivo:** transformar o agente num programa instalável, sem mudar o que ele faz.

- **Instalador `.exe`:** "Avançar, Avançar, Concluir", iniciando com o Windows (opcional).
- **Ícone na bandeja:** com estado geral (verde, amarelo, vermelho), "Abrir", "Marcar momento" e "Sair".
- **Janela principal, "Central Rumo à Conquista":** mostra o estado de jogo, sessão, OBS, site,
  alertas e clips. É o dock atual em tamanho grande, com espaço para as Partes B a E.
- **Configurações na janela:** pasta dos clips, tempos e porta, sem editar `config.json`.
- **Atalho global "Marcar momento":** funciona com o jogo em tela cheia, e você escolhe a tecla. Nesta
  parte ele só registra o momento. A revisão é a Parte B.
- **Dock no OBS:** continua como resumo compacto. O overlay não muda.

**Decisão técnica a validar no início, com um teste curto:** como empacotar.

- **Opção 1 (recomendada para testar primeiro):** uma casca de desktop (Electron) que roda o agente
  atual como processo separado, com o runtime Node incluído. Muda o mínimo no agente.
- **Opção 2:** o agente dentro do Electron. Exige confirmar a compatibilidade do SQLite nativo
  (`node:sqlite`) com o Node do Electron.

**Pronto quando:**
- instala e desinstala sem deixar lixo;
- abre a janela pela bandeja;
- o atalho funciona com um jogo em tela cheia;
- o agente reinicia sozinho se cair;
- os dados atuais (banco, configuração e token) são preservados.

### Parte B — Momentos, revisão e checklist

**Objetivo:** cobrir os jogos sem captura automática sem atrapalhar a live.

- **Momento:** o atalho grava horário, jogo da sessão e clip. O clip reaproveita a Fase 4.6, com o
  buffer de replay e os minutos anteriores.
  - Os momentos ficam numa fila persistente, que sobrevive a reinícios.
  - Opcional: um aviso discreto no overlay ("Momento marcado!").
- **Revisão:** depois da live ou quando você quiser, numa tela que lista os momentos da sessão. Para
  cada momento:
  - assistir ao clip;
  - escolher a conquista entre as sugestões, que são as pendentes daquele jogo;
  - ou buscar outra;
  - ou descartar.
  - Ao confirmar, a conquista sobe para o site **com a data do momento**, a Maestria é verificada e o
    clip fica ligado à conquista.
- **Checklist do fim da sessão:** as conquistas pendentes do jogo, para marcar as que você concluiu
  sem saber o instante. Entram com a data da sessão.
- **Conquista sem data:** opção "sem data" para o que você só lembra que fez ("terminei a história").
  O envio ao site já aceita conclusão sem data desde a Fase 3.
- **Alerta:** ao confirmar depois da live, o alerta é opcional (padrão: não mostrar). Na hora, só se
  você confirmar durante a live.

**Pronto quando:** numa live real, os momentos marcados viram conquistas corretas no site, com a data
certa e o clip ligado, e nada é liberado sem a sua confirmação.

### Parte C — Provedor de emuladores (captura automática fora da Steam)

**Objetivo:** fazer automaticamente nos jogos fora da Steam o que o agente já faz com o cache da Steam.

- **Leitura:** em modo somente leitura, das pastas `Public\Documents\Steam\CODEX\<appid>` e
  `…\RUNE\<appid>` (`achievements.ini`, com `Achieved` e `UnlockTime`).
- **Fluxo:** é o mesmo dos desbloqueios automáticos. Linha de base na primeira leitura, para que o
  histórico antigo não dispare alertas. Cada desbloqueio novo vira evento, depois envio ao site, alerta
  e clip.
- **Ligação com o site:** os códigos do emulador são os nomes oficiais da API do jogo (por exemplo
  `ACHIEVEMENT_021`). Eles casam com o vínculo que o site já usa para a Steam (`source`/`external_id`).
  Onde o vínculo faltar, o desbloqueio aparece como pendente de associação, como hoje.
- **Associação:** o `AppId` do jogo é lido do arquivo de configuração do emulador na pasta do jogo, e
  só lido.
- **Cadastro do jogo pelo usuário (requisito pedido):** na janela do aplicativo, você informa o **`.exe`
  do jogo** e a **pasta de instalação**. O programa então:
  1. lê a pasta, só lendo, e **identifica o emulador**: CODEX, RUNE ou outro conhecido, ou "versão
     oficial da Steam", ou "nenhum detectado";
  2. descobre o `AppId` e onde o emulador grava as conquistas;
  3. mostra se a **captura automática fica ativada** (emulador que grava, com o arquivo encontrado) ou
     **desativada** (sem emulador conhecido, ou jogo que não grava, como o MHW), com a opção de você
     ligar ou desligar manualmente por jogo;
  4. reaproveita o mesmo `.exe` para o reconhecimento do jogo da sessão, que já existe nas Fases 2 e 4.4.
- O cadastro **não altera nada** na pasta do jogo nem no emulador.

**Pré-requisito:** confirmar ao vivo, em um jogo que você vai jogar de qualquer forma (The Surge ou
Hollow Knight), que o arquivo é gravado no momento do desbloqueio.

**Pronto quando:** um desbloqueio real num jogo com emulador aparece no site, no overlay e no clip sem
ação sua, e jogos que não gravam (como o MHW) não geram nada falso.

### Parte D — Sessão: jogo, versão, conquistas online e modo sem spoiler

**Objetivo:** preparar a live e evitar ruído e spoiler.

- **Antes da live, na janela:** "Vou jogar: [jogo] · versão: oficial / não oficial". A versão define o
  modo de captura e o filtro de conquistas online.
- **Marcação "online" nas conquistas do site.** Exige **mudança no site**: campo novo, tela de edição e
  deploy.
  - O sistema sugere quais são online pela descrição ("multijogador", "cooperativo", "online"), e você
    confirma uma vez por jogo.
  - Na versão não oficial, as conquistas online ficam fora das sugestões e da Maestria.
  - Alternativa sem mudar o site: marcar as online como **ocultas** (funciona hoje). A diferença é que
    elas somem do site para todo mundo.
- **Modo sem spoiler no overlay:** o alerta sai sem imagem e sem descrição, e o nome fica escondido nas
  conquistas secretas (o schema da Steam já marca `hidden`). Pode ser ligado por jogo ou de forma
  global.

**Pronto quando:** a sessão configurada filtra as sugestões e a Maestria, e o alerta sem spoiler não
revela nada além de "conquista desbloqueada".

### Parte E — Revisão assistida por IA (opcional)

**Objetivo:** reduzir o trabalho da revisão.

- **Como funciona:** você conta o que fez, digitando primeiro e por voz numa etapa futura. O sistema
  compara com as conquistas pendentes e sugere, com grau de certeza: "a conquista X (alta)",
  "a Y (média)". Você confirma.
- **O que sai do PC:** só o seu texto e a lista de conquistas do jogo. **Nenhum vídeo nem imagem.**
- **Antes de liberar o uso,** um teste com algumas sessões reais, comparando a sugestão com o que você
  escolheria.

**Pronto quando:** em sessões reais, a sugestão certa aparece entre as primeiras na grande maioria das
vezes, e nada é liberado sem confirmação.

## 4. Ordem e dependências

```
A (aplicativo) ──▶ B (momentos e revisão) ──▶ D (sessão, online, spoiler) ──▶ E (IA, opcional)
                └─▶ C (emuladores) — depois do teste ao vivo num jogo
```

- **A vem primeiro:** é a base da janela e do atalho.
- **B entrega o maior ganho:** cobre todos os jogos.
- **C pode andar em paralelo a B**, assim que o teste ao vivo confirmar o comportamento do emulador.
- **D depende de uma mudança no site,** que você decide se quer.
- **E fica por último e é opcional.**

## 5. Decisões que ficam com você

1. **Empacotamento (Parte A):** Electron com o agente como processo separado (recomendado) ou
   integrado. Decidido depois do teste curto.
2. **Conquistas online (Parte D):** campo novo no site (com deploy) ou usar "oculta" (sem mudar o site).
3. **Alerta na revisão (Parte B):** padrão sem alerta ao confirmar depois da live?
4. **IA (Parte E):** usar ou não, e se a fala vira texto localmente (dependência nova) ou se você
   digita.
5. **Fase 4.7 original:** continua pausada. Este plano entra antes dela ou a substitui?

## 6. O que este plano não faz

- Não descobre conquistas em jogos sem rastro sem a sua confirmação.
- Não lê saves criptografados, não altera emuladores e não intercepta o jogo.
- Não envia vídeos para fora do PC.
- Não publica nada automaticamente em redes ou plataformas.
