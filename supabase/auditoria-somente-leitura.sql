-- ============================================================================
--  AUDITORIA DA BOLA 7 — SOMENTE LEITURA
--  Pode rodar com o bar vendendo: são só SELECTs, não alteram nada.
--  Serve pra ver se o dinheiro e o estoque estão batendo AGORA.
--  Roda uma consulta por vez no SQL Editor.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) COMANDAS EXCLUÍDAS — o buraco do caso "Maranhão"
--    Apagar comanda leva junto, por cascata, as vendas e os pagamentos já
--    recebidos. Se aparecer alguma linha aqui, esse valor saiu do relatório
--    mas o dinheiro pode ter entrado na gaveta.
-- ----------------------------------------------------------------------------
select h.created_at                                              as quando,
       h.descricao,
       coalesce(jsonb_array_length(h.payload->'consumos'), 0)     as itens_apagados,
       (select coalesce(sum((i->>'preco_unit')::numeric * (i->>'quantidade')::int), 0)
          from jsonb_array_elements(coalesce(h.payload->'consumos','[]'::jsonb)) i)
                                                                  as valor_apagado
  from public.historico h
 where h.distribuidora_id = '19241b05-31e7-44ef-a0d9-78b3a00946b4'
   and h.tipo = 'excluir_cliente'
 order by h.created_at desc;

-- ----------------------------------------------------------------------------
-- 2) VENDAS ÓRFÃS — venda cujo nome não casa com nenhum produto do cadastro.
--    Essas NÃO descontam do estoque. É o que acontece quando um produto é
--    renomeado depois de já ter sido vendido.
--    O esperado é voltar VAZIO.
-- ----------------------------------------------------------------------------
select co.beer_nome,
       sum(co.quantidade) as unidades,
       min(co.created_at) as primeira,
       max(co.created_at) as ultima
  from public.consumos co
 where co.distribuidora_id = '19241b05-31e7-44ef-a0d9-78b3a00946b4'
   and not exists (
     select 1 from public.cervejas c
      where c.distribuidora_id = co.distribuidora_id
        and case when coalesce(c.tamanho,'') = '' then c.nome else c.nome || ' ' || c.tamanho end
            = co.beer_nome
   )
 group by 1
 order by 2 desc;

-- ----------------------------------------------------------------------------
-- 3) SALDO DE CADA PRODUTO — a mesma conta que o app faz na tela
--    saldo = entradas − saídas − perdas (contando só o que saiu DEPOIS da
--    primeira entrada). Serve pra bater com a prateleira.
--    Saldo NEGATIVO é sinal de alarme: vendeu mais do que entrou.
-- ----------------------------------------------------------------------------
with prod as (
  select c.id, c.nome,
         case when coalesce(c.tamanho,'') = '' then c.nome else c.nome || ' ' || c.tamanho end as repr
    from public.cervejas c
   where c.distribuidora_id = '19241b05-31e7-44ef-a0d9-78b3a00946b4' and c.ativo = true
), ent as (
  select cerveja_id, sum(unidades) as entrou, min(created_at) as desde
    from public.estoque_entradas
   where distribuidora_id = '19241b05-31e7-44ef-a0d9-78b3a00946b4'
   group by 1
)
select p.nome,
       e.entrou,
       coalesce((select sum(co.quantidade) from public.consumos co
                  where co.distribuidora_id = '19241b05-31e7-44ef-a0d9-78b3a00946b4'
                    and co.beer_nome = p.repr and co.created_at >= e.desde), 0) as saiu,
       coalesce((select sum(pe.quantidade) from public.perdas pe
                  where pe.distribuidora_id = '19241b05-31e7-44ef-a0d9-78b3a00946b4'
                    and pe.cerveja_id = p.id and pe.created_at >= e.desde), 0)  as perdas,
       e.entrou
         - coalesce((select sum(co.quantidade) from public.consumos co
                      where co.distribuidora_id = '19241b05-31e7-44ef-a0d9-78b3a00946b4'
                        and co.beer_nome = p.repr and co.created_at >= e.desde), 0)
         - coalesce((select sum(pe.quantidade) from public.perdas pe
                      where pe.distribuidora_id = '19241b05-31e7-44ef-a0d9-78b3a00946b4'
                        and pe.cerveja_id = p.id and pe.created_at >= e.desde), 0) as saldo
  from prod p
  join ent e on e.cerveja_id = p.id
 order by saldo asc;

-- ----------------------------------------------------------------------------
-- 4) CAIXA DO DIA — quanto entrou, por forma.
--    Some as partes (conta dividida) com o resto pago no fechamento, que é
--    exatamente o que o Relatório mostra.
-- ----------------------------------------------------------------------------
with venda as (
  select cliente_id, sum(preco_unit * quantidade) as total
    from public.consumos
   where distribuidora_id = '19241b05-31e7-44ef-a0d9-78b3a00946b4'
   group by 1
), parcial as (
  select cliente_id, sum(valor) as pago
    from public.pagamentos_parciais
   where distribuidora_id = '19241b05-31e7-44ef-a0d9-78b3a00946b4'
   group by 1
)
select coalesce(forma, '(sem forma)') as forma, sum(valor) as recebido from (
  select pp.forma, pp.valor
    from public.pagamentos_parciais pp
   where pp.distribuidora_id = '19241b05-31e7-44ef-a0d9-78b3a00946b4'
     and pp.created_at::date = current_date
  union all
  select cl.forma_pagamento,
         coalesce(v.total, 0) - coalesce(pa.pago, 0)
    from public.clientes cl
    left join venda   v  on v.cliente_id  = cl.id
    left join parcial pa on pa.cliente_id = cl.id
   where cl.distribuidora_id = '19241b05-31e7-44ef-a0d9-78b3a00946b4'
     and cl.aberto = false
     and cl.pago_em::date = current_date
     and coalesce(v.total, 0) - coalesce(pa.pago, 0) > 0
) x
 group by 1
 order by 2 desc;

-- ----------------------------------------------------------------------------
-- 5) COMANDAS ABERTAS AGORA — quanto ainda falta receber de cada uma
-- ----------------------------------------------------------------------------
with venda as (
  select cliente_id, sum(preco_unit * quantidade) as total
    from public.consumos
   where distribuidora_id = '19241b05-31e7-44ef-a0d9-78b3a00946b4' group by 1
), parcial as (
  select cliente_id, sum(valor) as pago
    from public.pagamentos_parciais
   where distribuidora_id = '19241b05-31e7-44ef-a0d9-78b3a00946b4' group by 1
)
select cl.nome,
       cl.created_at                       as aberta_desde,
       coalesce(v.total, 0)                as total,
       coalesce(pa.pago, 0)                as ja_pago,
       coalesce(v.total, 0) - coalesce(pa.pago, 0) as falta
  from public.clientes cl
  left join venda   v  on v.cliente_id  = cl.id
  left join parcial pa on pa.cliente_id = cl.id
 where cl.distribuidora_id = '19241b05-31e7-44ef-a0d9-78b3a00946b4'
   and cl.aberto = true
 order by falta desc;
