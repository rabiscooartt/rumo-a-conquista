# Backup lógico — sistema de conquistas (pré-Supabase)

Data do registro: 2026-07-21.

Este documento preserva a estrutura e o fluxo existentes antes da primeira etapa
da migração. Nenhum dos mecanismos abaixo deve ser removido nesta etapa.

## Fonte base

- `data/games.ts` exporta o catálogo estático `games`.
- Cada jogo possui `achievementsList`, com `id`, `title`, `description`,
  `trophy`/`icon`, `difficulty`/`rank`, `status`, `earnedDate`, `image`,
  `isCustom` e `isHidden` quando aplicáveis.

## Persistência local por jogo

- `rumo-a-conquista-achievements-${slug}`: mapa indexado pelo título com
  `rank`, `status`, `date` e `image`.
- `rumo-a-conquista-custom-achievements-${slug}`: conquistas adicionadas no
  navegador.
- `rumo-a-conquista-hidden-achievements-${slug}`: títulos ocultados.

## Fluxo atual

1. `lib/useSiteGames.ts` combina `data/games.ts` com os dados de jogos e
   estados locais.
2. `components/GameAchievementsPanel.tsx` lê e escreve as três chaves acima.
3. `app/admin/jogos/page.tsx` edita `achievementsList` e também mantém as
   chaves locais consistentes quando uma conquista é removida.
4. Eventos de janela `rumo-a-conquista-achievements-updated` e
   `rumo-a-conquista-games-updated` avisam os demais componentes.

## Compatibilidade exigida nesta etapa

- `data/games.ts` permanece inalterado e é a definição-base.
- `localStorage` continua sendo fallback e espelho de segurança.
- O layout e as interfaces públicas existentes não são alterados.
- `proxy.ts` e seu Basic Auth permanecem inalterados.
