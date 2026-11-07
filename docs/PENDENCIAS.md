# Pendências registradas — auditoria de 07/11/2026

Itens encontrados na auditoria de segurança, celular e otimização que **não** foram alterados
de propósito, porque dependem de arte nova, de decisão do proprietário ou de mudança no banco.

## 1. Artes e imagens ausentes

Os dados apontam para estes arquivos, que não existem em `public/`. As telas já mostram um
substituto (ícone ou troféu), então nada aparece quebrado, mas o navegador recebe 404.

| Origem | Caminho esperado |
|---|---|
| Hollow Knight (Maestria Final) | `/images/games/hollow-knight/achievements/maestria-final.png` |
| Song of Nunu (Maestria Final) | `/images/games/song-of-nunu/achievements/maestria-final.png` |
| Hades (Maestria Final) | `/images/games/hades/achievements/maestria-final.png` |
| The Surge (Maestria Final) | `/images/games/the-surge/achievements/maestria-final.png` |
| Monster Hunter: World - Iceborne | `/images/games/monster-hunter-world-iceborne/achievements/finalizar-todas-as-missoes-secundarias.png` |
| Monster Hunter: World - Iceborne | `/images/games/monster-hunter-world-iceborne/achievements/equipe-seu-primeiro-pingente-dlc-iceborne.png` |
| Saga padrão Monster Hunter (`data/sagas.ts`) | `/images/sagas/monster-hunter/cover.jpg` e `badge.jpg` |
| Saga padrão Resident Evil (`data/sagas.ts`) | `/images/sagas/resident-evil/cover.jpg` e `badge.jpg` |
| Saga padrão Souls (`data/sagas.ts`) | `/images/sagas/souls/cover.jpg` e `badge.jpg` |
| Saga padrão Wizarding World (`data/sagas.ts`) | `/images/sagas/wizarding-world/cover.jpg` e `badge.jpg` |

Além disso, quando um jogo não tem imagem própria de Maestria, o site procura a arte padrão
`/images/games/<jogo>/achievements/maestria-final.png`. Ela não existe para: `hades`, `hades-2`,
`hollow-knight`, `hollow-knight-silksong`, `metro-2033-redux`, `metro-exodus`, `metro-last-light`,
`monster-hunter-world-iceborne`, `song-of-nunu`, `the-surge`, `tom-clancy-s-the-division` e
`tom-clancy-s-the-division-2`.

Ao criar uma arte, salve no caminho exato acima. Os testes de responsividade aceitam esses 404
enquanto as artes não existem (`tests/e2e/responsive.spec.ts`, `KNOWN_MISSING_*`); remova a
exceção quando o arquivo for adicionado.

## 2. RLS e privilégios do Supabase

Não há acesso SQL direto a partir do projeto, e a chave pública não consegue ler o catálogo do
Postgres. A verificação feita com a chave pública (somente leitura) mostrou:

- `games`: 10 jogos visíveis, nenhum oculto ou excluído exposto.
- `site_banner_settings`: nenhuma linha visível para a chave pública (indica RLS sem leitura pública).
- `achievements`, `achievement_progress`, `journey_entries`: leitura pública, como esperado.

**Falta confirmar** se a chave pública consegue **gravar** em `games`, `journey_entries` e
`site_banner_settings`. Rode `supabase/tests/rls_audit_readonly.sql` no SQL Editor do Supabase
(somente `select`) e confira: RLS ativo em todas as tabelas e nenhum `INSERT/UPDATE/DELETE`
concedido a `anon` sem política restritiva.

## 3. Vercel Firewall

Criada em 07/11/2026 a regra **"Limite de tentativas no login do Admin"**
(`rule_limite_de_tentativas_no_login_do_admin_UtwCyw`): `POST /api/admin/auth/login`, 10 por
minuto por IP, janela fixa, resposta 429. Sem bloqueio persistente. Testada: tentativas 1–10
recusadas com 401, 11ª e 12ª com 429. O plano Hobby permite apenas uma regra de limite por projeto.

## 4. ESLint (49 erros, 171 avisos)

| Regra | Quantidade | Observação |
|---|---|---|
| `react-hooks/set-state-in-effect` (erro) | 40 | Padrão de carregamento usado em 23 telas; exige refatoração por tela |
| `@typescript-eslint/no-explicit-any` (erro) | 3 | Um arquivo |
| `react-hooks/preserve-manual-memoization` (erro) | 3 | Um arquivo |
| `react-hooks/rules-of-hooks` (erro) | 2 | Revisar com cuidado: pode indicar bug real |
| `react-hooks/immutability` (erro) | 1 | Um arquivo |
| `@next/next/no-img-element` (aviso) | 88 | Imagens já usam cópias leves; trocar por `next/image` é decisão de custo |
| `@typescript-eslint/no-unused-vars` (aviso) | 63 | Código morto; remoção segura, mas extensa |
| `react-hooks/exhaustive-deps` (aviso) | 20 | Revisar caso a caso |

Os 7 erros `react/jsx-key` foram corrigidos nesta etapa.

## 5. Outros riscos residuais

- O logout não revoga um token já emitido (sessão sem estado, 7 dias). Para encerrar todas as
  sessões, troque `ADMIN_SESSION_SECRET` na Vercel.
- `GET /api/admin/games/genres` (público) e `GET /api/admin/games` podem gravar correções
  automáticas no banco; junto com `GET /api/games/data`, ficaram reservados para uma etapa própria.
- O Perfil ainda tenta a rota do Admin antes do catálogo público (um 401 no console do visitante).
- Credenciais da Twitch ausentes na Vercel: a detecção de live da Twitch continua inativa.
- 8 avisos moderados só nas ferramentas de lint (dependências de desenvolvimento).
