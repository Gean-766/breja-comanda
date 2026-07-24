-- ============================================================================
--  MODO DA COMANDA — por pessoa (nome) ou por mesa (número)
--  Roda no Supabase → SQL Editor → Run. Aditivo e seguro.
--
--  'pessoa' (padrão) = a comanda é aberta com o NOME de quem consome (Alex).
--  'mesa'            = a comanda é aberta pelo NÚMERO da mesa (Mesa 3).
--  Não muda o modelo de dados: continua tudo em clientes.nome; só troca o
--  texto/placeholder no app conforme o tipo de comércio.
-- ============================================================================

alter table public.distribuidoras
  add column if not exists modo_comanda text not null default 'pessoa';
