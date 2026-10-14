-- ============================================================================
--  PRODUTO FIXO NO TOPO DA COMANDA (ficha de sinuca)
--  Roda no Supabase → SQL Editor → Run. Aditivo e seguro.
--
--  Nasceu do Snooker Bar (andar de cima do Bola 7): a ficha de sinuca sai toda
--  hora, e achar ela na pasta a cada rodada atrasava o garçom.
--
--  fixo_topo = o produto aparece numa faixa no topo de TODA comanda, com
--              contador: toca N vezes, "Lançar N", pronto.
--              Quem marca é o próprio bar, no 📌 da aba Produtos.
--  Sem mudança de RLS: as policies de tenant de cervejas já cobrem.
-- ============================================================================

alter table public.cervejas
  add column if not exists fixo_topo boolean not null default false;
