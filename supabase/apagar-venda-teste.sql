-- ============================================================================
--  APAGAR UMA VENDA RÁPIDA DE TESTE
--  Roda no Supabase → SQL Editor → cola TUDO → Run. Pode rodar inteiro.
--
--  ⚠️ ESTE É O ÚNICO ARQUIVO DA PASTA QUE APAGA COISA. Todos os outros só
--     criam. Leia antes de rodar.
--
--  ANTES DE USAR: o app já faz isso sozinho, com um toque e sem risco —
--    Histórico → ⚡ Vendas rápidas → ↩ Desfazer
--  Use este arquivo só quando a venda já saiu das 24h do Histórico.
--
--  O QUE ACONTECE AO APAGAR
--  ------------------------
--  A venda de balcão é uma comanda já fechada chamada "Balcão 19:42". Apagar
--  essa linha leva junto, POR CASCATA, os itens vendidos (`consumos`). Ou seja:
--    • o faturamento e o "recebido" daquela noite descem;
--    • as unidades VOLTAM pro estoque, como se nunca tivessem saído.
--  É por isso que serve pra venda de teste — e é por isso que NÃO serve pra
--  venda de verdade: dinheiro que entrou na gaveta sumiria do relatório.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1) VER as vendas rápidas das últimas 12 horas. Só leitura, não apaga nada.
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
-- 2) APAGAR. Não precisa editar nada: se existir UMA só venda rápida nas
--    últimas 12 horas, ela é apagada. Se existir mais de uma, ele NÃO adivinha
--    — lista todas e para, e aí você usa o bloco 3.
--
--    Olhe a aba "Messages"/"Notices" do resultado: é lá que ele conta o que fez.
-- ----------------------------------------------------------------------------
do $$
declare
  alvo       uuid;
  r          record;
  linha      record;
  n_achadas  int;
  n_itens    int;
  n_unidades int;
  v_total    numeric;
  n_parciais int;
begin
  select count(*) into n_achadas
    from public.clientes
   where nome like 'Balcão %'
     and created_at > now() - interval '12 hours';

  if n_achadas = 0 then
    raise notice 'Nenhuma venda rapida nas ultimas 12 horas. Nada a apagar.';
    return;
  end if;

  if n_achadas > 1 then
    raise notice 'Achei % vendas rapidas nas ultimas 12h. Nao vou adivinhar qual apagar:', n_achadas;
    for linha in
      select c.id, d.nome as loja, c.nome as venda,
             coalesce(sum(co.preco_unit * co.quantidade), 0) as total,
             string_agg(co.quantidade || 'x ' || co.beer_nome, ', ') as itens
        from public.clientes c
        left join public.consumos co      on co.cliente_id = c.id
        left join public.distribuidoras d on d.id = c.distribuidora_id
       where c.nome like 'Balcão %'
         and c.created_at > now() - interval '12 hours'
       group by c.id, d.nome, c.nome, c.pago_em
       order by c.pago_em desc
    loop
      raise notice '  % | % | % | R$ % | %', linha.id, linha.loja, linha.venda, linha.total, linha.itens;
    end loop;
    raise notice 'Copie o id da certa e use o BLOCO 3 aqui embaixo.';
    return;
  end if;

  select * into r
    from public.clientes
   where nome like 'Balcão %'
     and created_at > now() - interval '12 hours';
  alvo := r.id;

  -- trava: dinheiro recebido em partes sumiria do caixa sem deixar rastro
  select count(*) into n_parciais
    from public.pagamentos_parciais where cliente_id = alvo;
  if n_parciais > 0 then
    raise exception 'Essa venda tem % pagamento(s) parcial(is) e nao vai ser apagada.', n_parciais;
  end if;

  select count(*), coalesce(sum(quantidade), 0), coalesce(sum(preco_unit * quantidade), 0)
    into n_itens, n_unidades, v_total
    from public.consumos where cliente_id = alvo;

  delete from public.clientes where id = alvo;   -- os consumos caem por cascata

  -- deixa o Histórico coerente, igual o "↩ Desfazer" do app faria
  update public.historico
     set revertido = true
   where tipo = 'venda_balcao'
     and payload->'cliente'->>'id' = alvo::text;

  raise notice 'APAGADO: "%" — % item(ns), % unidade(s), R$ %.', r.nome, n_itens, n_unidades, v_total;
  raise notice 'O estoque voltou e o relatorio parou de contar essa venda.';
end $$;


-- ----------------------------------------------------------------------------
-- 3) APAGAR POR ID — só quando o bloco 2 achou mais de uma venda.
--    Está comentado de propósito: assim o arquivo inteiro roda sem dar erro.
--    Pra usar: tire o /* e o */, e troque o id na primeira linha.
-- ----------------------------------------------------------------------------
/*
do $$
declare
  alvo       uuid := '00000000-0000-0000-0000-000000000000';  -- <<< COLE O ID AQUI
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

  -- trava: só venda de balcão. Comanda com nome de gente sai pelo app, que
  -- sabe conferir se já entrou dinheiro nela.
  if r.nome not like 'Balcão %' then
    raise exception 'Isto nao e uma venda rapida (nome: "%").', r.nome;
  end if;

  select count(*) into n_parciais
    from public.pagamentos_parciais where cliente_id = alvo;
  if n_parciais > 0 then
    raise exception 'Essa venda tem % pagamento(s) parcial(is) e nao vai ser apagada.', n_parciais;
  end if;

  select count(*), coalesce(sum(quantidade), 0), coalesce(sum(preco_unit * quantidade), 0)
    into n_itens, n_unidades, v_total
    from public.consumos where cliente_id = alvo;

  delete from public.clientes where id = alvo;

  update public.historico
     set revertido = true
   where tipo = 'venda_balcao'
     and payload->'cliente'->>'id' = alvo::text;

  raise notice 'APAGADO: "%" — % item(ns), % unidade(s), R$ %.', r.nome, n_itens, n_unidades, v_total;
end $$;
*/


-- ####  FIM  ####
-- Confere (a venda nao pode mais aparecer):
--   select id, nome, pago_em from public.clientes
--    where nome like 'Balcão %' order by pago_em desc limit 10;
