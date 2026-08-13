-- ============================================================================
--  LIMPAR MOVIMENTAÇÃO E RELATÓRIO — MANTENDO O ESTOQUE
--  Supabase → SQL Editor. ⚠️ NÃO tem desfazer.
--
--  Pra quê: você testou o app antes de entregar e quer zerar o movimento sem
--  perder a contagem de estoque que já foi feita.
--
--  APAGA:  comandas (clientes), vendas (consumos), pagamentos parciais,
--          histórico e perdas.
--  MANTÉM: cervejas (produtos, preço, custo) e estoque_entradas (a contagem
--          inicial e os abastecimentos) — é o que sustenta o saldo.
--
--  ⚠️ O SALDO DO ESTOQUE VAI SUBIR. O saldo é
--     (entradas) − (consumos) − (perdas). Apagando as vendas e as perdas de
--     teste, o saldo volta a ser exatamente o total das entradas. É o
--     comportamento certo pra uma entrega limpa — só confira se bate com a
--     contagem física antes do cliente começar o dia.
--
--  Diferente de limpar-distribuidora.sql, que apaga estoque_entradas também.
-- ============================================================================

-- PASSO 1 (opcional) — ver o que vai embora antes de apagar:
--
-- select
--   (select count(*) from public.clientes            where distribuidora_id = '19241b05-31e7-44ef-a0d9-78b3a00946b4') as comandas,
--   (select count(*) from public.consumos            where distribuidora_id = '19241b05-31e7-44ef-a0d9-78b3a00946b4') as vendas,
--   (select count(*) from public.pagamentos_parciais where distribuidora_id = '19241b05-31e7-44ef-a0d9-78b3a00946b4') as parciais,
--   (select count(*) from public.historico           where distribuidora_id = '19241b05-31e7-44ef-a0d9-78b3a00946b4') as historico,
--   (select count(*) from public.perdas              where distribuidora_id = '19241b05-31e7-44ef-a0d9-78b3a00946b4') as perdas;

-- PASSO 2 — limpa. Filhos primeiro, pra não brigar com as chaves estrangeiras.

delete from public.pagamentos_parciais where distribuidora_id = '19241b05-31e7-44ef-a0d9-78b3a00946b4';
delete from public.consumos            where distribuidora_id = '19241b05-31e7-44ef-a0d9-78b3a00946b4';
delete from public.clientes            where distribuidora_id = '19241b05-31e7-44ef-a0d9-78b3a00946b4';
delete from public.historico           where distribuidora_id = '19241b05-31e7-44ef-a0d9-78b3a00946b4';
delete from public.perdas              where distribuidora_id = '19241b05-31e7-44ef-a0d9-78b3a00946b4';

-- PASSO 3 — confere: as 5 primeiras têm que vir 0; as 2 últimas, intactas.

select
  (select count(*) from public.clientes            where distribuidora_id = '19241b05-31e7-44ef-a0d9-78b3a00946b4') as comandas,
  (select count(*) from public.consumos            where distribuidora_id = '19241b05-31e7-44ef-a0d9-78b3a00946b4') as vendas,
  (select count(*) from public.pagamentos_parciais where distribuidora_id = '19241b05-31e7-44ef-a0d9-78b3a00946b4') as parciais,
  (select count(*) from public.historico           where distribuidora_id = '19241b05-31e7-44ef-a0d9-78b3a00946b4') as historico,
  (select count(*) from public.perdas              where distribuidora_id = '19241b05-31e7-44ef-a0d9-78b3a00946b4') as perdas,
  (select count(*) from public.cervejas            where distribuidora_id = '19241b05-31e7-44ef-a0d9-78b3a00946b4') as produtos_MANTIDOS,
  (select count(*) from public.estoque_entradas    where distribuidora_id = '19241b05-31e7-44ef-a0d9-78b3a00946b4') as entradas_MANTIDAS;
