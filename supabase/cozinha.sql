-- ============================================================================
--  MÓDULO COZINHA (v1)
--  Roda no Supabase → SQL Editor → Run. Aditivo e seguro.
--
--  vai_cozinha  = esse produto é preparado na cozinha (espetinho, porção).
--                 Cerveja/refri ficam false e nunca entram na fila.
--  pronto_em    = quando o cozinheiro marcou o item como pronto (null = na fila).
--  Sem mudança de RLS: as policies de tenant de cervejas/consumos já cobrem.
-- ============================================================================

alter table public.cervejas
  add column if not exists vai_cozinha boolean not null default false;

alter table public.consumos
  add column if not exists pronto_em timestamptz;
