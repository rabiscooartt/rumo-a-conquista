-- Armazena a review junto ao jogo sem alterar ou recriar registros existentes.
-- A aplicacao continua aceitando jogos sem review (valor null).
alter table public.games
  add column if not exists review jsonb;

