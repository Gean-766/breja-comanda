-- ============================================================================
--  LIMPAR OS DADOS DE UMA DISTRIBUIDORA  (entregar o app zerado pro cliente)
--  Supabase → SQL Editor. ⚠️ NÃO tem desfazer — confira o nome antes de rodar.
--
--  O que apaga: vendas (consumos), comandas (clientes), histórico e as entradas
--  de estoque da distribuidora escolhida. MANTÉM os produtos cadastrados
--  (nome/preço/custo) — o cliente só refaz a contagem do estoque.
--  NÃO toca em nenhuma outra distribuidora (a BREJA & CIA fica intacta).
-- ============================================================================

-- PASSO 1 — rode esta linha sozinha e confira o nome EXATO da distribuidora:
--   select id, nome, login from distribuidoras order by nome;

-- PASSO 2 — troque 'TROQUE_AQUI' pelo nome exato e rode o bloco abaixo.
--   (NUNCA ponha 'BREJA & CIA' aqui se ela for o cliente que já usa de verdade.)

do $$
declare
  alvo uuid;
  n_consumos int;
  n_clientes int;
begin
  select id into alvo from distribuidoras where nome = 'TROQUE_AQUI';

  if alvo is null then
    raise exception 'Distribuidora "TROQUE_AQUI" não encontrada. Rode o PASSO 1 e copie o nome exato.';
  end if;

  select count(*) into n_consumos from consumos where distribuidora_id = alvo;
  select count(*) into n_clientes from clientes where distribuidora_id = alvo;

  delete from consumos         where distribuidora_id = alvo;
  delete from clientes         where distribuidora_id = alvo;
  delete from historico        where distribuidora_id = alvo;
  delete from estoque_entradas where distribuidora_id = alvo;

  -- (OPCIONAL) apagar TAMBÉM os produtos cadastrados — só se forem produtos de
  -- teste que você quer sumir. Pra isso, tire o "-- " da linha de baixo:
  -- delete from cervejas where distribuidora_id = alvo;

  raise notice 'Limpo: % (apagou % vendas e % comandas). Produtos mantidos.',
    alvo, n_consumos, n_clientes;
end $$;

-- Confere que zerou (troque o nome de novo):
--   select count(*) from consumos where distribuidora_id =
--     (select id from distribuidoras where nome = 'TROQUE_AQUI');
