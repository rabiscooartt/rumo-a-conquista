alter table public.games
  add column if not exists genres text[];

comment on column public.games.genres is
  'Gêneros do jogo identificados automaticamente por IGDB ou Steam Store.';
