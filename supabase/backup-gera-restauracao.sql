-- ============================================================================
--  BACKUP DA BOLA 7 — gera o SQL que RESTAURA tudo de volta
--  Roda no Supabase → SQL Editor. É SOMENTE LEITURA: não altera nada, pode
--  rodar com o bar vendendo.
--
--  Como usar:
--   1. Roda uma consulta por vez.
--   2. No resultado, clica em "Download CSV" (ou copia a coluna inteira).
--   3. Salva num arquivo, ex.: backup-2026-08-21.sql, numa pasta sua.
--
--  Se um dia sumir: abre o arquivo, cola no SQL Editor e roda. Volta tudo.
--  Todos os comandos gerados têm "on conflict do nothing" — rodar em cima do
--  que já existe não duplica e não sobrescreve.
--
--  PRIORIDADE: a consulta 1 (contagem de estoque) é a que mais dói perder.
--  Venda perdida é prejuízo de relatório; contagem perdida é contar o bar
--  inteiro de novo, garrafa por garrafa.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) CONTAGEM DE ESTOQUE (estoque_entradas) — o mais importante
-- ----------------------------------------------------------------------------
select 'insert into public.estoque_entradas (id, distribuidora_id, cerveja_id, unidades, caixas, custo_caixa, obs, created_at) values ('
    || quote_literal(id::text)               || '::uuid, '
    || quote_literal(distribuidora_id::text) || '::uuid, '
    || quote_literal(cerveja_id::text)       || '::uuid, '
    || unidades                              || ', '
    || coalesce(caixas::text, 'null')        || ', '
    || coalesce(custo_caixa::text, 'null')   || ', '
    || coalesce(quote_literal(obs), 'null')  || ', '
    || quote_literal(created_at::text)       || '::timestamptz) on conflict (id) do nothing;'
    as restaura_estoque
  from public.estoque_entradas
 where distribuidora_id = '19241b05-31e7-44ef-a0d9-78b3a00946b4'
 order by created_at;

-- ----------------------------------------------------------------------------
-- 2) CATÁLOGO (cervejas) — preço, custo, pasta, sub-pasta e foto de cada produto
--    Também é trabalho manual de horas: 107 produtos cadastrados e fotografados.
-- ----------------------------------------------------------------------------
select 'insert into public.cervejas (id, distribuidora_id, nome, tamanho, preco, ativo, ordem, cor, custo_caixa, unidades_caixa, estoque_min, categoria, subcategoria, foto, vai_cozinha, created_at) values ('
    || quote_literal(id::text)                   || '::uuid, '
    || quote_literal(distribuidora_id::text)     || '::uuid, '
    || quote_literal(nome)                       || ', '
    || quote_literal(coalesce(tamanho, ''))      || ', '
    || preco                                     || ', '
    || ativo                                     || ', '
    || ordem                                     || ', '
    || coalesce(quote_literal(cor), 'null')      || ', '
    || coalesce(custo_caixa::text, 'null')       || ', '
    || coalesce(unidades_caixa::text, 'null')    || ', '
    || coalesce(estoque_min::text, 'null')       || ', '
    || coalesce(quote_literal(categoria), 'null')    || ', '
    || coalesce(quote_literal(subcategoria), 'null') || ', '
    || coalesce(quote_literal(foto), 'null')     || ', '
    || coalesce(vai_cozinha::text, 'false')      || ', '
    || quote_literal(created_at::text)           || '::timestamptz) on conflict (id) do nothing;'
    as restaura_catalogo
  from public.cervejas
 where distribuidora_id = '19241b05-31e7-44ef-a0d9-78b3a00946b4'
 order by ordem;

