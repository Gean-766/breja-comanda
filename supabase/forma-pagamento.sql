-- ============================================================================
--  FORMA DE PAGAMENTO — dinheiro | pix | crédito | débito
--  Roda no Supabase → SQL Editor → New query → cola → Run.
--  É ADITIVO e seguro: só cria colunas novas, não toca em dado nenhum.
--
--  Pra quê: o dono quer comparar quanto entrou por cada forma e conferir a
--  gaveta no fim do dia. O app guarda a forma em DOIS lugares, porque o
--  dinheiro entra em dois momentos diferentes:
--
--    clientes.forma_pagamento      → como a comanda foi fechada (e a venda
--                                    rápida de balcão, que já nasce fechada)
--    pagamentos_parciais.forma     → como CADA parte da conta dividida foi
--                                    paga: um amigo no pix, outro em dinheiro
--
--  Sem a segunda, uma mesa dividida jogaria tudo na forma de quem fechou por
--  último e a gaveta não bateria.
--
--  Até rodar isto, o app continua funcionando: ele tenta gravar com a forma e,
--  se a coluna não existir, grava sem — ninguém fica sem vender.
-- ============================================================================

-- 1) Como a comanda/venda foi paga (já criada pelo financeiro.sql; fica aqui
--    pra quem ainda não rodou aquele arquivo)
alter table public.clientes
  add column if not exists forma_pagamento text;

-- ajuda a somar "recebido no período" rápido
create index if not exists idx_clientes_pago on public.clientes(pago_em);

-- 2) Como cada parte da conta dividida foi paga
alter table public.pagamentos_parciais
  add column if not exists forma text;

-- ####  FIM  ####
-- Confere:
--   select forma_pagamento, count(*), sum(0) from public.clientes
--    where pago_em is not null group by forma_pagamento;
--   select forma, count(*), sum(valor) from public.pagamentos_parciais
--    group by forma;
