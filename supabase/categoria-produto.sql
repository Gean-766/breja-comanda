-- ============================================================================
--  PASTA DO PRODUTO (categoria escolhida pelo lojista)
--  Roda no Supabase → SQL Editor → Run. Aditivo e seguro.
--
--  Guarda em qual pasta o produto foi colocado (ex: "Cerveja", "Doses").
--  Quem não tiver pasta escolhida cai na categoria adivinhada pelo nome.
-- ============================================================================

alter table public.cervejas
  add column if not exists categoria text;
