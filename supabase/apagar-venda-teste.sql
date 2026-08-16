-- ============================================================================
--  APAGAR UMA VENDA RÁPIDA DE TESTE
--  Roda no Supabase → SQL Editor. Uma consulta por vez, na ordem.
--
--  ⚠️ ESTE É O ÚNICO ARQUIVO DA PASTA QUE APAGA COISA. Todos os outros só
--     criam. Leia antes de rodar.
--
--  ANTES DE USAR: o app já faz isso sozinho, com um toque e sem risco —
--    Histórico → ⚡ Vendas rápidas → ↩ Desfazer
--  Use este arquivo só quando a venda já saiu das 24h do Histórico, ou quando
--  o app não estiver à mão.
--
--  O QUE ACONTECE AO APAGAR
--  ------------------------
--  A venda de balcão é uma comanda já fechada chamada "Balcão 19:42". Apagar
--  essa linha leva junto, POR CASCATA, os itens vendidos (`consumos`). Ou seja:
--    • o faturamento e o "recebido" daquela noite descem;
--    • as unidades VOLTAM pro estoque, como se nunca tivessem saído.
--  É por isso que serve pra venda de teste — e é por isso que NÃO serve pra
--  venda de verdade: dinheiro que entrou na gaveta sumiria do relatório.
--
--  TRAVAS: o passo 3 se recusa a rodar se o id não existir, se não for uma
--  venda de balcão, ou se tiver pagamento parcial pendurado nela.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1) ACHAR a venda. Mostra as vendas rápidas das últimas 12 horas, da mais
--    nova pra mais velha, com o que foi vendido em cada uma.
--    Copie o `id` da linha que você quer apagar.
-- ----------------------------------------------------------------------------
select c.id,
       d.nome                                   as loja,
       c.nome                                   as venda,
       c.pago_em,
       c.forma_pagamento,
       coalesce(sum(co.preco_unit * co.quantidade), 0) as total,
       coalesce(sum(co.quantidade), 0)                 as unidades,
       string_agg(co.quantidade || 'x ' || co.beer_nome, ', ') as itens
  from public.clientes c
  left join public.consumos co       on co.cliente_id = c.id
  left join public.distribuidoras d  on d.id = c.distribuidora_id
 where c.nome like 'Balcão %'
   and c.created_at > now() - interval '12 hours'
 group by c.id, d.nome, c.nome, c.pago_em, c.forma_pagamento
 order by c.pago_em desc nulls last;


-- ----------------------------------------------------------------------------
-- 2) CONFERIR antes de apagar. Cole o id no lugar do texto e rode: isto mostra
--    exatamente o que vai sumir e o que volta pro estoque. NÃO apaga nada.
-- ----------------------------------------------------------------------------
select co.beer_nome                as produto,
       co.quantidade               as volta_pro_estoque,
       co.preco_unit,
       co.preco_unit * co.quantidade as sai_do_faturamento,
       co.created_at
  from public.consumos co
 where co.cliente_id = 'COLE-O-ID-AQUI'::uuid
 order by co.created_at;


-- ----------------------------------------------------------------------------
-- 3) APAGAR. Cole o MESMO id na primeira linha e rode.
--    Se qualquer trava disparar, nada é apagado (o bloco inteiro volta atrás).
-- ----------------------------------------------------------------------------
do $$
declare
  alvo       uuid := 'COLE-O-ID-AQUI';
  r          record;
  n_itens    int;
  n_unidades int;
  v_total    numeric;
  n_parciais int;
begin
  select * into r from public.clientes where id = alvo;
  if not found then
    raise exception 'Nao achei comanda com esse id. Rode a consulta 1 de novo.';
  end if;

  -- trava 1: só venda de balcão. Comanda com nome de gente sai pelo app, que
  -- sabe conferir se já entrou dinheiro nela.
  if r.nome not like 'Balcão %' then
    raise exception 'Isto nao e uma venda rapida (nome: "%"). Este script so apaga venda de balcao.', r.nome;
  end if;

  -- trava 2: dinheiro já recebido em partes sumiria do caixa sem deixar rastro
  select count(*) into n_parciais
    from public.pagamentos_parciais where cliente_id = alvo;
  if n_parciais > 0 then
    raise exception 'Essa venda tem % pagamento(s) parcial(is) e nao vai ser apagada: o dinheiro sumiria do caixa.', n_parciais;
  end if;

  select count(*), coalesce(sum(quantidade), 0), coalesce(sum(preco_unit * quantidade), 0)
    into n_itens, n_unidades, v_total
    from public.consumos where cliente_id = alvo;

  -- os `consumos` caem por cascata junto com a comanda
  delete from public.clientes where id = alvo;

  -- deixa o Histórico coerente: a linha da venda fica marcada como desfeita,
  -- do mesmo jeito que o "↩ Desfazer" do app faria
  update public.historico
     set revertido = true
   where tipo = 'venda_balcao'
     and payload->'cliente'->>'id' = alvo::text;

  raise notice 'APAGADO: "%" — % item(ns), % unidade(s), R$ %.', r.nome, n_itens, n_unidades, v_total;
  raise notice 'O estoque voltou e o relatorio parou de contar essa venda.';
end $$;


-- ####  FIM  ####
-- Confere (a venda nao pode mais aparecer):
--   select id, nome, pago_em from public.clientes
--    where nome like 'Balcão %' order by pago_em desc limit 10;
