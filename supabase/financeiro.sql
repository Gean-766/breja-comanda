-- ============================================================================
--  REFINO FINANCEIRO — forma de pagamento na comanda
--  Roda no Supabase → SQL Editor → Run. Aditivo e seguro.
--
--  Guarda COMO a comanda foi paga (dinheiro/pix/cartao) na hora de fechar.
--  Com isso o Relatório mostra "recebido por forma" e "em aberto".
--  Comandas fechadas antes disso ficam com forma nula = aparecem como "Outro".
-- ============================================================================

alter table public.clientes
  add column if not exists forma_pagamento text;

-- ajuda a somar "recebido no período" rápido
create index if not exists idx_clientes_pago on public.clientes(pago_em);
