-- Plataforma pertence ao jogo (GAMES).
-- Jogos antigos sem plataforma cadastrada passam a usar Steam como fallback na aplicação.
alter table public.games
  add column if not exists platform text;

update public.games
set platform = 'Steam'
where platform is null or btrim(platform) = '';