-- ----------------------------------------------------------------------------
-- 3) VENDAS FECHADAS (clientes pagos) — o histórico de faturamento
-- ----------------------------------------------------------------------------
select 'insert into public.clientes (id, distribuidora_id, nome, aberto, pago_em, forma_pagamento, created_at) values ('
    || quote_literal(id::text)                        || '::uuid, '
    || quote_literal(distribuidora_id::text)          || '::uuid, '
    || quote_literal(nome)                            || ', '
    || aberto                                         || ', '
    || coalesce(quote_literal(pago_em::text) || '::timestamptz', 'null') || ', '
    || coalesce(quote_literal(forma_pagamento), 'null')  || ', '
    || quote_literal(created_at::text)                || '::timestamptz) on conflict (id) do nothing;'
    as restaura_comandas
  from public.clientes
 where distribuidora_id = '19241b05-31e7-44ef-a0d9-78b3a00946b4'
 order by created_at;

-- ----------------------------------------------------------------------------
-- 4) OS ITENS VENDIDOS (consumos) — é o que sustenta faturamento e estoque
--    Rode DEPOIS da consulta 3 na hora de restaurar (o item aponta pra comanda).
-- ----------------------------------------------------------------------------
select 'insert into public.consumos (id, distribuidora_id, cliente_id, beer_nome, preco_unit, quantidade, pronto_em, created_at) values ('
    || quote_literal(id::text)               || '::uuid, '
    || quote_literal(distribuidora_id::text) || '::uuid, '
    || quote_literal(cliente_id::text)       || '::uuid, '
    || quote_literal(beer_nome)              || ', '
    || preco_unit                            || ', '
    || quantidade                            || ', '
    || coalesce(quote_literal(pronto_em::text) || '::timestamptz', 'null') || ', '
    || quote_literal(created_at::text)       || '::timestamptz) on conflict (id) do nothing;'
    as restaura_vendas
  from public.consumos
 where distribuidora_id = '19241b05-31e7-44ef-a0d9-78b3a00946b4'
 order by created_at;

-- ----------------------------------------------------------------------------
-- 5) PAGAMENTOS PARCIAIS e PERDAS
-- ----------------------------------------------------------------------------
select 'insert into public.pagamentos_parciais (id, distribuidora_id, cliente_id, valor, qtd, forma, obs, created_at) values ('
    || quote_literal(id::text)               || '::uuid, '
    || quote_literal(distribuidora_id::text) || '::uuid, '
    || quote_literal(cliente_id::text)       || '::uuid, '
    || valor                                 || ', '
    || coalesce(qtd::text, 'null')           || ', '
    || coalesce(quote_literal(forma), 'null')|| ', '
    || coalesce(quote_literal(obs), 'null')  || ', '
    || quote_literal(created_at::text)       || '::timestamptz) on conflict (id) do nothing;'
    as restaura_parciais
  from public.pagamentos_parciais
 where distribuidora_id = '19241b05-31e7-44ef-a0d9-78b3a00946b4'
 order by created_at;

select 'insert into public.perdas (id, distribuidora_id, cerveja_id, beer_nome, preco_unit, quantidade, motivo, created_at) values ('
    || quote_literal(id::text)               || '::uuid, '
    || quote_literal(distribuidora_id::text) || '::uuid, '
    || coalesce(quote_literal(cerveja_id::text) || '::uuid', 'null') || ', '
    || quote_literal(beer_nome)              || ', '
    || preco_unit                            || ', '
    || quantidade                            || ', '
    || coalesce(quote_literal(motivo), 'null') || ', '
    || quote_literal(created_at::text)       || '::timestamptz) on conflict (id) do nothing;'
    as restaura_perdas
  from public.perdas
 where distribuidora_id = '19241b05-31e7-44ef-a0d9-78b3a00946b4'
 order by created_at;

-- ============================================================================
--  ORDEM PRA RESTAURAR (se um dia precisar):
--    2 catálogo → 1 estoque → 3 comandas → 4 vendas → 5 parciais e perdas
--  (o filho depende do pai: item aponta pra comanda, entrada aponta pro produto)
-- ============================================================================
